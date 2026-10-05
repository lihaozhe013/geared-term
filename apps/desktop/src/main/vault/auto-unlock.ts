import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type SafeStorageAdapter = {
  support(): Promise<AutoUnlockSupport>;
  encryptString(plaintext: string): Promise<Buffer>;
  decryptString(encrypted: Buffer): Promise<string>;
};

export type AutoUnlockReasonCode =
  'service_unavailable' | 'insecure_storage' | 'verification_failed';

export type AutoUnlockSupport = {
  supported: boolean;
  reason?: string;
  reasonCode?: AutoUnlockReasonCode;
};

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

  public async support(): Promise<AutoUnlockSupport> {
    if (!this.safeStorage) {
      return { supported: false, reason: 'OS-protected storage is unavailable in this build' };
    }
    try {
      return await this.safeStorage.support();
    } catch {
      return {
        supported: false,
        reasonCode: 'service_unavailable',
        reason:
          'OS-protected storage is unavailable. Check that the system key service is unlocked.'
      };
    }
  }

  public isEnabled(): boolean {
    return existsSync(this.keyPath) && existsSync(this.wrappedPath);
  }

  public async status(): Promise<AutoUnlockState> {
    return { ...(await this.support()), enabled: this.isEnabled() };
  }

  public async enable(getVaultKey: () => Buffer, isStillValid: () => boolean): Promise<void> {
    const support = await this.support();
    if (!support.supported) {
      throw new Error(support.reason ?? 'Password-free unlock is not supported here');
    }
    const storage = this.safeStorage;
    if (!storage) throw new Error('Password-free unlock is not supported here');
    const kek = randomBytes(keyLength);
    let materialWriteStarted = false;
    try {
      const encryptedKek = await storage.encryptString(kek.toString('base64'));
      if (!isStillValid())
        throw new Error('Vault was locked or changed before auto-unlock finished');
      const vaultKey = getVaultKey();
      let wrapped: WrappedKey;
      try {
        wrapped = this.wrap(vaultKey, kek);
      } finally {
        vaultKey.fill(0);
      }
      if (!isStillValid())
        throw new Error('Vault was locked or changed before auto-unlock finished');
      materialWriteStarted = true;
      writeFileSync(this.keyPath, encryptedKek, { mode: 0o600 });
      writeFileSync(this.wrappedPath, `${JSON.stringify(wrapped, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600
      });
    } catch (error) {
      if (materialWriteStarted) this.removeFiles();
      throw error;
    } finally {
      kek.fill(0);
    }
  }

  public disable(): void {
    this.removeFiles();
  }

  /** Returns the recovered vault key, or undefined when unavailable or corrupt. */
  public async loadVaultKey(): Promise<Buffer | undefined> {
    if (!this.isEnabled()) return undefined;
    const storage = this.safeStorage;
    if (!storage) return undefined;
    try {
      const kek = Buffer.from(await storage.decryptString(readFileSync(this.keyPath)), 'base64');
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
    return Buffer.concat([
      decipher.update(Buffer.from(parsed.ciphertext, 'base64')),
      decipher.final()
    ]);
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
