import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import ssh2, { type ClientChannel, type ServerChannel } from 'ssh2';
import type { Client as ClientType } from 'ssh2';
import { fingerprintSha256 } from './known-hosts';

const { Client, Server, utils } = ssh2;

const hostKeys = [utils.generateKeyPairSync('rsa', { bits: 2048 }).private];

type SessionTrace = {
  pty: { cols: number; rows: number; term: string } | null;
  windowChanges: Array<{ cols: number; rows: number }>;
  shellInput: string;
  authAttempts: string[];
};

const trace: SessionTrace = {
  pty: null,
  windowChanges: [],
  shellInput: '',
  authAttempts: []
};

let server: InstanceType<typeof Server>;
let port = 0;
let hostKeyFingerprint = '';
type ServerConnection = { end: () => void };
const connections = new Set<ServerConnection>();

beforeAll(async () => {
  server = new Server({ hostKeys }, (connection) => {
    connections.add(connection);
    connection.on('close', () => connections.delete(connection));
    connection.on('error', () => connections.delete(connection));
    connection.on('authentication', (context) => {
      trace.authAttempts.push(`${context.method}:${context.username ?? ''}`);
      if (context.method === 'none') return context.reject(['password']);
      if (
        context.method === 'password' &&
        context.username === 'tester' &&
        context.password === 'geared-secret'
      ) {
        return context.accept();
      }
      return context.reject(['password']);
    });
    connection.on('session', (accept) => {
      const session = accept();
      let shellChannel: ServerChannel | undefined;
      session.on('pty', (ptyAccept, _reject, info) => {
        trace.pty = { cols: info.cols, rows: info.rows, term: info.term };
        ptyAccept();
      });
      session.on('window-change', (_changeAccept, _reject, info) => {
        // ssh2 server sessions reject window-change requests that are accepted;
        // handling the notification without accepting keeps the channel usable.
        trace.windowChanges.push({ cols: info.cols, rows: info.rows });
        shellChannel?.write(`${info.cols}x${info.rows}\r\n`);
      });
      session.on('shell', (shellAccept) => {
        const channel = shellAccept() as ServerChannel;
        shellChannel = channel;
        channel.write('ready\r\n');
        channel.on('data', (data: Buffer) => {
          trace.shellInput += data.toString();
        });
        channel.on('close', () => channel.end());
      });
      session.on('exec', (execAccept, reject, info) => {
        if (info.command === 'pwd') {
          const channel = execAccept();
          channel.write('/home/tester\n');
          channel.exit(0);
          channel.end();
        } else {
          reject();
        }
      });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as AddressInfo).port;
      resolve();
    });
  });
  hostKeyFingerprint = await new Promise<string>((resolve, reject) => {
    const probe = new Client();
    probe.on('error', reject);
    probe.on('ready', () => {
      probe.end();
      resolve(fingerprintSha256(capturedKey));
    });
    let capturedKey = Buffer.alloc(0);
    probe.connect({
      host: '127.0.0.1',
      port,
      username: 'tester',
      password: 'geared-secret',
      hostVerifier: (key: Buffer) => {
        capturedKey = Buffer.from(key);
        return true;
      }
    });
  });
});

afterAll(async () => {
  for (const connection of [...connections]) connection.end();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function connect(password = 'geared-secret'): ClientType {
  const client = new Client();
  client.connect({
    host: '127.0.0.1',
    port,
    username: 'tester',
    password,
    readyTimeout: 8000,
    hostVerifier: (key: Buffer) => fingerprintSha256(key) === hostKeyFingerprint
  });
  return client;
}

describe('controlled SSH server', () => {
  it('accepts deterministic password auth and reports exec output', async () => {
    const client = connect();
    const output = await new Promise<string>((resolve, reject) => {
      client.on('error', reject);
      client.on('ready', () => {
        client.exec('pwd', (error: Error | undefined, stream: ClientChannel) => {
          if (error) return reject(error);
          let data = '';
          stream.on('data', (chunk: Buffer) => (data += chunk.toString()));
          stream.on('close', (code: number | null) => {
            expect(code).toBe(0);
            resolve(data);
          });
        });
      });
    });
    expect(output.trim()).toBe('/home/tester');
    client.end();
  });

  it('rejects wrong passwords and a changed host key', async () => {
    await expect(
      new Promise((_resolve, reject) => {
        const client = connect('wrong');
        client.on('error', reject);
        client.on('ready', () => {
          client.end();
          reject(new Error('authentication should have failed'));
        });
      })
    ).rejects.toThrow(/All configured authentication methods failed/iu);

    await expect(
      new Promise((_resolve, reject) => {
        const client = new Client();
        client.on('error', reject);
        client.on('ready', () => {
          client.end();
          reject(new Error('host key should not have verified'));
        });
        client.connect({
          host: '127.0.0.1',
          port,
          username: 'tester',
          password: 'geared-secret',
          hostVerifier: () => false
        });
      })
    ).rejects.toThrow(/host key|verification|Handshake/iu);
  });

  it('carries the PTY geometry, echoes shell input, applies resizes, and reports exit', async () => {
    const client = connect();
    const collected = await new Promise<string>((resolve, reject) => {
      client.on('error', reject);
      client.on('ready', () => {
        client.shell(
          { term: 'xterm-256color', cols: 90, rows: 28 },
          (error: Error | undefined, channel: ClientChannel) => {
            if (error) return reject(error);
            let data = '';
            channel.on('data', (chunk: Buffer) => {
              data += chunk.toString();
              if (data.includes('120x36')) {
                channel.write('exit\r');
                channel.end();
                resolve(data);
              }
            });
            channel.on('exit', (code) => expect(code).toBeUndefined());
            setTimeout(() => channel.setWindow(36, 120, 0, 0), 150);
          }
        );
      });
    });
    expect(collected).toContain('ready');
    expect(collected).toContain('120x36');
    expect(trace.pty).toEqual({ cols: 90, rows: 28, term: 'xterm-256color' });
    expect(trace.windowChanges).toContainEqual({ cols: 120, rows: 36 });
    await vi.waitFor(() => expect(trace.shellInput).toContain('exit'), { timeout: 3000 });
    client.end();
  });

  it('surfaces disconnect as an explicit end state', async () => {
    const client = connect();
    const closed = await new Promise<string>((resolve, reject) => {
      client.on('error', reject);
      client.on('ready', () => client.end());
      client.on('close', () => resolve('closed'));
    });
    expect(closed).toBe('closed');
  });
});
