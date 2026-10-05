import { randomBytes } from 'node:crypto';
import type { AutoUnlockSupport, SafeStorageAdapter } from './auto-unlock';

type ElectronSafeStorage = {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
  isAsyncEncryptionAvailable(): Promise<boolean>;
  encryptStringAsync(plainText: string): Promise<Buffer>;
  decryptStringAsync(encrypted: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>;
};

const osProtectedCiphertextPrefixes = new Set(['v11', 'v12']);
const unavailable: AutoUnlockSupport = {
  supported: false,
  reasonCode: 'service_unavailable',
  reason: 'OS-protected storage is unavailable. Check that the system key service is unlocked.'
};
const insecure: AutoUnlockSupport = {
  supported: false,
  reasonCode: 'insecure_storage',
  reason: 'The selected storage backend does not protect data with the operating system.'
};
const verificationFailed: AutoUnlockSupport = {
  supported: false,
  reasonCode: 'verification_failed',
  reason: 'The operating system key service could not verify encrypted data.'
};

export function createSafeStorageAdapter(
  storage: ElectronSafeStorage,
  platform: NodeJS.Platform = process.platform
): SafeStorageAdapter {
  if (platform === 'linux') {
    const verifyProtectedStorage = async (): Promise<AutoUnlockSupport> => {
      try {
        if (!(await storage.isAsyncEncryptionAvailable())) return unavailable;
        const probe = randomBytes(32).toString('base64');
        const encrypted = await storage.encryptStringAsync(probe);
        if (!isOsProtectedCiphertext(encrypted)) return insecure;
        const decrypted = await storage.decryptStringAsync(encrypted);
        return decrypted.result === probe ? { supported: true } : verificationFailed;
      } catch {
        return unavailable;
      }
    };

    return {
      support: verifyProtectedStorage,
      encryptString: async (plainText) => {
        const encrypted = await storage.encryptStringAsync(plainText);
        if (!isOsProtectedCiphertext(encrypted)) {
          throw new Error(insecure.reason);
        }
        return encrypted;
      },
      decryptString: async (encrypted) => {
        const prefix = encrypted.toString('ascii', 0, 3);
        if (prefix === 'v10') {
          // Existing releases only created v10 material after confirming a real Linux key store.
          // Verify that a protected provider is still available before reading that legacy format.
          const support = await verifyProtectedStorage();
          if (!support.supported) throw new Error(support.reason ?? insecure.reason);
        } else if (!osProtectedCiphertextPrefixes.has(prefix)) {
          throw new Error(insecure.reason);
        }
        return (await storage.decryptStringAsync(encrypted)).result;
      }
    };
  }

  return {
    support: async () => {
      try {
        if (!storage.isEncryptionAvailable()) return unavailable;
        const probe = randomBytes(32).toString('base64');
        const encrypted = storage.encryptString(probe);
        return storage.decryptString(encrypted) === probe
          ? { supported: true }
          : verificationFailed;
      } catch {
        return unavailable;
      }
    },
    encryptString: async (plainText) => storage.encryptString(plainText),
    decryptString: async (encrypted) => storage.decryptString(encrypted)
  };
}

function isOsProtectedCiphertext(encrypted: Buffer): boolean {
  return osProtectedCiphertextPrefixes.has(encrypted.toString('ascii', 0, 3));
}
