import { existsSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
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

function countSecretRows(directory: string): number {
  const database = new Database(join(directory, 'geared-term.db'));
  try {
    return (database.prepare('SELECT COUNT(*) AS c FROM secrets').get() as { c: number }).c;
  } finally {
    database.close();
  }
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
    await storage.saveSettings({
      ...storage.settingsSnapshot(),
      language: 'zh-CN',
      terminalFontSize: 16,
      terminalCursor: 'bar'
    });

    const reloaded = new AppStorage(directory, testLogger());
    await reloaded.load();
    expect(reloaded.profileSnapshot()).toHaveLength(1);
    expect(reloaded.profileSnapshot()[0]?.name).toBe('Development shell');
    expect(reloaded.uiStateSnapshot().sidebarCollapsed).toBe(true);
    expect(reloaded.uiStateSnapshot().bounds?.width).toBe(1200);
    expect(reloaded.settingsSnapshot().language).toBe('zh-CN');
    expect(reloaded.settingsSnapshot().terminalFontSize).toBe(16);
    expect(reloaded.settingsSnapshot().terminalCursor).toBe('bar');

    await reloaded.saveEnvironment({
      id: 'env-local',
      targetKey: 'local',
      kind: 'local',
      facts: { os: 'Windows', hostname: 'devbox' },
      notes: 'Development machine',
      instructions: 'Use the project virtual environment.',
      attachToAi: true,
      detectedAt: '2026-09-19T00:00:00.000Z'
    });
    expect(reloaded.environmentSnapshot()[0]?.facts.hostname).toBe('devbox');

    const environmentReload = new AppStorage(directory, testLogger());
    await environmentReload.load();
    expect(environmentReload.environmentSnapshot()[0]?.notes).toBe('Development machine');

    await reloaded.deleteProfile('local-dev');
    expect(reloaded.profileSnapshot()).toEqual([]);
  });

  it('keeps SSH credentials encrypted and resolves them only in the main process', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'geared-term-app-storage-secrets-'));
    const storage = new AppStorage(directory, testLogger());
    await storage.load();
    await storage.initializeVault('correct horse battery staple');
    const passwordRef = await storage.saveSecret('ssh-password', 'remote-password');
    await storage.saveProfile({
      id: 'remote-prod',
      kind: 'ssh',
      name: 'Production',
      term: 'xterm-256color',
      host: 'server.example.test',
      port: 22,
      user: 'deploy',
      secretRefs: { password: passwordRef }
    });

    const request = storage.resolveSshProfile('remote-prod', 'session-1', 80, 24);
    expect(request.password).toBe('remote-password');
    expect(JSON.stringify(storage.profileSnapshot())).not.toContain('remote-password');

    await storage.saveAiConnection({
      name: 'Local model',
      protocol: 'chat-completions',
      baseUrl: 'http://127.0.0.1:11434/v1',
      model: 'local-model',
      apiKey: 'ai-secret'
    });
    expect(storage.aiConnectionsSnapshot()[0]?.apiKeyRef).toBeTruthy();
    expect(storage.resolveAiConnection(storage.aiConnectionsSnapshot()[0]!.id, '').apiKey).toBe(
      'ai-secret'
    );

    storage.lockVault();
    expect(() => storage.resolveSshProfile('remote-prod', 'session-2', 80, 24)).toThrow(
      'Vault is locked'
    );
  });

  it('saves SSH profile credentials through the profile boundary and prunes replaced secrets', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'geared-term-profile-credentials-'));
    const storage = new AppStorage(directory, testLogger());
    await storage.load();
    await storage.initializeVault('correct horse battery staple');

    const profile = {
      id: 'remote-editable',
      kind: 'ssh' as const,
      name: 'Editable remote',
      term: 'xterm-256color' as const,
      host: 'server.example.test',
      port: 2200,
      user: 'operator'
    };
    await storage.saveProfileWithCredentials(profile, { password: 'first-password' });
    expect(JSON.stringify(storage.profileSnapshot())).not.toContain('first-password');
    expect(storage.resolveSshProfile(profile.id, 'session-1', 80, 24).password).toBe(
      'first-password'
    );

    await storage.saveProfileWithCredentials(profile, { password: 'second-password' });
    expect(storage.resolveSshProfile(profile.id, 'session-2', 80, 24).password).toBe(
      'second-password'
    );
    expect(await countSecretRows(directory)).toBe(1);

    await storage.deleteProfile(profile.id);
    expect(await countSecretRows(directory)).toBe(0);
  });

  it('does not allow a saved profile to change session type', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'geared-term-profile-kind-'));
    const storage = new AppStorage(directory, testLogger());
    await storage.load();
    await storage.saveProfile({
      id: 'local-session',
      kind: 'local',
      name: 'Local',
      term: 'xterm-256color'
    });

    await expect(
      storage.saveProfile({
        id: 'local-session',
        kind: 'ssh',
        name: 'Local as SSH',
        term: 'xterm-256color',
        host: 'server.example.test',
        user: 'operator'
      })
    ).rejects.toThrow('Session type cannot be changed');
  });

  it('adopts an existing profile.json into the SQLite store once', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'geared-term-profile-adoption-'));
    const legacy = {
      schemaVersion: 1,
      sessions: [
        {
          id: 'legacy-local',
          kind: 'local',
          name: 'Legacy shell',
          term: 'xterm-256color',
          shell: 'bash'
        }
      ],
      secrets: {},
      aiConnections: [],
      environments: []
    };
    await writeFile(join(directory, 'profile.json'), JSON.stringify(legacy), 'utf8');

    const storage = new AppStorage(directory, testLogger());
    await storage.load();
    expect(storage.profileSnapshot()).toHaveLength(1);
    expect(storage.profileSnapshot()[0]?.name).toBe('Legacy shell');
    expect(existsSync(join(directory, 'profile.json'))).toBe(false);
    expect(existsSync(join(directory, 'profile.json.migrated'))).toBe(true);

    // The migrated marker must not be re-imported on the next launch.
    const reloaded = new AppStorage(directory, testLogger());
    await reloaded.load();
    expect(reloaded.profileSnapshot()).toHaveLength(1);
  });
});
