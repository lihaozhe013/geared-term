import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { AppStorage } from './app-storage';
import type { Logger } from '../logging';

function testLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  } as unknown as Logger;
}

describe('application storage', () => {
  it('persists non-secret session profiles and UI state', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'geared-term-app-storage-'));
    const storage = new AppStorage(directory, testLogger());
    await storage.load();

    await storage.saveProfile({
      id: 'local-dev',
      kind: 'local',
      name: 'Development shell',
      term: 'xterm-256color',
      shell: 'pwsh.exe',
      args: ['-NoLogo'],
      cwd: directory
    });
    await storage.saveUiState({
      ...storage.uiStateSnapshot(),
      sidebarCollapsed: true,
      bounds: { x: 10, y: 20, width: 1200, height: 800 }
    });

    const reloaded = new AppStorage(directory, testLogger());
    await reloaded.load();
    expect(reloaded.profileSnapshot()).toHaveLength(1);
    expect(reloaded.profileSnapshot()[0]?.name).toBe('Development shell');
    expect(reloaded.uiStateSnapshot().sidebarCollapsed).toBe(true);
    expect(reloaded.uiStateSnapshot().bounds?.width).toBe(1200);

    await reloaded.deleteProfile('local-dev');
    expect(reloaded.profileSnapshot()).toEqual([]);
  });
});
