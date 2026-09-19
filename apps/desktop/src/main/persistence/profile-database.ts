import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type {
  AiConnectionRecord,
  EnvironmentRecord,
  SessionProfileRecord
} from '@geared-term/protocol';
import type { Logger } from '../logging';
import { EncryptedSecretSchema, type EncryptedSecret } from './schema';

export const profileDatabaseSchemaVersion = 1;

type SecretRow = {
  id: string;
  purpose: string;
  version: number;
  algorithm: string;
  nonce: string;
  tag: string;
  ciphertext: string;
  created_at: string;
};

type ProfileRow = {
  id: string;
  kind: 'local' | 'wsl' | 'ssh';
  name: string;
  group_name: string | null;
  term: string;
  host: string | null;
  port: number | null;
  user_name: string | null;
  shell: string | null;
  arguments: string | null;
  cwd: string | null;
  distribution: string | null;
  environment_id: string | null;
  password_secret_id: string | null;
  private_key_secret_id: string | null;
  passphrase_secret_id: string | null;
};

type AiConnectionRow = {
  id: string;
  name: string;
  protocol: 'responses' | 'chat-completions';
  base_url: string;
  models: string;
  default_model: string;
  api_key_secret_id: string | null;
};

type EnvironmentRow = {
  id: string;
  target_key: string;
  kind: 'local' | 'wsl' | 'ssh';
  facts: string;
  notes: string;
  instructions: string;
  attach_to_ai: number;
  detected_at: string | null;
};

const migrations: Array<{ version: number; statements: string[] }> = [
  {
    version: 1,
    statements: [
      `CREATE TABLE schema_info (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`,
      `CREATE TABLE secrets (
        id TEXT PRIMARY KEY,
        purpose TEXT NOT NULL,
        version INTEGER NOT NULL,
        algorithm TEXT NOT NULL,
        nonce TEXT NOT NULL,
        tag TEXT NOT NULL,
        ciphertext TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE environments (
        id TEXT PRIMARY KEY,
        target_key TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL CHECK (kind IN ('local', 'wsl', 'ssh')),
        facts TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        instructions TEXT NOT NULL DEFAULT '',
        attach_to_ai INTEGER NOT NULL DEFAULT 0,
        detected_at TEXT,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE session_profiles (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('local', 'wsl', 'ssh')),
        name TEXT NOT NULL,
        group_name TEXT,
        term TEXT NOT NULL,
        host TEXT,
        port INTEGER,
        user_name TEXT,
        shell TEXT,
        arguments TEXT,
        cwd TEXT,
        distribution TEXT,
        environment_id TEXT REFERENCES environments(id) ON DELETE SET NULL,
        password_secret_id TEXT REFERENCES secrets(id) ON DELETE SET NULL,
        private_key_secret_id TEXT REFERENCES secrets(id) ON DELETE SET NULL,
        passphrase_secret_id TEXT REFERENCES secrets(id) ON DELETE SET NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE ai_connections (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        protocol TEXT NOT NULL CHECK (protocol IN ('responses', 'chat-completions')),
        base_url TEXT NOT NULL,
        models TEXT NOT NULL,
        default_model TEXT NOT NULL,
        api_key_secret_id TEXT REFERENCES secrets(id) ON DELETE SET NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE INDEX idx_environments_kind ON environments(kind)`,
      `CREATE INDEX idx_session_profiles_group ON session_profiles(group_name)`,
      `INSERT INTO schema_info (key, value) VALUES ('schema_version', '1')`
    ]
  }
];

function createStatements(database: Database.Database) {
  return {
    insertSecret: database.prepare(
      `INSERT INTO secrets (id, purpose, version, algorithm, nonce, tag, ciphertext, created_at)
       VALUES (@id, @purpose, @version, @algorithm, @nonce, @tag, @ciphertext, @created_at)
       ON CONFLICT(id) DO UPDATE SET
         purpose = excluded.purpose,
         version = excluded.version,
         algorithm = excluded.algorithm,
         nonce = excluded.nonce,
         tag = excluded.tag,
         ciphertext = excluded.ciphertext`
    ),
    getSecret: database.prepare('SELECT * FROM secrets WHERE id = ?'),
    deleteSecret: database.prepare('DELETE FROM secrets WHERE id = ?'),
    allSecrets: database.prepare('SELECT * FROM secrets'),
    sweepSecrets: database.prepare(`
      DELETE FROM secrets WHERE id NOT IN (
        SELECT password_secret_id FROM session_profiles WHERE password_secret_id IS NOT NULL
        UNION
        SELECT private_key_secret_id FROM session_profiles WHERE private_key_secret_id IS NOT NULL
        UNION
        SELECT passphrase_secret_id FROM session_profiles WHERE passphrase_secret_id IS NOT NULL
        UNION
        SELECT api_key_secret_id FROM ai_connections WHERE api_key_secret_id IS NOT NULL
      )`),
    upsertProfile: database.prepare(
      `INSERT INTO session_profiles (
         id, kind, name, group_name, term, host, port, user_name, shell, arguments, cwd,
         distribution, environment_id, password_secret_id, private_key_secret_id,
         passphrase_secret_id, updated_at
       ) VALUES (
         @id, @kind, @name, @group_name, @term, @host, @port, @user_name, @shell, @arguments,
         @cwd, @distribution, @environment_id, @password_secret_id, @private_key_secret_id,
         @passphrase_secret_id, @updated_at
       )
       ON CONFLICT(id) DO UPDATE SET
         kind = excluded.kind,
         name = excluded.name,
         group_name = excluded.group_name,
         term = excluded.term,
         host = excluded.host,
         port = excluded.port,
         user_name = excluded.user_name,
         shell = excluded.shell,
         arguments = excluded.arguments,
         cwd = excluded.cwd,
         distribution = excluded.distribution,
         environment_id = excluded.environment_id,
         password_secret_id = excluded.password_secret_id,
         private_key_secret_id = excluded.private_key_secret_id,
         passphrase_secret_id = excluded.passphrase_secret_id,
         updated_at = excluded.updated_at`
    ),
    getProfile: database.prepare('SELECT * FROM session_profiles WHERE id = ?'),
    allProfiles: database.prepare(
      'SELECT * FROM session_profiles ORDER BY datetime(updated_at) ASC, id ASC'
    ),
    deleteProfile: database.prepare('DELETE FROM session_profiles WHERE id = ?'),
    upsertEnvironment: database.prepare(
      `INSERT INTO environments (
         id, target_key, kind, facts, notes, instructions, attach_to_ai, detected_at, updated_at
       ) VALUES (
         @id, @target_key, @kind, @facts, @notes, @instructions, @attach_to_ai, @detected_at,
         @updated_at
       )
       ON CONFLICT(id) DO UPDATE SET
         target_key = excluded.target_key,
         kind = excluded.kind,
         facts = excluded.facts,
         notes = excluded.notes,
         instructions = excluded.instructions,
         attach_to_ai = excluded.attach_to_ai,
         detected_at = excluded.detected_at,
         updated_at = excluded.updated_at`
    ),
    allEnvironments: database.prepare(
      'SELECT * FROM environments ORDER BY datetime(updated_at) ASC, id ASC'
    ),
    deleteEnvironment: database.prepare('DELETE FROM environments WHERE id = ?'),
    upsertAiConnection: database.prepare(
      `INSERT INTO ai_connections (
         id, name, protocol, base_url, models, default_model, api_key_secret_id, updated_at
       ) VALUES (
         @id, @name, @protocol, @base_url, @models, @default_model, @api_key_secret_id,
         @updated_at
       )
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         protocol = excluded.protocol,
         base_url = excluded.base_url,
         models = excluded.models,
         default_model = excluded.default_model,
         api_key_secret_id = excluded.api_key_secret_id,
         updated_at = excluded.updated_at`
    ),
    allAiConnections: database.prepare(
      'SELECT * FROM ai_connections ORDER BY datetime(updated_at) ASC, id ASC'
    ),
    deleteAiConnection: database.prepare('DELETE FROM ai_connections WHERE id = ?')
  };
}

type Statements = ReturnType<typeof createStatements>;

function schemaVersionOf(database: Database.Database): number | null | undefined {
  const tableExists = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_info'")
    .get();
  if (!tableExists) return undefined;
  const row = database
    .prepare("SELECT value FROM schema_info WHERE key = 'schema_version'")
    .get() as { value: string } | undefined;
  if (!row) return undefined;
  const version = Number.parseInt(row.value, 10);
  return Number.isNaN(version) ? null : version;
}

export class ProfileDatabase {
  private readonly database: Database.Database;
  private readonly statements: Statements;

  public constructor(
    rootDirectory: string,
    private readonly logger: Logger,
    fileName = 'geared-term.db'
  ) {
    mkdirSync(rootDirectory, { recursive: true });
    const path = join(rootDirectory, fileName);
    this.database = this.open(path);
    this.migrate(path);
    this.statements = createStatements(this.database);
  }

  private open(path: string): Database.Database {
    let database: Database.Database | undefined;
    try {
      database = new Database(path);
      database.pragma('journal_mode = WAL');
      database.pragma('synchronous = NORMAL');
      database.pragma('foreign_keys = ON');
      database.pragma('busy_timeout = 5000');
      const quickCheck = database.pragma('quick_check', { simple: true }) as string;
      if (quickCheck !== 'ok') {
        throw new Error(`integrity check failed (${quickCheck})`);
      }
      return database;
    } catch (error) {
      try {
        database?.close();
      } catch {
        /* the corrupt handle may already be unusable */
      }
      this.quarantine(path);
      throw new Error(`Profile database was quarantined: ${String(error)}`);
    }
  }

  private migrate(path: string): void {
    const currentVersion = schemaVersionOf(this.database);
    if (currentVersion === null) {
      this.abandon(path, 'unreadable schema version');
    }
    if (currentVersion !== undefined && currentVersion > profileDatabaseSchemaVersion) {
      this.abandon(
        path,
        `schema version ${currentVersion} is newer than supported ${profileDatabaseSchemaVersion}`
      );
    }
    const pending = migrations.filter(
      (migration) => currentVersion === undefined || migration.version > currentVersion
    );
    if (pending.length === 0) return;
    const backup = `${path}.pre-migration-${Date.now()}.bak`;
    this.database.prepare('VACUUM INTO ?').run(backup);
    try {
      for (const migration of pending) {
        this.database.transaction(() => {
          for (const statement of migration.statements) {
            this.database.exec(statement);
          }
        })();
      }
    } catch (error) {
      this.database.close();
      this.quarantine(path);
      throw new Error(`Profile database migration failed and was quarantined: ${String(error)}`);
    }
    this.logger.info('system', 'Profile database migrated', {
      from: currentVersion ?? 0,
      to: profileDatabaseSchemaVersion
    });
  }

  private abandon(path: string, reason: string): never {
    this.database.close();
    this.quarantine(path);
    throw new Error(`Profile database was quarantined: ${reason}`);
  }

  private quarantine(path: string): void {
    const suffix = `corrupt-${Date.now()}`;
    for (const candidate of [path, `${path}-wal`, `${path}-shm`]) {
      if (existsSync(candidate)) {
        renameSync(candidate, `${candidate}.${suffix}`);
      }
    }
    this.logger.error('system', 'Profile database quarantined', { path });
  }

  public transaction<T>(work: () => T): T {
    return this.database.transaction(work)();
  }

  public listSecrets(): Map<string, EncryptedSecret> {
    const result = new Map<string, EncryptedSecret>();
    for (const row of this.statements.allSecrets.all() as SecretRow[]) {
      result.set(row.id, this.secretFromRow(row));
    }
    return result;
  }

  public getSecret(id: string): EncryptedSecret | undefined {
    const row = this.statements.getSecret.get(id) as SecretRow | undefined;
    return row ? this.secretFromRow(row) : undefined;
  }

  public putSecret(id: string, secret: EncryptedSecret): void {
    this.statements.insertSecret.run({
      id,
      purpose: secret.purpose,
      version: secret.version,
      algorithm: secret.algorithm,
      nonce: secret.nonce,
      tag: secret.tag,
      ciphertext: secret.ciphertext,
      created_at: new Date().toISOString()
    });
  }

  public deleteSecret(id: string): void {
    this.statements.deleteSecret.run(id);
  }

  public sweepUnreferencedSecrets(): void {
    this.statements.sweepSecrets.run();
  }

  public upsertProfile(profile: SessionProfileRecord, updatedAt: string): void {
    this.statements.upsertProfile.run({
      id: profile.id,
      kind: profile.kind,
      name: profile.name,
      group_name: profile.group ?? null,
      term: profile.term,
      host: profile.host ?? null,
      port: profile.port ?? null,
      user_name: profile.user ?? null,
      shell: profile.shell ?? null,
      arguments: profile.args ? JSON.stringify(profile.args) : null,
      cwd: profile.cwd ?? null,
      distribution: profile.distribution ?? null,
      environment_id: profile.environmentId ?? null,
      password_secret_id: profile.secretRefs?.password ?? null,
      private_key_secret_id: profile.secretRefs?.privateKey ?? null,
      passphrase_secret_id: profile.secretRefs?.passphrase ?? null,
      updated_at: updatedAt
    });
  }

  public getProfileRow(id: string): SessionProfileRecord | undefined {
    const row = this.statements.getProfile.get(id) as ProfileRow | undefined;
    return row ? this.profileFromRow(row) : undefined;
  }

  public listProfiles(): SessionProfileRecord[] {
    return (this.statements.allProfiles.all() as ProfileRow[]).map((row) =>
      this.profileFromRow(row)
    );
  }

  public deleteProfile(id: string): void {
    this.statements.deleteProfile.run(id);
  }

  public upsertEnvironment(environment: EnvironmentRecord, updatedAt: string): void {
    this.statements.upsertEnvironment.run({
      id: environment.id,
      target_key: environment.targetKey,
      kind: environment.kind,
      facts: JSON.stringify(environment.facts),
      notes: environment.notes,
      instructions: environment.instructions,
      attach_to_ai: environment.attachToAi ? 1 : 0,
      detected_at: environment.detectedAt,
      updated_at: updatedAt
    });
  }

  public listEnvironments(): EnvironmentRecord[] {
    return (this.statements.allEnvironments.all() as EnvironmentRow[]).map((row) => ({
      id: row.id,
      targetKey: row.target_key,
      kind: row.kind,
      facts: JSON.parse(row.facts),
      notes: row.notes,
      instructions: row.instructions,
      attachToAi: row.attach_to_ai !== 0,
      detectedAt: row.detected_at
    }));
  }

  public deleteEnvironment(id: string): void {
    this.statements.deleteEnvironment.run(id);
  }

  public upsertAiConnection(connection: AiConnectionRecord, updatedAt: string): void {
    this.statements.upsertAiConnection.run({
      id: connection.id,
      name: connection.name,
      protocol: connection.protocol,
      base_url: connection.baseUrl,
      models: JSON.stringify(connection.models),
      default_model: connection.defaultModel,
      api_key_secret_id: connection.apiKeyRef ?? null,
      updated_at: updatedAt
    });
  }

  public listAiConnections(): AiConnectionRecord[] {
    return (this.statements.allAiConnections.all() as AiConnectionRow[]).map((row) => ({
      id: row.id,
      name: row.name,
      protocol: row.protocol,
      baseUrl: row.base_url,
      models: JSON.parse(row.models) as string[],
      defaultModel: row.default_model,
      apiKeyRef: row.api_key_secret_id ?? undefined
    }));
  }

  public deleteAiConnection(id: string): void {
    this.statements.deleteAiConnection.run(id);
  }

  public close(): void {
    this.database.close();
  }

  private secretFromRow(row: SecretRow): EncryptedSecret {
    return EncryptedSecretSchema.parse({
      version: row.version,
      algorithm: row.algorithm,
      nonce: row.nonce,
      tag: row.tag,
      ciphertext: row.ciphertext,
      purpose: row.purpose
    });
  }

  private profileFromRow(row: ProfileRow): SessionProfileRecord {
    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      group: row.group_name ?? undefined,
      term: row.term as SessionProfileRecord['term'],
      host: row.host ?? undefined,
      port: row.port ?? undefined,
      user: row.user_name ?? undefined,
      shell: row.shell ?? undefined,
      args: row.arguments ? (JSON.parse(row.arguments) as string[]) : undefined,
      cwd: row.cwd ?? undefined,
      distribution: row.distribution ?? undefined,
      environmentId: row.environment_id ?? undefined,
      secretRefs:
        row.password_secret_id || row.private_key_secret_id || row.passphrase_secret_id
          ? {
              password: row.password_secret_id ?? undefined,
              privateKey: row.private_key_secret_id ?? undefined,
              passphrase: row.passphrase_secret_id ?? undefined
            }
          : undefined
    };
  }
}

export function newSecretId(): string {
  return randomUUID();
}
