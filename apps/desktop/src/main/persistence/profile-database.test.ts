import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { ProfileDatabase, profileDatabaseSchemaVersion } from './profile-database';
import type { Logger } from '../logging';

function testLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  } as unknown as Logger;
}

const secret = {
  version: 1 as const,
  algorithm: 'aes-256-gcm' as const,
  nonce: 'bm9uY2U=',
  tag: 'dGFn',
  ciphertext: 'Y2lwaGVydGV4dA==',
  purpose: 'ssh-password:p1'
};

function sshProfile(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    kind: 'ssh' as const,
    name: 'build',
    term: 'xterm-256color' as const,
    host: 'example.test',
    user: 'deploy',
    port: 22,
    secretRefs: { password: 's1' },
    ...overrides
  };
}

let root: string;
let logger: Logger;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'geared-term-profiledb-'));
  logger = testLogger();
});

afterEach(async () => {
  vi.restoreAllMocks();
});

describe('profile database', () => {
  it('creates schema version 1 and round-trips every record type', () => {
    const database = new ProfileDatabase(root, logger);
    expect(database.listProfiles()).toEqual([]);

    database.putSecret('s1', secret);
    database.upsertProfile(sshProfile(), '2026-01-01T00:00:00.000Z');
    database.upsertAiConnection(
      {
        id: 'conn1',
        name: 'assistant',
        protocol: 'responses',
        baseUrl: 'https://api.example.test/v1',
        models: [{ id: 'm1', model: 'm1' }],
        defaultModel: 'm1',
        apiKeyRef: undefined
      },
      '2026-01-01T00:00:00.000Z'
    );
    database.upsertEnvironment(
      {
        id: 'env1',
        targetKey: 'deploy@example.test:22',
        kind: 'ssh',
        facts: { os: 'Linux' },
        notes: 'n',
        instructions: 'i',
        attachToAi: true,
        verified: false,
        detectedAt: null
      },
      '2026-01-01T00:00:00.000Z'
    );

    const loaded = database.getProfileRow('p1');
    expect(loaded).toMatchObject({ id: 'p1', kind: 'ssh', host: 'example.test', port: 22 });
    expect(loaded?.secretRefs).toEqual({ password: 's1' });
    expect(database.getSecret('s1')).toEqual(secret);
    expect(database.listAiConnections()[0]?.models).toEqual([{ id: 'm1', model: 'm1' }]);
    expect(database.listEnvironments()[0]?.facts).toEqual({ os: 'Linux' });

    const reopened = new ProfileDatabase(root, logger);
    expect(reopened.listProfiles()).toHaveLength(1);
    reopened.close();
    database.close();
  });

  it('sweeps secrets that are no longer referenced', () => {
    const database = new ProfileDatabase(root, logger);
    database.putSecret('s1', secret);
    database.putSecret('s2', { ...secret, purpose: 'ai-api-key:conn1' });
    database.upsertProfile(sshProfile(), '2026-01-01T00:00:00.000Z');
    database.upsertAiConnection(
      {
        id: 'conn1',
        name: 'assistant',
        protocol: 'responses',
        baseUrl: 'https://api.example.test/v1',
        models: [{ id: 'm1', model: 'm1' }],
        defaultModel: 'm1',
        apiKeyRef: 's2'
      },
      '2026-01-01T00:00:00.000Z'
    );
    database.sweepUnreferencedSecrets();
    expect(database.getSecret('s1')).toBeDefined();
    expect(database.getSecret('s2')).toBeDefined();

    // Removing the AI connection orphans s2; a sweep in the same transaction removes it.
    database.transaction(() => {
      database.deleteAiConnection('conn1');
      database.sweepUnreferencedSecrets();
    });
    expect(database.getSecret('s2')).toBeUndefined();
    expect(database.getSecret('s1')).toBeDefined();

    database.transaction(() => {
      database.deleteProfile('p1');
      database.sweepUnreferencedSecrets();
    });
    expect(database.getSecret('s1')).toBeUndefined();
    database.close();
  });

  it('normalizes legacy string model rows without granting endpoint consent', () => {
    const database = new ProfileDatabase(root, logger);
    database.upsertAiConnection(
      {
        id: 'legacy-connection',
        name: 'Legacy assistant',
        protocol: 'responses',
        baseUrl: 'https://api.example.test/v1',
        models: [{ id: 'legacy-model', model: 'legacy-model' }],
        defaultModel: 'legacy-model'
      },
      '2026-01-01T00:00:00.000Z'
    );
    database.close();

    const raw = new Database(join(root, 'geared-term.db'));
    raw
      .prepare('UPDATE ai_connections SET models = ? WHERE id = ?')
      .run(JSON.stringify(['legacy-model']), 'legacy-connection');
    raw.close();

    const reopened = new ProfileDatabase(root, logger);
    expect(reopened.listAiConnections()[0]?.models).toEqual([
      { id: 'legacy-model', model: 'legacy-model' }
    ]);
    expect(reopened.listAiConnections()[0]?.acceptedEndpoint).toBeUndefined();
    reopened.close();
  });

  it('rolls back the whole transaction when a mutation fails mid-flight', () => {
    const database = new ProfileDatabase(root, logger);
    database.putSecret('s1', secret);
    expect(() =>
      database.transaction(() => {
        database.upsertProfile(sshProfile(), '2026-01-01T00:00:00.000Z');
        database.upsertProfile(sshProfile({ id: 'p2' }), '2026-01-01T00:00:00.000Z');
        throw new Error('boom');
      })
    ).toThrow('boom');
    expect(database.listProfiles()).toEqual([]);
    database.close();
  });

  it('quarantines a corrupt database instead of opening it', async () => {
    new ProfileDatabase(root, logger).close();
    const dbPath = join(root, 'geared-term.db');
    await (async () => {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(dbPath, 'this is not a sqlite database'.repeat(40), 'utf8');
    })();
    expect(() => new ProfileDatabase(root, logger)).toThrow(/quarantined/);
    const files = await readdir(root);
    expect(files.some((file) => file.includes('corrupt-'))).toBe(true);
    // The quarantine path leaves a usable fresh database behind.
    const recovered = new ProfileDatabase(root, logger);
    expect(recovered.listProfiles()).toEqual([]);
    recovered.close();
  });

  it('refuses a database written by a newer schema version', async () => {
    new ProfileDatabase(root, logger).close();
    const raw = new Database(join(root, 'geared-term.db'));
    raw
      .prepare("UPDATE schema_info SET value = ? WHERE key = 'schema_version'")
      .run(String(profileDatabaseSchemaVersion + 1));
    raw.close();
    expect(() => new ProfileDatabase(root, logger)).toThrow(/newer than supported/);
    const files = await readdir(root);
    expect(files.some((file) => file.includes('corrupt-'))).toBe(true);
  });

  it('backs up the database before applying migrations', async () => {
    new ProfileDatabase(root, logger).close();
    // Simulate an older schema: version 0 with an empty schema_info table.
    const raw = new Database(join(root, 'geared-term.db'));
    raw.prepare("UPDATE schema_info SET value = '0' WHERE key = 'schema_version'").run();
    raw.close();
    // Version 0 has no tables according to the migration list, so recreating
    // the store must re-apply migration 1 after a backup was taken.
    expect(() => new ProfileDatabase(root, logger)).toThrow();
    const files = await readdir(root);
    expect(files.some((file) => file.startsWith('geared-term.db.pre-migration-'))).toBe(true);
  });

  it('rejects environment target key collisions across ids', () => {
    const database = new ProfileDatabase(root, logger);
    const environment = {
      id: 'env1',
      targetKey: 'local',
      kind: 'local' as const,
      facts: {},
      notes: '',
      instructions: '',
      attachToAi: false,
      verified: false,
      detectedAt: null
    };
    database.upsertEnvironment(environment, '2026-01-01T00:00:00.000Z');
    expect(() =>
      database.upsertEnvironment({ ...environment, id: 'env2' }, '2026-01-01T00:00:00.000Z')
    ).toThrow();
    database.close();
  });

  it('keeps argument arrays as JSON round trips', () => {
    const database = new ProfileDatabase(root, logger);
    database.upsertProfile(
      {
        id: 'l1',
        kind: 'local',
        name: 'shell',
        term: 'xterm-256color',
        shell: 'pwsh.exe',
        args: ['-NoLogo', '-File', 'C:\\Program Files\\x\\run.ps1']
      },
      '2026-01-01T00:00:00.000Z'
    );
    expect(database.listProfiles()[0]?.args).toEqual([
      '-NoLogo',
      '-File',
      'C:\\Program Files\\x\\run.ps1'
    ]);
    database.close();
  });

  it('logs and quarantines via the injected logger', async () => {
    new ProfileDatabase(root, logger).close();
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(root, 'geared-term.db'), 'garbage'.repeat(100), 'utf8');
    try {
      new ProfileDatabase(root, logger);
    } catch {
      /* expected */
    }
    expect(vi.mocked(logger.error)).toHaveBeenCalled();
    const quarantined = (await readdir(root)).find((file) => file.includes('corrupt-'));
    expect(quarantined).toBeDefined();
    const content = await readFile(join(root, quarantined as string), 'utf8');
    expect(content).toContain('garbage');
  });
});
