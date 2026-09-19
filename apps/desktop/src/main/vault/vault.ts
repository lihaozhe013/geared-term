import {
  createCipheriv,
  createDecipheriv,
  pbkdf2Sync,
  randomBytes,
  timingSafeEqual
} from 'node:crypto';
import { EncryptedSecretSchema, type EncryptedSecret } from '../persistence/schema';

const kdfIterations = 600_000;
const keyLength = 32;
const nonceLength = 12;

export type VaultMetadata = {
  version: 1;
  kdf: 'pbkdf2-sha256';
  iterations: number;
  salt: string;
};

export function createVaultMetadata(): VaultMetadata {
  return {
    version: 1,
    kdf: 'pbkdf2-sha256',
    iterations: kdfIterations,
    salt: randomBytes(16).toString('base64')
  };
}

function deriveKey(password: string, metadata: VaultMetadata): Buffer {
  if (password.length === 0) {
    throw new Error('Master password cannot be empty');
  }
  return pbkdf2Sync(
    password,
    Buffer.from(metadata.salt, 'base64'),
    metadata.iterations,
    keyLength,
    'sha256'
  );
}

function aad(purpose: string): Buffer {
  return Buffer.from(`geared-term:v1:${purpose}`, 'utf8');
}

export class Vault {
  private key: Buffer | undefined;

  public constructor(public readonly metadata: VaultMetadata = createVaultMetadata()) {}

  public get isUnlocked(): boolean {
    return this.key !== undefined;
  }

  public initialize(password: string): void {
    if (this.key) {
      throw new Error('Vault is already unlocked');
    }
    this.key = deriveKey(password, this.metadata);
  }

  public unlock(password: string, verifier?: EncryptedSecret): void {
    const candidate = deriveKey(password, this.metadata);
    if (verifier) {
      try {
        this.decryptWithKey(candidate, verifier);
      } catch {
        candidate.fill(0);
        throw new Error('Master password is incorrect');
      }
    }
    this.key?.fill(0);
    this.key = candidate;
  }

  public lock(): void {
    this.key?.fill(0);
    this.key = undefined;
  }

  public encrypt(purpose: string, plaintext: string): EncryptedSecret {
    const key = this.requireKey();
    const nonce = randomBytes(nonceLength);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    const associatedData = aad(purpose);
    cipher.setAAD(associatedData);
    const ciphertext = Buffer.concat([
      cipher.update(Buffer.from(plaintext, 'utf8')),
      cipher.final()
    ]);
    return EncryptedSecretSchema.parse({
      version: 1,
      algorithm: 'aes-256-gcm',
      nonce: nonce.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      purpose
    });
  }

  public decrypt(secret: EncryptedSecret): string {
    return this.decryptWithKey(this.requireKey(), secret).toString('utf8');
  }

  public createVerifier(): EncryptedSecret {
    return this.encrypt('vault-verifier', 'geared-term-vault-ok');
  }

  private decryptWithKey(key: Buffer, rawSecret: EncryptedSecret): Buffer {
    const secret = EncryptedSecretSchema.parse(rawSecret);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(secret.nonce, 'base64'));
    decipher.setAAD(aad(secret.purpose));
    decipher.setAuthTag(Buffer.from(secret.tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(secret.ciphertext, 'base64')),
      decipher.final()
    ]);
  }

  private requireKey(): Buffer {
    if (!this.key) {
      throw new Error('Vault is locked');
    }
    return this.key;
  }
}

export function verifyDerivedKeyEquality(first: Buffer, second: Buffer): boolean {
  return first.length === second.length && timingSafeEqual(first, second);
}
