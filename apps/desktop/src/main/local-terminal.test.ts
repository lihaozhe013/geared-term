import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MessagePortMain } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import type { Logger } from './logging';
import { LocalTerminalManager, localPtySpawnOptions } from './local-terminal';

const ptyMock = vi.hoisted(() => ({
  spawn: vi.fn()
}));

vi.mock('node-pty', () => ({
  spawn: ptyMock.spawn
}));

function logger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  } as unknown as Logger;
}

function port() {
  type PortEvent = { data: unknown };
  const listeners = new Map<string, (event: PortEvent) => void>();
  const port = {
    start: vi.fn(),
    on: vi.fn((event: string, listener: (event: PortEvent) => void) => {
      listeners.set(event, listener);
      return port;
    }),
    postMessage: vi.fn(),
    close: vi.fn()
  };
  return {
    port: port as unknown as MessagePortMain,
    postMessage: port.postMessage,
    emitMessage: (data: unknown) => listeners.get('message')?.({ data }),
    emitClose: () => listeners.get('close')?.({ data: undefined })
  };
}

function mockPty(overrides: { write?: () => void; resize?: () => void } = {}) {
  let exitHandler: ((event: { exitCode: number; signal: number }) => void) | undefined;
  const pty = {
    onData: vi.fn(() => ({ dispose: vi.fn() })),
    onExit: vi.fn((listener: (event: { exitCode: number; signal: number }) => void) => {
      exitHandler = listener;
      return { dispose: vi.fn() };
    }),
    write: vi.fn(overrides.write),
    resize: vi.fn(overrides.resize),
    kill: vi.fn()
  };
  return {
    pty,
    emitExit: (event = { exitCode: 0, signal: 0 }) => exitHandler?.(event)
  };
}

const request = (cwd: string) => ({
  sessionId: 'local-1',
  shell: 'cmd.exe',
  args: [],
  cwd,
  cols: 80,
  rows: 24,
  term: 'xterm-256color' as const
});

describe('LocalTerminalManager', () => {
  it('stores the resolved startup cwd and invalidates it after close', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'geared-local-terminal-'));
    const terminal = mockPty();
    ptyMock.spawn.mockReturnValue(terminal.pty);
    const manager = new LocalTerminalManager(logger());

    manager.create(request(cwd), port().port);

    expect(manager.workingDirectory('local-1')).toBe(cwd);
    expect(manager.workingDirectory('missing')).toBeNull();

    manager.closeAll();

    expect(manager.workingDirectory('local-1')).toBeNull();
  });

  it('enables the bundled ConPTY backend only for Windows x64', () => {
    const input = request('C:\\work');

    expect(localPtySpawnOptions(input, input.cwd, {}, 'win32', 'x64')).toMatchObject({
      useConptyDll: true
    });
    expect(localPtySpawnOptions(input, input.cwd, {}, 'win32', 'arm64')).not.toHaveProperty(
      'useConptyDll'
    );
    expect(localPtySpawnOptions(input, input.cwd, {}, 'linux', 'x64')).not.toHaveProperty(
      'useConptyDll'
    );
  });

  it('does not kill the PTY when the renderer closes after a natural exit', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'geared-local-terminal-'));
    const terminal = mockPty();
    const channel = port();
    ptyMock.spawn.mockReturnValue(terminal.pty);
    const manager = new LocalTerminalManager(logger());

    manager.create(request(cwd), channel.port);
    terminal.emitExit();
    channel.emitMessage({ kind: 'input', data: 'late input' });
    channel.emitMessage({ kind: 'resize', cols: 100, rows: 30 });
    channel.emitClose();

    expect(terminal.pty.kill).not.toHaveBeenCalled();
    expect(terminal.pty.write).not.toHaveBeenCalled();
    expect(terminal.pty.resize).not.toHaveBeenCalled();
    expect(manager.workingDirectory('local-1')).toBeNull();
    expect(channel.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'exited', detail: 'exitCode=0; signal=0' })
    );
  });

  it.each([
    ['write', () => { throw new Error('pipe is closed'); }],
    ['resize', () => { throw new Error('pipe is closed'); }]
  ] as const)('reports a PTY %s failure during exit without an uncaught error', async (operation, fail) => {
    const cwd = await mkdtemp(join(tmpdir(), 'geared-local-terminal-'));
    const terminal = mockPty(operation === 'write' ? { write: fail } : { resize: fail });
    const channel = port();
    const appLogger = logger();
    ptyMock.spawn.mockReturnValue(terminal.pty);
    const manager = new LocalTerminalManager(appLogger);

    manager.create(request(cwd), channel.port);
    expect(() => {
      if (operation === 'write') {
        manager.sendInput('local-1', 'exit\r');
      } else {
        channel.emitMessage({ kind: 'resize', cols: 100, rows: 30 });
      }
    }).not.toThrow();
    terminal.emitExit();

    expect(appLogger.error).toHaveBeenCalledWith(
      'terminal',
      'Local terminal operation failed',
      expect.objectContaining({ operation, error: 'pipe is closed' })
    );
    expect(channel.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'failed', detail: `Terminal ${operation} failed: pipe is closed` })
    );
    expect(terminal.pty.kill).toHaveBeenCalledTimes(1);
  });
});
