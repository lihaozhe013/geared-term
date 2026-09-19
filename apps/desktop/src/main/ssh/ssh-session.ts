import type { MessagePortMain } from 'electron';
import { Client, utils, type ClientChannel, type ConnectConfig, type VerifyCallback } from 'ssh2';
import {
  SshTerminalRequestSchema,
  TerminalClientMessageSchema,
  type SshTerminalRequest
} from '@geared-term/protocol';
import type { Logger } from '../logging';
import { KnownHostsStore } from './known-hosts';

type PendingHostKey = {
  key: Buffer;
  keyType: string;
  verify: VerifyCallback;
  previousBase64?: string;
  timer: NodeJS.Timeout;
};

type SshSession = {
  id: string;
  request: SshTerminalRequest;
  client: Client;
  channel?: ClientChannel;
  port: MessagePortMain;
  sequence: number;
  closed: boolean;
  pendingHostKey?: PendingHostKey;
};

export class SshSessionManager {
  private readonly sessions = new Map<string, SshSession>();

  public constructor(
    private readonly logger: Logger,
    private readonly knownHosts: KnownHostsStore
  ) {}

  public create(rawRequest: unknown, port: MessagePortMain): void {
    const request = SshTerminalRequestSchema.parse(rawRequest);
    if (this.sessions.has(request.sessionId))
      throw new Error(`Session already exists: ${request.sessionId}`);
    const client = new Client();
    const session: SshSession = {
      id: request.sessionId,
      request,
      client,
      port,
      sequence: 0,
      closed: false
    };
    this.sessions.set(session.id, session);
    port.start();
    port.on('message', (event) => this.onClientMessage(session, event.data));
    port.on('close', () => this.close(session, 'renderer-port-closed'));
    this.sendState(session, 'starting');

    client.on('ready', () => {
      if (session.closed) return;
      client.shell(
        { term: request.term, cols: request.cols, rows: request.rows },
        (error, channel) => {
          if (error) {
            this.fail(session, `PTY request failed: ${error.message}`);
            return;
          }
          session.channel = channel;
          channel.on('data', (chunk: Buffer | string) =>
            this.sendOutput(session, chunk.toString())
          );
          channel.stderr.on('data', (chunk: Buffer | string) =>
            this.sendOutput(session, chunk.toString())
          );
          channel.on('exit', (code) =>
            this.sendState(session, 'exited', `exitCode=${code ?? 'unknown'}`)
          );
          channel.on('close', () => {
            if (!session.closed) this.close(session, 'remote-channel-closed');
          });
          this.sendState(session, 'running');
        }
      );
    });
    client.on('error', (error) => this.fail(session, error.message));
    client.on('close', () => {
      if (!session.closed) this.close(session, 'ssh-connection-closed');
    });

    const config: ConnectConfig = {
      host: request.host,
      port: request.port,
      username: request.username,
      password: request.password,
      privateKey: request.privateKey,
      passphrase: request.passphrase,
      readyTimeout: 15_000,
      hostVerifier: (key: Buffer, verify: VerifyCallback) => {
        void this.verifyHost(session, key, verify);
      }
    };
    client.connect(config);
    this.logger.info('ssh', 'SSH connection started', {
      sessionId: session.id,
      host: request.host,
      port: request.port
    });
  }

  public closeAll(): void {
    for (const session of [...this.sessions.values()]) this.close(session, 'application-shutdown');
  }

  private async verifyHost(
    session: SshSession,
    key: Buffer,
    verify: VerifyCallback
  ): Promise<void> {
    if (session.closed) {
      verify(false);
      return;
    }
    const result = await this.knownHosts.verify(session.request.host, session.request.port, key);
    if (result.status === 'match') {
      verify(true);
      return;
    }
    const parsedKey = utils.parseKey(key);
    const keyType = parsedKey instanceof Error ? 'unknown' : parsedKey.type;
    const sequence = ++session.sequence;
    const timer = setTimeout(() => {
      if (session.pendingHostKey?.verify === verify) {
        session.pendingHostKey = undefined;
        verify(false);
        this.sendState(session, 'failed', 'Host-key approval timed out');
      }
    }, 60_000);
    session.pendingHostKey = {
      key,
      keyType,
      verify,
      previousBase64: result.stored?.keyBase64,
      timer
    };
    session.port.postMessage({
      kind: 'prompt',
      sessionId: session.id,
      sequence,
      prompt: 'host-key',
      host: session.request.host,
      port: session.request.port,
      fingerprint: result.fingerprint,
      previousFingerprint: result.stored?.fingerprint
    });
    this.sendState(
      session,
      'awaiting-user',
      result.status === 'changed' ? 'Host key changed' : 'Unknown host key'
    );
  }

  private onClientMessage(session: SshSession, rawMessage: unknown): void {
    const result = TerminalClientMessageSchema.safeParse(rawMessage);
    if (!result.success) {
      this.fail(session, 'Invalid SSH terminal message');
      return;
    }
    const message = result.data;
    if (message.kind === 'input') session.channel?.write(message.data);
    else if (message.kind === 'resize')
      session.channel?.setWindow(message.rows, message.cols, 0, 0);
    else if (message.kind === 'host-key-decision')
      void this.resolveHostKey(session, message.decision === 'approve');
    else if (message.kind === 'close') this.close(session, 'renderer-requested');
  }

  private async resolveHostKey(session: SshSession, approved: boolean): Promise<void> {
    const pending = session.pendingHostKey;
    if (!pending) return;
    session.pendingHostKey = undefined;
    clearTimeout(pending.timer);
    if (!approved) {
      pending.verify(false);
      this.fail(session, 'Host key was rejected');
      return;
    }
    try {
      const current = await this.knownHosts.verify(
        session.request.host,
        session.request.port,
        pending.key
      );
      if (current.status === 'unknown') {
        await this.knownHosts.approve(
          session.request.host,
          session.request.port,
          pending.keyType,
          pending.key
        );
      } else if (current.status === 'changed' && pending.previousBase64) {
        await this.knownHosts.replace(
          session.request.host,
          session.request.port,
          pending.keyType,
          pending.key,
          pending.previousBase64
        );
      } else if (current.status !== 'match') {
        throw new Error('Host key changed while it was awaiting approval');
      }
      pending.verify(true);
    } catch (error) {
      pending.verify(false);
      this.fail(
        session,
        error instanceof Error ? error.message : 'Unable to persist host key approval'
      );
    }
  }

  private sendOutput(session: SshSession, chunk: string): void {
    if (session.closed || !chunk) return;
    session.sequence += 1;
    session.port.postMessage({
      kind: 'output',
      sessionId: session.id,
      sequence: session.sequence,
      chunk
    });
  }

  private sendState(
    session: SshSession,
    state: 'starting' | 'awaiting-user' | 'running' | 'exited' | 'closing' | 'closed' | 'failed',
    detail?: string
  ): void {
    if (session.closed && state !== 'closed') return;
    session.sequence += 1;
    session.port.postMessage({
      kind: 'state',
      sessionId: session.id,
      sequence: session.sequence,
      state,
      detail
    });
  }

  private fail(session: SshSession, detail: string): void {
    if (session.closed) return;
    this.sendState(session, 'failed', detail);
    this.close(session, 'failure');
  }

  private close(session: SshSession, reason: string): void {
    if (session.closed) return;
    this.sendState(session, 'closing', reason);
    session.closed = true;
    if (session.pendingHostKey) {
      clearTimeout(session.pendingHostKey.timer);
      session.pendingHostKey.verify(false);
      session.pendingHostKey = undefined;
    }
    session.channel?.destroy();
    session.client.end();
    this.sessions.delete(session.id);
    session.sequence += 1;
    session.port.postMessage({
      kind: 'state',
      sessionId: session.id,
      sequence: session.sequence,
      state: 'closed',
      detail: reason
    });
    session.port.close();
    this.logger.info('ssh', 'SSH connection closed', { sessionId: session.id, reason });
  }
}
