import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type SafeStorageAdapter = {
  isEncryptionAvailable(): boolean;
  encryptString(plaintext: string): Buffer;
  decryptString(encrypted: Buffer): string;
  /** Linux only: name of the selected backend, when the platform exposes it. */
  selectedStorageBackend?(): string | null | undefined;
};

export type AutoUnlockSupport = { supported: boolean; reason?: string };

export type AutoUnlockState = AutoUnlockSupport & { enabled: boolean };

type WrappedKey = {
  schemaVersion: 1;
  algorithm: 'aes-256-gcm';
  nonce: string;
  tag: string;
  ciphertext: string;
};

const keyLength = 32;
const nonceLength = 12;
const associatedData = Buffer.from('geared-term:v1:auto-unlock-wrap', 'utf8');

export class AutoUnlockStore {
  public constructor(
    private readonly rootDirectory: string,
    private readonly safeStorage: SafeStorageAdapter | undefined
  ) {}

  private get keyPath(): string {
    return join(this.rootDirectory, 'vault-auto.key');
  }

  private get wrappedPath(): string {
    return join(this.rootDirectory, 'vault-auto.json');
  }

  public support(): AutoUnlockSupport {
    if (!this.safeStorage) {
      return { supported: false, reason: 'OS-protected storage is unavailable in this build' };
    }
    try {
      if (!this.safeStorage.isEncryptionAvailable()) {
        return { supported: false, reason: 'OS-protected storage is unavailable' };
      }
    } catch {
      return { supported: false, reason: 'OS-protected storage is unavailable' };
    }
    if (process.platform === 'linux') {
      const backend = this.safeStorage.selectedStorageBackend?.();
      // The basic_text backend obfuscates at best and defeats the device-local
      // trust model; password-free unlock stays off rather than degrade it.
      if (backend === 'basic_text') {
        return {
          supported: false,
          reason: 'No OS key service is available; password-free unlock is disabled'
        };
      }
    }
    return { supported: true };
  }

  public isEnabled(): boolean {
    return existsSync(this.keyPath) && existsSync(this.wrappedPath);
  }

  public status(): AutoUnlockState {
    return { ...this.support(), enabled: this.isEnabled() };
  }

  public enable(vaultKey: Buffer): void {
    const support = this.support();
    if (!support.supported) {
      throw new Error(support.reason ?? 'Password-free unlock is not supported here');
    }
    const storage = this.safeStorage;
    if (!storage) throw new Error('Password-free unlock is not supported here');
    const kek = randomBytes(keyLength);
    const wrapped = this.wrap(vaultKey, kek);
    try {
      writeFileSync(this.keyPath, storage.encryptString(kek.toString('base64')), { mode: 0o600 });
      writeFileSync(
        this.wrappedPath,
        `${JSON.stringify(wrapped, null, 2)}\n`,
        { encoding: 'utf8', mode: 0o600 }
      );
    } catch (error) {
      this.removeFiles();
      throw error;
    } finally {
      kek.fill(0);
    }
  }

  public disable(): void {
    this.removeFiles();
  }

  /** Returns the recovered vault key, or undefined when unavailable or corrupt. */
  public loadVaultKey(): Buffer | undefined {
    if (!this.isEnabled()) return undefined;
    const storage = this.safeStorage;
    if (!storage) return undefined;
    try {
      const kek = Buffer.from(storage.decryptString(readFileSync(this.keyPath)), 'base64');
      try {
        return this.unwrap(readFileSync(this.wrappedPath, 'utf8'), kek);
      } finally {
        kek.fill(0);
      }
    } catch {
      return undefined;
    }
  }

  private wrap(vaultKey: Buffer, kek: Buffer): WrappedKey {
    const nonce = randomBytes(nonceLength);
    const cipher = createCipheriv('aes-256-gcm', kek, nonce);
    cipher.setAAD(associatedData);
    const ciphertext = Buffer.concat([cipher.update(vaultKey), cipher.final()]);
    return {
      schemaVersion: 1,
      algorithm: 'aes-256-gcm',
      nonce: nonce.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64')
    };
  }

  private unwrap(raw: string, kek: Buffer): Buffer {
    const parsed = JSON.parse(raw) as WrappedKey;
    const decipher = createDecipheriv('aes-256-gcm', kek, Buffer.from(parsed.nonce, 'base64'));
    decipher.setAAD(associatedData);
    decipher.setAuthTag(Buffer.from(parsed.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(parsed.ciphertext, 'base64')), decipher.final()]);
  }

  private removeFiles(): void {
    for (const path of [this.keyPath, this.wrappedPath]) {
      try {
        if (existsSync(path)) unlinkSync(path);
      } catch {
        /* best effort cleanup */
      }
    }
  }
}
