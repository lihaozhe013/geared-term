import { describe, expect, it, vi } from 'vitest';
import { createSafeStorageAdapter } from './safe-storage-adapter';

function asyncStorage(options: { prefix?: string; decryptedValue?: string; fail?: boolean } = {}) {
  const prefix = options.prefix ?? 'v11';
  return {
    isEncryptionAvailable: vi.fn(() => false),
    encryptString: vi.fn((plainText: string) => Buffer.from(plainText)),
    decryptString: vi.fn((encrypted: Buffer) => encrypted.toString()),
    isAsyncEncryptionAvailable: vi.fn(async () => {
      if (options.fail) throw new Error('key service unavailable');
      return true;
    }),
    encryptStringAsync: vi.fn(async (plainText: string) =>
      Buffer.concat([Buffer.from(prefix), Buffer.from(plainText)])
    ),
    decryptStringAsync: vi.fn(async (encrypted: Buffer) => ({
      result: options.decryptedValue ?? encrypted.subarray(3).toString(),
      shouldReEncrypt: false
    }))
  };
}

describe('createSafeStorageAdapter on Linux', () => {
  it('waits for asynchronous OS storage and verifies protected encryption round-trip', async () => {
    const storage = asyncStorage();
    const adapter = createSafeStorageAdapter(storage, 'linux');

    await expect(adapter.support()).resolves.toEqual({ supported: true });
    expect(storage.isEncryptionAvailable).not.toHaveBeenCalled();
    expect(storage.isAsyncEncryptionAvailable).toHaveBeenCalledOnce();
    expect(storage.decryptStringAsync).toHaveBeenCalledOnce();
  });

  it.each(['v10', 'xxx'])(
    'rejects the unprotected or unknown %s encryption prefix',
    async (prefix) => {
      const storage = asyncStorage({ prefix });
      const adapter = createSafeStorageAdapter(storage, 'linux');

      await expect(adapter.support()).resolves.toMatchObject({
        supported: false,
        reasonCode: 'insecure_storage'
      });
      await expect(adapter.encryptString('secret')).rejects.toThrow(/does not protect data/u);
    }
  );

  it('rejects protected ciphertext whose round-trip does not match', async () => {
    const adapter = createSafeStorageAdapter(
      asyncStorage({ decryptedValue: 'different' }),
      'linux'
    );

    await expect(adapter.support()).resolves.toMatchObject({
      supported: false,
      reasonCode: 'verification_failed'
    });
  });

  it('reports an unavailable key service without exposing exception details', async () => {
    const adapter = createSafeStorageAdapter(asyncStorage({ fail: true }), 'linux');

    await expect(adapter.support()).resolves.toMatchObject({
      supported: false,
      reasonCode: 'service_unavailable'
    });
  });

  it('accepts the OS-protected Secret Portal format', async () => {
    const adapter = createSafeStorageAdapter(asyncStorage({ prefix: 'v12' }), 'linux');

    await expect(adapter.support()).resolves.toEqual({ supported: true });
  });

  it('reads legacy v10 data only after verifying a protected provider is available', async () => {
    const storage = asyncStorage();
    const adapter = createSafeStorageAdapter(storage, 'linux');

    await expect(adapter.decryptString(Buffer.from('v10legacy-secret'))).resolves.toBe(
      'legacy-secret'
    );
    expect(storage.decryptStringAsync).toHaveBeenCalledTimes(2);
  });

  it('does not read legacy v10 data when the current provider is unprotected', async () => {
    const storage = asyncStorage({ prefix: 'v10' });
    const adapter = createSafeStorageAdapter(storage, 'linux');

    await expect(adapter.decryptString(Buffer.from('v10legacy-secret'))).rejects.toThrow(
      /does not protect data/u
    );
    expect(storage.decryptStringAsync).not.toHaveBeenCalled();
  });
});

describe('createSafeStorageAdapter on non-Linux platforms', () => {
  it('keeps the synchronous safeStorage backend and verifies its round-trip', async () => {
    const storage = asyncStorage();
    storage.isEncryptionAvailable.mockReturnValue(true);
    const adapter = createSafeStorageAdapter(storage, 'darwin');

    await expect(adapter.support()).resolves.toEqual({ supported: true });
    expect(storage.isEncryptionAvailable).toHaveBeenCalledOnce();
    expect(storage.isAsyncEncryptionAvailable).not.toHaveBeenCalled();
  });
});
