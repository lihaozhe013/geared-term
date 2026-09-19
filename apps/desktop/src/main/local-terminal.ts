import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { MessagePortMain } from 'electron';
import { spawn, type IPty } from 'node-pty';
import {
  LocalTerminalRequestSchema,
  TerminalClientMessageSchema,
  type LocalTerminalRequest
} from '@geared-term/protocol';
import { type Logger } from './logging';

const maxOutstandingBytes = 512 * 1024;
const maxQueuedBytes = 4 * 1024 * 1024;

type LocalSession = {
  id: string;
  pty: IPty;
  port: MessagePortMain;
  sequence: number;
  outstandingBytes: number;
  queuedBytes: number;
  queue: string[];
  closed: boolean;
  disposeData: { dispose: () => void };
  disposeExit: { dispose: () => void };
};

function commandFromPath(command: string): string | undefined {
  try {
    return execFileSync('where.exe', [command], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    })
      .split(/\r?\n/)
      .map((value) => value.trim())
      .find(Boolean);
  } catch {
    return undefined;
  }
}

function resolveWindowsShell(): string {
  const programFiles = process.env.ProgramFiles;
  const powershell7 = programFiles ? join(programFiles, 'PowerShell', '7', 'pwsh.exe') : undefined;
  if (powershell7 && existsSync(powershell7)) {
    return powershell7;
  }

  return (
    commandFromPath('pwsh.exe') ??
    commandFromPath('powershell.exe') ??
    process.env.ComSpec ??
    'cmd.exe'
  );
}

function resolveShell(requested: string | undefined): string {
  if (requested?.trim()) {
    return requested.trim();
  }

  if (process.platform === 'win32') {
    return resolveWindowsShell();
  }

  return process.env.SHELL?.trim() || '/bin/sh';
}

function resolveCwd(requested: string | undefined): string {
  const cwd = requested?.trim() || homedir();
  try {
    if (!statSync(cwd).isDirectory()) {
      throw new Error('Working directory is not a directory');
    }
  } catch {
    throw new Error(`Working directory is unavailable: ${cwd}`);
  }
  return cwd;
}

function environment(term: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  result.TERM = term;
  result.COLORTERM = 'truecolor';
  return result;
}

export class LocalTerminalManager {
  private readonly sessions = new Map<string, LocalSession>();

  public constructor(private readonly logger: Logger) {}

  public create(rawRequest: unknown, port: MessagePortMain): void {
    const request = LocalTerminalRequestSchema.parse(rawRequest);
    if (this.sessions.has(request.sessionId)) {
      throw new Error(`Session already exists: ${request.sessionId}`);
    }
    if (request.args.length > 0 && !request.shell?.trim()) {
      throw new Error('A shell executable is required when arguments are provided');
    }

    const shell = resolveShell(request.shell);
    const args =
      request.args.length > 0 ? request.args : process.platform === 'darwin' ? ['-l'] : [];
    const terminal = spawn(shell, args, {
      name: request.term,
      cols: request.cols,
      rows: request.rows,
      cwd: resolveCwd(request.cwd),
      env: environment(request.term)
    });
    const session: LocalSession = {
      id: request.sessionId,
      pty: terminal,
      port,
      sequence: 0,
      outstandingBytes: 0,
      queuedBytes: 0,
      queue: [],
      closed: false,
      disposeData: { dispose: () => undefined },
      disposeExit: { dispose: () => undefined }
    };
    this.sessions.set(session.id, session);
    port.start();
    port.on('message', (event) => this.onClientMessage(session, event.data));
    port.on('close', () => this.close(session, 'renderer-port-closed'));
    this.sendState(session, 'running');
    session.disposeData = terminal.onData((chunk) => this.enqueueOutput(session, chunk));
    session.disposeExit = terminal.onExit(({ exitCode, signal }) => {
      if (session.closed) {
        return;
      }
      this.sendState(session, 'exited', `exitCode=${exitCode}; signal=${signal}`);
      session.disposeData.dispose();
      session.disposeExit.dispose();
      this.sessions.delete(session.id);
    });
    this.logger.info('terminal', 'Local terminal started', { sessionId: session.id, shell });
  }

  public closeAll(): void {
    for (const session of [...this.sessions.values()]) {
      this.close(session, 'application-shutdown');
    }
  }

  public sendInput(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.closed) throw new Error('Local terminal is not available');
    session.pty.write(data);
  }

  private onClientMessage(session: LocalSession, rawMessage: unknown): void {
    const result = TerminalClientMessageSchema.safeParse(rawMessage);
    if (!result.success) {
      this.sendState(session, 'failed', 'Invalid terminal message');
      this.close(session, 'invalid-message');
      return;
    }

    const message = result.data;
    if (message.kind === 'input') {
      if (!session.closed) session.pty.write(message.data);
      return;
    }
    if (message.kind === 'resize') {
      if (!session.closed) session.pty.resize(message.cols, message.rows);
      return;
    }
    if (message.kind === 'ack') {
      session.outstandingBytes = Math.max(0, session.outstandingBytes - message.bytes);
      this.flushOutput(session);
      return;
    }
    this.close(session, 'renderer-requested');
  }

  private enqueueOutput(session: LocalSession, chunk: string): void {
    if (session.closed || chunk.length === 0) {
      return;
    }
    const bytes = new TextEncoder().encode(chunk).byteLength;
    session.queue.push(chunk);
    session.queuedBytes += bytes;
    if (session.queuedBytes > maxQueuedBytes) {
      this.sendState(session, 'failed', 'Terminal output backpressure limit exceeded');
      this.close(session, 'output-backpressure');
      return;
    }
    this.flushOutput(session);
  }

  private flushOutput(session: LocalSession): void {
    while (
      !session.closed &&
      session.queue.length > 0 &&
      session.outstandingBytes < maxOutstandingBytes
    ) {
      const chunk = session.queue.shift();
      if (chunk === undefined) return;
      const bytes = new TextEncoder().encode(chunk).byteLength;
      session.queuedBytes -= bytes;
      session.outstandingBytes += bytes;
      session.sequence += 1;
      session.port.postMessage({
        kind: 'output',
        sessionId: session.id,
        sequence: session.sequence,
        chunk
      });
    }
  }

  private sendState(
    session: LocalSession,
    state: 'running' | 'exited' | 'closing' | 'closed' | 'failed',
    detail?: string
  ): void {
    if (session.closed && state !== 'closed') {
      return;
    }
    session.sequence += 1;
    session.port.postMessage({
      kind: 'state',
      sessionId: session.id,
      sequence: session.sequence,
      state,
      detail
    });
  }

  private close(session: LocalSession, reason: string): void {
    if (session.closed) {
      return;
    }
    this.sendState(session, 'closing', reason);
    session.closed = true;
    session.disposeData.dispose();
    session.disposeExit.dispose();
    try {
      session.pty.kill();
    } catch (error) {
      this.logger.warn('terminal', 'Local terminal kill failed', {
        sessionId: session.id,
        error: String(error)
      });
    }
    session.queue.length = 0;
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
    this.logger.info('terminal', 'Local terminal closed', { sessionId: session.id, reason });
  }
}
