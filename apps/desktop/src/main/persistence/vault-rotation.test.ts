import { existsSync, mkdtempSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { AppStorage } from './app-storage';
import type { SafeStorageAdapter } from '../vault/auto-unlock';
import type { Logger } from '../logging';

function testLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  } as unknown as Logger;
}

function fakeSafeStorage(shouldFail = false): SafeStorageAdapter {
  return {
    isEncryptionAvailable: () => !shouldFail,
    encryptString: (plaintext) => Buffer.from(`enc:${plaintext}`, 'utf8'),
    decryptString: (encrypted) => {
      const text = encrypted.toString('utf8');
      if (!text.startsWith('enc:')) throw new Error('not encrypted');
      return text.slice(4);
    }
  };
}

function countSecretRows(directory: string): number {
  const database = new Database(join(directory, 'geared-term.db'));
  try {
    return (database.prepare('SELECT COUNT(*) AS c FROM secrets').get() as { c: number }).c;
  } finally {
    database.close();
  }
}

describe('vault rotation', () => {
  it('re-encrypts all secrets and invalidates the old password', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'geared-term-rotate-ok-'));
    const storage = new AppStorage(directory, testLogger());
    await storage.load();
    await storage.initializeVault('old-password');
    await storage.saveSecret('ssh-password:p1', 'secret-one');
    const aiRef = await storage.saveSecret('ai-api-key:c1', 'secret-two');

    await storage.rotateVault('old-password', 'new-password');

    expect(storage.vaultStatus().unlocked).toBe(true);
    expect(storage.readSecret(aiRef)).toBe('secret-two');
    expect(countSecretRows(directory)).toBe(2);

    const restarted = new AppStorage(directory, testLogger());
    await restarted.load();
    await expect(restarted.unlockVault('old-password')).rejects.toThrow(
      'Master password is incorrect'
    );
    await restarted.unlockVault('new-password');
    expect(restarted.readSecret(aiRef)).toBe('secret-two');
  });

  it('rejects rotation with a wrong old password', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'geared-term-rotate-bad-'));
    const storage = new AppStorage(directory, testLogger());
    await storage.load();
    await storage.initializeVault('old-password');
    await expect(storage.rotateVault('wrong', 'next')).rejects.toThrow(
      'Master password is incorrect'
    );
    storage.lockVault();
    await storage.unlockVault('old-password');
    expect(storage.vault.isUnlocked).toBe(true);
  });

  it('restores the previous secrets when writing vault metadata fails', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'geared-term-rotate-fail-'));
    const storage = new AppStorage(directory, testLogger());
    await storage.load();
    await storage.initializeVault('old-password');
    const ref = await storage.saveSecret('ssh-password:p1', 'secret-one');

    const failing = new AppStorage(directory, testLogger());
    await failing.load();
    await failing.unlockVault('old-password');
    const originalSave = failing.vaultState.save.bind(failing.vaultState);
    failing.vaultState.save = async () => {
      throw new Error('disk full');
    };
    await expect(failing.rotateVault('old-password', 'new-password')).rejects.toThrow('disk full');
    failing.vaultState.save = originalSave;

    await failing.unlockVault('old-password');
    expect(failing.readSecret(ref)).toBe('secret-one');
  });
});

describe('auto unlock', () => {
  it('unlocks without a password after restart and honors lock suppression', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'geared-term-auto-ok-'));
    const adapter = fakeSafeStorage();
    const first = new AppStorage(directory, testLogger(), adapter);
    await first.load();
    expect(first.autoUnlockStatus()).toMatchObject({ supported: true, enabled: false });
    await first.initializeVault('master-password');
    first.enableAutoUnlock();
    expect(first.autoUnlockStatus().enabled).toBe(true);
    first.lockVault();
    expect(first.autoUnlockStatus().enabled).toBe(false);

    const second = new AppStorage(directory, testLogger(), adapter);
    await second.load();
    expect(second.vaultStatus().unlocked).toBe(true);
    const ref = await second.saveSecret('ssh-password:p9', 'post-restart');
    expect(second.readSecret(ref)).toBe('post-restart');

    second.disableAutoUnlock();
    expect(second.autoUnlockStatus().enabled).toBe(false);
    expect(existsSync(join(directory, 'vault-auto.key'))).toBe(false);

    const third = new AppStorage(directory, testLogger(), adapter);
    await third.load();
    expect(third.vaultStatus().unlocked).toBe(false);
  });

  it('reports unsupported environments without enabling the feature', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'geared-term-auto-unsupported-'));
    const storage = new AppStorage(directory, testLogger(), fakeSafeStorage(true));
    await storage.load();
    await storage.initializeVault('master-password');
    expect(storage.autoUnlockStatus()).toMatchObject({ supported: false, enabled: false });
    expect(() => storage.enableAutoUnlock()).toThrow(/OS-protected storage is unavailable/);
    expect(existsSync(join(directory, 'vault-auto.key'))).toBe(false);
  });

  it('re-wraps the vault key when the master password rotates', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'geared-term-auto-rotate-'));
    const adapter = fakeSafeStorage();
    const storage = new AppStorage(directory, testLogger(), adapter);
    await storage.load();
    await storage.initializeVault('old-password');
    storage.enableAutoUnlock();
    await storage.rotateVault('old-password', 'new-password');
    expect(storage.autoUnlockStatus().enabled).toBe(true);

    const restarted = new AppStorage(directory, testLogger(), adapter);
    await restarted.load();
    expect(restarted.vaultStatus().unlocked).toBe(true);
    void readFile;
  });
});
