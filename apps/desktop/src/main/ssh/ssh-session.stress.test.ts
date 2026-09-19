import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageChannel, type MessagePort } from 'node:worker_threads';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MessagePortMain } from 'electron';
import type { TerminalPortMessage } from '@geared-term/protocol';
import { createLogger } from '../logging';
import { KnownHostsStore } from './known-hosts';
import { startControlledServer, type ControlledServer } from './controlled-server';
import { SshSessionManager } from './ssh-session';

/**
 * Mirrors the Electron MessagePortMain surface using worker_threads ports so
 * SshSessionManager can be exercised in plain Node against the controlled
 * server (Electron's MessagePortMain wraps message payloads in { data }).
 */
type MainPortLike = {
  start(): void;
  close(): void;
  postMessage(value: unknown): void;
  on(event: 'message', listener: (event: { data: unknown }) => void): void;
  on(event: 'close', listener: () => void): void;
};

function adaptPort(port: MessagePort): MainPortLike {
  return {
    start: () => port.start(),
    close: () => port.close(),
    postMessage: (value: unknown) => port.postMessage(value),
    on: (event, listener) => {
      if (event === 'message') {
        port.on('message', (value: unknown) => listener({ data: value }));
        return;
      }
      port.on(event, () => (listener as (event?: { data: unknown }) => void)());
    }
  };
}

type SessionHandle = {
  id: string;
  messages: TerminalPortMessage[];
  output: string;
  send: (message: unknown) => void;
  dispose: () => void;
};

let server: ControlledServer;
let storageRoot = '';
let manager: SshSessionManager;
let rejectionManager: SshSessionManager;
let sessionCounter = 0;
const openSessions: SessionHandle[] = [];

beforeAll(async () => {
  server = await startControlledServer();
  storageRoot = await fs.mkdtemp(join(tmpdir(), 'geared-ssh-stress-'));
  const logger = createLogger(join(storageRoot, 'logs'));
  manager = new SshSessionManager(
    logger,
    new KnownHostsStore(join(storageRoot, 'known-hosts.json'), logger)
  );
  rejectionManager = new SshSessionManager(
    logger,
    new KnownHostsStore(join(storageRoot, 'rejected-hosts.json'), logger)
  );
});

afterAll(async () => {
  manager.closeAll();
  rejectionManager.closeAll();
  for (const session of openSessions.splice(0)) session.dispose();
  await server.close();
  await fs.rm(storageRoot, { recursive: true, force: true });
});

function waitForMessage(
  messages: TerminalPortMessage[],
  predicate: (message: TerminalPortMessage) => boolean,
  timeout = 15_000
): Promise<TerminalPortMessage> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeout;
    const poll = (): void => {
      const found = messages.find(predicate);
      if (found) {
        resolve(found);
        return;
      }
      if (Date.now() > deadline) {
        reject(
          new Error(`Timed out waiting for message; got ${JSON.stringify(messages.slice(-5))}`)
        );
        return;
      }
      setTimeout(poll, 25);
    };
    poll();
  });
}

type StateMessage = Extract<TerminalPortMessage, { kind: 'state' }>;

async function waitForState(
  messages: TerminalPortMessage[],
  state: StateMessage['state'],
  timeout = 15_000
): Promise<StateMessage> {
  const message = await waitForMessage(
    messages,
    (item) => item.kind === 'state' && item.state === state,
    timeout
  );
  return message as StateMessage;
}

async function openSession(target: SshSessionManager = manager): Promise<SessionHandle> {
  const id = `stress-${++sessionCounter}`;
  const { port1, port2 } = new MessageChannel();
  const messages: TerminalPortMessage[] = [];
  const handle: SessionHandle = {
    id,
    messages,
    output: '',
    send: (message: unknown) => port1.postMessage(message),
    dispose: () => port1.close()
  };
  openSessions.push(handle);
  port1.on('message', (value: unknown) => {
    const message = value as TerminalPortMessage;
    messages.push(message);
    if (message.kind === 'output') handle.output += message.chunk;
  });
  port1.start();
  target.create(
    {
      sessionId: id,
      host: '127.0.0.1',
      port: server.port,
      username: 'tester',
      password: 'geared-secret',
      cols: 80,
      rows: 24,
      term: 'xterm-256color'
    },
    adaptPort(port2) as unknown as MessagePortMain
  );
  const first = await waitForMessage(
    messages,
    (message) =>
      (message.kind === 'state' && message.state === 'running') ||
      (message.kind === 'prompt' && message.prompt === 'host-key')
  );
  if (first.kind === 'prompt') {
    port1.postMessage({ kind: 'host-key-decision', decision: 'approve' });
    await waitForMessage(
      messages,
      (message) => message.kind === 'state' && message.state === 'running'
    );
  }
  return handle;
}

async function openRejectedSession(): Promise<SessionHandle> {
  const id = `stress-reject-${++sessionCounter}`;
  const { port1, port2 } = new MessageChannel();
  const messages: TerminalPortMessage[] = [];
  const handle: SessionHandle = {
    id,
    messages,
    output: '',
    send: (message: unknown) => port1.postMessage(message),
    dispose: () => port1.close()
  };
  openSessions.push(handle);
  port1.on('message', (value: unknown) => messages.push(value as TerminalPortMessage));
  port1.start();
  rejectionManager.create(
    {
      sessionId: id,
      host: '127.0.0.1',
      port: server.port,
      username: 'tester',
      password: 'geared-secret',
      cols: 80,
      rows: 24,
      term: 'xterm-256color'
    },
    adaptPort(port2) as unknown as MessagePortMain
  );
  await waitForMessage(messages, (message) => message.kind === 'prompt');
  port1.postMessage({ kind: 'host-key-decision', decision: 'reject' });
  return handle;
}

function assertSequencesIncrease(messages: TerminalPortMessage[]): void {
  for (let index = 1; index < messages.length; index += 1) {
    expect(messages[index]?.sequence).toBeGreaterThan(
      (messages[index - 1] as { sequence: number }).sequence
    );
  }
}

describe('SSH session stress and fault tolerance', () => {
  it(
    'delivers sustained multi-megabyte output completely and in order',
    { timeout: 45_000 },
    async () => {
      const session = await openSession();
      const count = 500;
      const size = 8192;
      session.send({ kind: 'input', data: `flood ${count}x${size}\r` });
      await waitForMessage(
        session.messages,
        (message) => message.kind === 'output' && session.output.includes('FLOOD-END'),
        40_000
      );
      const markerStart = session.output.indexOf('FLOOD-START');
      const markerEnd = session.output.indexOf('FLOOD-END');
      expect(markerStart).toBeGreaterThanOrEqual(0);
      expect(markerEnd).toBeGreaterThan(markerStart);
      const payload = session.output.slice(markerStart + 'FLOOD-START\r\n'.length, markerEnd);
      expect(payload.length).toBe(count * size);
      assertSequencesIncrease(session.messages);
      session.send({ kind: 'close' });
      await waitForMessage(
        session.messages,
        (message) => message.kind === 'state' && message.state === 'closed'
      );
    }
  );

  it(
    'survives a rapid resize storm and keeps the channel usable',
    { timeout: 20_000 },
    async () => {
      const session = await openSession();
      for (let index = 0; index < 100; index += 1) {
        session.send({ kind: 'resize', cols: 40 + index, rows: 10 + (index % 20) });
      }
      await waitForMessage(
        session.messages,
        (message) => message.kind === 'output' && session.output.includes('139x29')
      );
      expect(
        server.trace.windowChanges.filter((change) => change.cols === 139 && change.rows === 29)
      ).toHaveLength(1);
      session.send({ kind: 'input', data: 'ping-after-storm\r' });
      await new Promise<void>((resolve, reject) => {
        const deadline = Date.now() + 5000;
        const poll = (): void => {
          if (server.trace.shellInput.includes('ping-after-storm')) return resolve();
          if (Date.now() > deadline) return reject(new Error('shell input was not delivered'));
          setTimeout(poll, 25);
        };
        poll();
      });
      expect(
        session.messages.some((message) => message.kind === 'state' && message.state === 'failed')
      ).toBe(false);
      session.send({ kind: 'close' });
      await waitForMessage(
        session.messages,
        (message) => message.kind === 'state' && message.state === 'closed'
      );
    }
  );

  it('runs concurrent sessions without cross-talk', { timeout: 30_000 }, async () => {
    const sessions = await Promise.all([openSession(), openSession(), openSession()]);
    sessions.forEach((session, index) => {
      session.send({ kind: 'input', data: `flood ${20 + index * 10}x1024\r` });
    });
    await Promise.all(
      sessions.map((session) =>
        waitForMessage(
          session.messages,
          (message) => message.kind === 'output' && session.output.includes('FLOOD-END')
        )
      )
    );
    sessions.forEach((session, index) => {
      const expected = (20 + index * 10) * 1024;
      const markerStart = session.output.indexOf('FLOOD-START');
      const markerEnd = session.output.indexOf('FLOOD-END');
      expect(markerEnd - markerStart - 'FLOOD-START\r\n'.length).toBe(expected);
      const ids = new Set(session.messages.map((message) => message.sessionId));
      expect(ids.size).toBe(1);
      expect(ids.has(session.id)).toBe(true);
    });
    manager.closeAll();
    await Promise.all(
      sessions.map((session) =>
        waitForMessage(
          session.messages,
          (message) => message.kind === 'state' && message.state === 'closed'
        )
      )
    );
  });

  it(
    'reports an explicit end state when the network drops abruptly',
    { timeout: 20_000 },
    async () => {
      const session = await openSession();
      server.dropConnections('abrupt');
      const closed = await waitForState(session.messages, 'closed');
      expect(closed.detail).toBe('ssh-connection-closed');
    }
  );

  it(
    'fails the session when the renderer sends a protocol violation',
    { timeout: 20_000 },
    async () => {
      const session = await openSession();
      session.send({ kind: 'not-a-real-message' });
      const failed = await waitForState(session.messages, 'failed');
      expect(failed.detail).toContain('Invalid SSH terminal message');
      await waitForMessage(
        session.messages,
        (message) => message.kind === 'state' && message.state === 'closed'
      );
    }
  );

  it('fails the session when the host key is rejected', { timeout: 20_000 }, async () => {
    const session = await openRejectedSession();
    const failed = await waitForState(session.messages, 'failed');
    expect(failed.detail).toMatch(/host (key was rejected|denied)/iu);
    await waitForMessage(
      session.messages,
      (message) => message.kind === 'state' && message.state === 'closed'
    );
  });
});
