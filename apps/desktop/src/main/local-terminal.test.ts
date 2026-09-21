import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { MessagePortMain } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import type { Logger } from './logging';
import { LocalTerminalManager } from './local-terminal';

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

function port(): MessagePortMain {
  return {
    start: vi.fn(),
    on: vi.fn(),
    postMessage: vi.fn(),
    close: vi.fn()
  } as unknown as MessagePortMain;
}

describe('LocalTerminalManager working directories', () => {
  it('stores the resolved startup cwd and invalidates it after close', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'geared-local-terminal-'));
    const dispose = vi.fn();
    ptyMock.spawn.mockReturnValue({
      onData: vi.fn(() => ({ dispose })),
      onExit: vi.fn(() => ({ dispose })),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn()
    });
    const manager = new LocalTerminalManager(logger());

    manager.create(
      {
        sessionId: 'local-1',
        shell: '/bin/sh',
        args: [],
        cwd,
        cols: 80,
        rows: 24,
        term: 'xterm-256color'
      },
      port()
    );

    expect(manager.workingDirectory('local-1')).toBe(cwd);
    expect(manager.workingDirectory('missing')).toBeNull();

    manager.closeAll();

    expect(manager.workingDirectory('local-1')).toBeNull();
  });
});
