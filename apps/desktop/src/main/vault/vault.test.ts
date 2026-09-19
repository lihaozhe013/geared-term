import { describe, expect, it } from 'vitest';
import { Vault } from './vault';

describe('vault', () => {
  it('encrypts and decrypts secrets only while unlocked', () => {
    const vault = new Vault();
    vault.initialize('correct horse battery staple');
    const secret = vault.encrypt('test-password', 'do-not-log-me');
    expect(vault.decrypt(secret)).toBe('do-not-log-me');
    vault.lock();
    expect(() => vault.decrypt(secret)).toThrow('Vault is locked');
  }, 15_000);

  it('rejects a wrong master password without replacing the active key', () => {
    const vault = new Vault();
    vault.initialize('first password');
    const verifier = vault.createVerifier();
    expect(() => vault.unlock('wrong password', verifier)).toThrow('Master password is incorrect');
    expect(vault.decrypt(verifier)).toBe('geared-term-vault-ok');
  }, 15_000);
});
