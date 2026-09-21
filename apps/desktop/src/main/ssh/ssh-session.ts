import type { MessagePortMain } from 'electron';
import ssh2, { type ClientChannel, type ConnectConfig, type VerifyCallback } from 'ssh2';
import type { Client as ClientType } from 'ssh2';
import {
  SshTerminalRequestSchema,
  TerminalClientMessageSchema,
  type SftpListResult,
  type SshTerminalRequest
} from '@geared-term/protocol';
import type { Logger } from '../logging';
import { applyCdSubmission, noteListed, type CdFollowState } from '../sftp/cd-tracking';
import { SftpService } from '../sftp/sftp-service';
import { KnownHostsStore } from './known-hosts';
import { probeScript } from '../environment/probe';

const { Client, utils } = ssh2;

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
  client: ClientType;
  channel?: ClientChannel;
  port: MessagePortMain;
  sftpReady: Promise<SftpService>;
  rejectSftp: (error: Error) => void;
  sequence: number;
  closed: boolean;
  pendingHostKey?: PendingHostKey;
  follow: CdFollowState | null;
  size: { cols: number; rows: number };
};

export type SshSessionHooks = {
  onReady?: (details: { sessionId: string; targetKey: string }) => void;
  onSftpCd?: (sessionId: string, directory: string | null) => void;
  onClosed?: (sessionId: string) => void;
};

export class SshSessionManager {
  private readonly sessions = new Map<string, SshSession>();

  public constructor(
    private readonly logger: Logger,
    private readonly knownHosts: KnownHostsStore,
    private readonly hooks: SshSessionHooks = {}
  ) {}

  public create(rawRequest: unknown, port: MessagePortMain): void {
    const request = SshTerminalRequestSchema.parse(rawRequest);
    if (this.sessions.has(request.sessionId))
      throw new Error(`Session already exists: ${request.sessionId}`);
    const client = new Client();
    let rejectSftp!: (error: Error) => void;
    const sftpReady = new Promise<SftpService>((resolve, reject) => {
      rejectSftp = reject;
      client.once('ready', () => {
        client.sftp((error, sftp) => {
          if (error) {
            reject(error);
          } else {
            resolve(new SftpService(sftp));
          }
        });
      });
    });
    void sftpReady.catch(() => undefined);
    const session: SshSession = {
      id: request.sessionId,
      request,
      client,
      port,
      sftpReady,
      rejectSftp,
      sequence: 0,
      closed: false,
      follow: null,
      size: { cols: request.cols, rows: request.rows }
    };
    // Seed the directory tracker with the real home as soon as SFTP is up so
    // `cd` typed before the panel ever opens is still followed.
    void sftpReady
      .then((service) => service.canonicalize('.'))
      .then((home) => {
        if (!session.closed) session.follow = { home, directory: home, previous: null };
      })
      .catch(() => undefined);
    this.sessions.set(session.id, session);
    port.start();
    port.on('message', (event) => this.onClientMessage(session, event.data));
    port.on('close', () => this.close(session, 'renderer-port-closed'));
    this.sendState(session, 'starting');

    client.on('ready', () => {
      if (session.closed) return;
      client.shell(
        { term: request.term, cols: session.size.cols, rows: session.size.rows },
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
          this.hooks.onReady?.({
            sessionId: session.id,
            targetKey: `${request.username}@${request.host}:${request.port}`
          });
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

  public async listSftp(
    sessionId: string,
    directory: string,
    reanchor = false
  ): Promise<SftpListResult> {
    const session = this.sessions.get(sessionId);
    if (!session || session.closed) throw new Error('SSH session is not available for SFTP');
    const service = await session.sftpReady;
    if (session.closed) throw new Error('SSH session is no longer available for SFTP');
    const canonical = await service.canonicalize(directory);
    const entries = await service.list(canonical);
    // Only listings that mirror the shell's real directory may re-anchor the
    // tracker; standalone panel browsing must not poison the relative-cd base.
    if (reanchor) {
      session.follow = noteListed(
        session.follow ?? { home: null, directory: canonical, previous: null },
        canonical
      );
    }
    return { directory: canonical, entries };
  }

  public trackedDirectory(sessionId: string): string | null {
    return this.sessions.get(sessionId)?.follow?.directory ?? null;
  }

  public async runSftp<T>(
    sessionId: string,
    operation: (service: SftpService) => Promise<T>
  ): Promise<T> {
    const session = this.sessions.get(sessionId);
    if (!session || session.closed) throw new Error('SSH session is not available for SFTP');
    const service = await session.sftpReady;
    if (session.closed) throw new Error('SSH session is no longer available for SFTP');
    return operation(service);
  }

  public async sftpService(sessionId: string): Promise<SftpService> {
    const session = this.sessions.get(sessionId);
    if (!session || session.closed) throw new Error('SSH session is not available for SFTP');
    const service = await session.sftpReady;
    if (session.closed) throw new Error('SSH session is no longer available for SFTP');
    return service;
  }

  public sendInput(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.closed || !session.channel) {
      throw new Error('SSH terminal is not available');
    }
    session.channel.write(data);
  }

  public exec(sessionId: string, command = probeScript, signal?: AbortSignal): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session || session.closed) throw new Error('SSH terminal is not available');
    return new Promise<string>((resolve, reject) => {
      let output = '';
      let outputBytes = 0;
      let settled = false;
      let channel: ClientChannel | undefined;
      const timer = setTimeout(() => {
        channel?.close();
        finish(new Error('SSH environment probe timed out'));
      }, 4_000);
      const finish = (error: Error | null, value = ''): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (error) reject(error);
        else resolve(value);
      };
      const abort = (): void => {
        channel?.close();
        finish(new Error('SSH environment probe cancelled'));
      };
      if (signal?.aborted) {
        abort();
        return;
      }
      signal?.addEventListener('abort', abort, { once: true });
      const append = (chunk: Buffer | string): void => {
        if (settled) return;
        outputBytes += Buffer.byteLength(chunk.toString(), 'utf8');
        if (outputBytes > 64 * 1024) {
          channel?.close();
          finish(new Error('SSH environment probe output exceeded its limit'));
          return;
        }
        output += chunk.toString();
      };
      const quotedCommand = `'${command.replace(/'/gu, "'\\''")}'`;
      session.client.exec(`sh -c ${quotedCommand}`, (error, nextChannel) => {
        if (error) {
          finish(error);
          return;
        }
        channel = nextChannel;
        nextChannel.on('data', append);
        nextChannel.stderr.on('data', append);
        nextChannel.on('error', (channelError: Error) => finish(channelError));
        nextChannel.on('close', (code: number | undefined) => {
          if (code === 0 || code === undefined) finish(null, output);
          else finish(new Error(`SSH environment probe exited with code ${code}`));
        });
      });
    });
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
    if (message.kind === 'input') {
      session.channel?.write(message.data);
    } else if (message.kind === 'cd-line') {
      // Submitted command lines are reconstructed (and screen-echo recovered)
      // by the renderer; the main process only owns the tracking state.
      if (!session.follow) return;
      const result = applyCdSubmission(session.follow, message.line);
      session.follow = result.state;
      if (result.effect.kind === 'move') this.hooks.onSftpCd?.(session.id, result.effect.directory);
      else if (result.effect.kind === 'unsynced') this.hooks.onSftpCd?.(session.id, null);
    } else if (message.kind === 'resize') {
      // Resizes can arrive before the shell channel exists (the connection is
      // still handshaking); setWindow would silently no-op and the remote pty
      // would stay at the request's placeholder size, so the latest size is
      // remembered and applied when the shell opens.
      session.size = { cols: message.cols, rows: message.rows };
      session.channel?.setWindow(message.rows, message.cols, 0, 0);
    } else if (message.kind === 'host-key-decision')
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
    session.rejectSftp(new Error(`SFTP session closed: ${reason}`));
    if (session.pendingHostKey) {
      clearTimeout(session.pendingHostKey.timer);
      session.pendingHostKey.verify(false);
      session.pendingHostKey = undefined;
    }
    session.channel?.destroy();
    session.client.end();
    this.sessions.delete(session.id);
    this.hooks.onClosed?.(session.id);
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
