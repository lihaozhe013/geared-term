import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KnownHostsStore, fingerprintSha256 } from './known-hosts';
import { Logger } from '../logging';

function loggerForTests(directory: string): Logger {
  return new Logger(join(directory, 'logs'));
}

describe('known hosts', () => {
  it('distinguishes unknown, matching, and changed keys', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'geared-term-hosts-'));
    const store = new KnownHostsStore(
      join(directory, 'known-hosts.json'),
      loggerForTests(directory)
    );
    const first = Buffer.from('first-key');
    const second = Buffer.from('second-key');
    expect((await store.verify('example.test', 22, first)).status).toBe('unknown');
    await store.approve('example.test', 22, 'ssh-ed25519', first);
    expect((await store.verify('example.test', 22, first)).status).toBe('match');
    const changed = await store.verify('example.test', 22, second);
    expect(changed.status).toBe('changed');
    expect(changed.stored?.fingerprint).toBe(fingerprintSha256(first));
  });
});
