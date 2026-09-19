import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Logger } from '../logging';

export type HostKeyStatus = 'unknown' | 'match' | 'changed';

export type KnownHostEntry = {
  host: string;
  port: number;
  keyType: string;
  keyBase64: string;
  fingerprint: string;
  addedAt: string;
};

type KnownHostsFile = {
  schemaVersion: 1;
  entries: KnownHostEntry[];
};

function hostKey(host: string, port: number): string {
  return `${host.toLowerCase()}:${port}`;
}

export function fingerprintSha256(key: Buffer): string {
  return `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/u, '')}`;
}

export class KnownHostsStore {
  private entries = new Map<string, KnownHostEntry>();
  private loaded = false;
  private writeChain: Promise<void> = Promise.resolve();

  public constructor(
    private readonly path: string,
    private readonly logger: Logger
  ) {}

  public async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as Partial<KnownHostsFile>;
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.entries))
        throw new Error('Unsupported known-hosts schema');
      for (const entry of parsed.entries) {
        if (this.isEntry(entry)) this.entries.set(hostKey(entry.host, entry.port), entry);
      }
    } catch (error) {
      this.logger.info('ssh', 'No usable known-hosts store found; starting empty', {
        error: String(error)
      });
    }
  }

  public async verify(
    host: string,
    port: number,
    key: Buffer
  ): Promise<{ status: HostKeyStatus; fingerprint: string; stored?: KnownHostEntry }> {
    await this.load();
    const stored = this.entries.get(hostKey(host, port));
    const fingerprint = fingerprintSha256(key);
    if (!stored) return { status: 'unknown', fingerprint };
    return {
      status: stored.keyBase64 === key.toString('base64') ? 'match' : 'changed',
      fingerprint,
      stored
    };
  }

  public async approve(host: string, port: number, keyType: string, key: Buffer): Promise<void> {
    await this.load();
    const entry: KnownHostEntry = {
      host,
      port,
      keyType,
      keyBase64: key.toString('base64'),
      fingerprint: fingerprintSha256(key),
      addedAt: new Date().toISOString()
    };
    this.entries.set(hostKey(host, port), entry);
    await this.persist();
  }

  public async replace(
    host: string,
    port: number,
    keyType: string,
    key: Buffer,
    expectedOldBase64: string
  ): Promise<void> {
    await this.load();
    const current = this.entries.get(hostKey(host, port));
    if (!current || current.keyBase64 !== expectedOldBase64) {
      throw new Error('Known host changed while it was awaiting approval');
    }
    await this.approve(host, port, keyType, key);
  }

  public snapshot(): KnownHostEntry[] {
    return [...this.entries.values()].map((entry) => ({ ...entry }));
  }

  private async persist(): Promise<void> {
    const operation = this.writeChain.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.tmp`;
      const payload: KnownHostsFile = { schemaVersion: 1, entries: this.snapshot() };
      await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600
      });
      await rename(temporary, this.path);
    });
    this.writeChain = operation.catch(() => undefined);
    await operation;
  }

  private isEntry(value: unknown): value is KnownHostEntry {
    if (!value || typeof value !== 'object') return false;
    const entry = value as Partial<KnownHostEntry>;
    return (
      typeof entry.host === 'string' &&
      typeof entry.port === 'number' &&
      Number.isInteger(entry.port) &&
      typeof entry.keyType === 'string' &&
      typeof entry.keyBase64 === 'string' &&
      typeof entry.fingerprint === 'string' &&
      typeof entry.addedAt === 'string'
    );
  }
}
