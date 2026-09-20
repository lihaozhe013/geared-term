import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { rename } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AiConnectionInputSchema,
  AiConnectionRecordSchema,
  AiResponsesModelDefaultsSchema,
  type ProfileCredentials,
  SshTerminalRequestSchema,
  type AiConnectionInput,
  type AiConnectionRecord,
  type EnvironmentRecord,
  type SessionProfileRecord,
  type SshTerminalRequest
} from '@geared-term/protocol';
import type { Logger } from '../logging';
import { createVaultMetadata, Vault, type VaultMetadata } from '../vault/vault';
import { AutoUnlockStore, type SafeStorageAdapter } from '../vault/auto-unlock';
import { normalizeEndpoint } from '../ai/endpoint';
import { ProfileDatabase, newSecretId } from './profile-database';
import { VersionedJsonStore } from './json-store';
import {
  defaultProfile,
  defaultSettings,
  defaultUiState,
  EnvironmentSchema,
  ProfileSchema,
  SessionProfileSchema,
  SettingsSchema,
  UiStateSchema,
  VaultStateSchema,
  type EncryptedSecret,
  type Profile,
  type SessionProfile,
  type Settings,
  type UiState,
  type VaultState
} from './schema';

export class AppStorage {
  public readonly settings: VersionedJsonStore<Settings>;
  public readonly uiState: VersionedJsonStore<UiState>;
  public readonly vaultState: VersionedJsonStore<VaultState>;
  public vault: Vault;
  private readonly rootDirectory: string;
  private readonly logger: Logger;
  private vaultStateSnapshot: VaultState;
  private settingsValue: Settings = defaultSettings;
  private uiStateValue: UiState = defaultUiState;
  private profileDatabase: ProfileDatabase | undefined;
  private readonly autoUnlock: AutoUnlockStore;
  /** Set when the user locks the vault; blocks auto-unlock for this process (VLT-006). */
  private autoUnlockSuppressed = false;

  public constructor(rootDirectory: string, logger: Logger, safeStorage?: SafeStorageAdapter) {
    this.rootDirectory = rootDirectory;
    this.logger = logger;
    this.autoUnlock = new AutoUnlockStore(rootDirectory, safeStorage);
    this.settings = new VersionedJsonStore(
      join(rootDirectory, 'config.json'),
      SettingsSchema,
      defaultSettings
    );
    this.uiState = new VersionedJsonStore(
      join(rootDirectory, 'ui-state.json'),
      UiStateSchema,
      defaultUiState
    );
    const defaultVaultState: VaultState = {
      schemaVersion: 1,
      metadata: createVaultMetadata(),
      verifier: null
    };
    this.vaultState = new VersionedJsonStore(
      join(rootDirectory, 'vault.json'),
      VaultStateSchema,
      defaultVaultState
    );
    this.vaultStateSnapshot = defaultVaultState;
    this.vault = new Vault(defaultVaultState.metadata);
  }

  public async load(): Promise<void> {
    const [settings, uiState, vaultState] = await Promise.all([
      this.settings.load(),
      this.uiState.load(),
      this.vaultState.load()
    ]);
    this.vaultStateSnapshot = vaultState.value;
    this.settingsValue = settings.value;
    this.uiStateValue = uiState.value;
    this.vault = new Vault(vaultState.value.metadata as VaultMetadata);
    await Promise.all([
      settings.source === 'default' ? this.settings.save(settings.value) : Promise.resolve(),
      uiState.source === 'default' ? this.uiState.save(uiState.value) : Promise.resolve(),
      vaultState.source === 'default' ? this.vaultState.save(vaultState.value) : Promise.resolve()
    ]);
    if (settings.recovered || uiState.recovered || vaultState.recovered) {
      this.logger.warn('system', 'Application storage recovered', {
        settings: settings.source,
        uiState: uiState.source,
        vault: vaultState.source
      });
    }
    this.openProfileDatabase();
    await this.adoptLegacyProfileFile();
    await this.tryAutoUnlock();
  }

  private async tryAutoUnlock(): Promise<void> {
    if (this.autoUnlockSuppressed || this.vault.isUnlocked || !this.autoUnlock.isEnabled()) return;
    const key = this.autoUnlock.loadVaultKey();
    if (!key) {
      this.logger.warn('system', 'Auto-unlock material was unreadable; password required', {});
      return;
    }
    try {
      this.vault.applyKey(key);
    } catch (error) {
      this.logger.warn('system', 'Auto-unlock failed', { error: String(error) });
    }
  }

  private openProfileDatabase(): void {
    try {
      this.profileDatabase = new ProfileDatabase(this.rootDirectory, this.logger);
    } catch (error) {
      // Quarantined databases start empty rather than blocking startup; the
      // quarantined copy stays on disk for diagnosis.
      this.logger.error('system', 'Profile database unavailable, starting empty', {
        error: String(error)
      });
      this.profileDatabase = new ProfileDatabase(this.rootDirectory, this.logger);
    }
  }

  private async adoptLegacyProfileFile(): Promise<void> {
    const database = this.requireDatabase();
    const path = join(this.rootDirectory, 'profile.json');
    if (!existsSync(path)) return;
    const store = new VersionedJsonStore<Profile>(path, ProfileSchema, defaultProfile);
    let result;
    try {
      result = await store.load();
    } catch (error) {
      this.logger.warn('system', 'profile.json adoption failed', { error: String(error) });
      return;
    }
    if (result.source === 'default') return;
    const profile = result.value;
    const hasRows =
      profile.sessions.length > 0 ||
      profile.aiConnections.length > 0 ||
      profile.environments.length > 0 ||
      Object.keys(profile.secrets).length > 0;
    const markMigrated = async () => rename(path, `${path}.migrated`).catch(() => undefined);
    if (!hasRows) {
      await markMigrated();
      return;
    }
    if (database.listProfiles().length > 0) {
      await markMigrated();
      return;
    }
    database.transaction(() => {
      for (const [id, secret] of Object.entries(profile.secrets)) {
        database.putSecret(id, secret);
      }
      for (const environment of profile.environments) {
        database.upsertEnvironment(environment, new Date().toISOString());
      }
      for (const session of profile.sessions) {
        database.upsertProfile(session, new Date().toISOString());
      }
      for (const connection of profile.aiConnections) {
        database.upsertAiConnection(connection, new Date().toISOString());
      }
      database.sweepUnreferencedSecrets();
    });
    await markMigrated();
    this.logger.info('system', 'Adopted previous profile.json into the SQLite store', {
      sessions: profile.sessions.length,
      aiConnections: profile.aiConnections.length,
      environments: profile.environments.length
    });
  }

  private requireDatabase(): ProfileDatabase {
    if (!this.profileDatabase) {
      throw new Error('Storage has not been loaded');
    }
    return this.profileDatabase;
  }

  public settingsSnapshot(): Settings {
    return { ...this.settingsValue };
  }

  public async saveSettings(value: Settings): Promise<Settings> {
    this.settingsValue = SettingsSchema.parse(value);
    await this.settings.save(this.settingsValue);
    return this.settingsSnapshot();
  }

  public async initializeVault(password: string): Promise<void> {
    if (this.vaultStateSnapshot.verifier) {
      throw new Error('Vault is already initialized');
    }
    this.vault.initialize(password);
    this.vaultStateSnapshot = { ...this.vaultStateSnapshot, verifier: this.vault.createVerifier() };
    await this.vaultState.save(this.vaultStateSnapshot);
  }

  public async unlockVault(password: string): Promise<void> {
    if (!this.vaultStateSnapshot.verifier) {
      throw new Error('Vault has not been initialized');
    }
    this.vault.unlock(password, this.vaultStateSnapshot.verifier);
  }

  public lockVault(): void {
    this.vault.lock();
    this.autoUnlockSuppressed = true;
  }

  public autoUnlockStatus(): { supported: boolean; reason?: string; enabled: boolean } {
    const state = this.autoUnlock.status();
    return {
      supported: state.supported,
      reason: state.reason,
      enabled: state.enabled && !this.autoUnlockSuppressed
    };
  }

  public enableAutoUnlock(): void {
    if (!this.vault.isUnlocked) throw new Error('Vault is locked');
    this.autoUnlock.enable(this.vault.exportKey());
    this.autoUnlockSuppressed = false;
  }

  public disableAutoUnlock(): void {
    this.autoUnlock.disable();
  }

  /**
   * Re-encrypts every stored secret for a new master password in one
   * recoverable sequence: verify, stage, commit database rows, then persist
   * the new vault metadata. If the metadata write fails the database changes
   * are rolled back so the previous password keeps working (VLT-007).
   */
  public async rotateVault(oldPassword: string, newPassword: string): Promise<void> {
    if (!this.vaultStateSnapshot.verifier) {
      throw new Error('Vault has not been initialized');
    }
    if (!this.vault.isUnlocked) throw new Error('Vault is locked');
    const oldMetadata = this.vaultStateSnapshot.metadata as VaultMetadata;
    const probe = new Vault(oldMetadata);
    probe.unlock(oldPassword, this.vaultStateSnapshot.verifier);
    probe.lock();

    const nextMetadata = createVaultMetadata();
    const nextVault = new Vault(nextMetadata);
    nextVault.initialize(newPassword);
    const database = this.requireDatabase();
    const currentRows = [...database.listSecrets().entries()];
    const reencrypted: Array<[string, EncryptedSecret]> = currentRows.map(([id, secret]) => [
      id,
      nextVault.encrypt(secret.purpose, this.vault.decrypt(secret))
    ]);
    const nextState: VaultState = {
      schemaVersion: 1,
      metadata: nextMetadata,
      verifier: nextVault.createVerifier()
    };

    database.transaction(() => {
      for (const [id, secret] of reencrypted) {
        database.putSecret(id, secret);
      }
    });
    try {
      await this.vaultState.save(nextState);
    } catch (error) {
      database.transaction(() => {
        for (const [id, secret] of currentRows) {
          database.putSecret(id, secret);
        }
      });
      throw error;
    }
    this.vaultStateSnapshot = nextState;
    this.vault = nextVault;
    if (this.autoUnlock.isEnabled()) {
      try {
        this.autoUnlock.enable(this.vault.exportKey());
      } catch (error) {
        this.autoUnlock.disable();
        this.logger.warn('system', 'Auto-unlock was disabled during password rotation', {
          error: String(error)
        });
      }
    }
  }

  public vaultStatus(): { initialized: boolean; unlocked: boolean } {
    return {
      initialized: this.vaultStateSnapshot.verifier !== null,
      unlocked: this.vault.isUnlocked
    };
  }

  public profileSnapshot(): SessionProfile[] {
    return this.requireDatabase()
      .listProfiles()
      .map((profile) => this.copyProfile(profile));
  }

  public async saveProfile(profile: SessionProfile): Promise<SessionProfile[]> {
    return this.saveProfileWithCredentials(profile);
  }

  public async saveProfileWithCredentials(
    profile: SessionProfile,
    credentials?: ProfileCredentials
  ): Promise<SessionProfile[]> {
    const database = this.requireDatabase();
    const parsedProfile = SessionProfileSchema.parse(profile);
    const current = database.getProfileRow(parsedProfile.id);
    if (current && current.kind !== parsedProfile.kind) {
      throw new Error('Session type cannot be changed after creation');
    }
    let nextProfile: SessionProfileRecord = parsedProfile;

    if (credentials && parsedProfile.kind !== 'ssh') {
      throw new Error('Credentials can only be saved for SSH profiles');
    }

    if (parsedProfile.kind === 'ssh') {
      const secretRefs = {
        ...(current?.secretRefs ?? {}),
        ...(parsedProfile.secretRefs ?? {})
      };
      const credentialEntries: Array<['password' | 'privateKey' | 'passphrase', string]> = [
        ['password', 'ssh-password'],
        ['privateKey', 'ssh-private-key'],
        ['passphrase', 'ssh-passphrase']
      ];
      const hasCredentialMutation = credentials
        ? credentialEntries.some(([key]) => credentials[key] !== undefined)
        : false;
      if (hasCredentialMutation && !this.vault.isUnlocked) {
        throw new Error('Vault is locked');
      }
      const replacedSecretRefs: string[] = Object.values(current?.secretRefs ?? {});
      const newSecrets: Array<[string, EncryptedSecret]> = [];
      for (const [key, purpose] of credentialEntries) {
        const value = credentials?.[key];
        if (value === undefined) continue;
        const previousRef = secretRefs[key];
        if (previousRef) replacedSecretRefs.push(previousRef);
        delete secretRefs[key];
        if (value.length > 0) {
          const id = newSecretId();
          newSecrets.push([id, this.vault.encrypt(`${purpose}:${parsedProfile.id}`, value)]);
          secretRefs[key] = id;
        }
      }
      if (!parsedProfile.host?.trim() || !parsedProfile.user?.trim()) {
        throw new Error('SSH profile requires a host and user');
      }
      if (!secretRefs.password && !secretRefs.privateKey) {
        throw new Error('SSH profile requires a password or private key');
      }
      nextProfile = {
        ...parsedProfile,
        secretRefs: Object.keys(secretRefs).length > 0 ? secretRefs : undefined
      };
      const updatedAt = new Date().toISOString();
      database.transaction(() => {
        for (const [id, secret] of newSecrets) {
          database.putSecret(id, secret);
        }
        database.upsertProfile(nextProfile, updatedAt);
        database.sweepUnreferencedSecrets();
      });
      return this.profileSnapshot();
    }

    database.transaction(() => {
      database.upsertProfile(nextProfile, new Date().toISOString());
      database.sweepUnreferencedSecrets();
    });
    return this.profileSnapshot();
  }

  public environmentSnapshot(): EnvironmentRecord[] {
    return this.requireDatabase()
      .listEnvironments()
      .map((environment) => ({ ...environment, facts: { ...environment.facts } }));
  }

  public async saveEnvironment(environment: EnvironmentRecord): Promise<EnvironmentRecord[]> {
    const database = this.requireDatabase();
    const nextEnvironment = EnvironmentSchema.parse(environment);
    database.transaction(() => {
      database.upsertEnvironment(nextEnvironment, new Date().toISOString());
    });
    return this.environmentSnapshot();
  }

  public async deleteEnvironment(id: string): Promise<EnvironmentRecord[]> {
    const database = this.requireDatabase();
    database.transaction(() => {
      database.deleteEnvironment(id);
    });
    return this.environmentSnapshot();
  }

  public async deleteProfile(id: string): Promise<SessionProfile[]> {
    const database = this.requireDatabase();
    database.transaction(() => {
      database.deleteProfile(id);
      database.sweepUnreferencedSecrets();
    });
    return this.profileSnapshot();
  }

  public uiStateSnapshot(): UiState {
    return {
      ...this.uiStateValue,
      bounds: this.uiStateValue.bounds ? { ...this.uiStateValue.bounds } : undefined
    };
  }

  public async saveUiState(value: UiState): Promise<UiState> {
    this.uiStateValue = UiStateSchema.parse(value);
    await this.uiState.save(this.uiStateValue);
    return this.uiStateSnapshot();
  }

  public async saveSecret(purpose: string, value: string): Promise<string> {
    if (!this.vault.isUnlocked) throw new Error('Vault is locked');
    const id = randomUUID();
    this.requireDatabase().putSecret(id, this.vault.encrypt(purpose, value));
    return id;
  }

  public async deleteSecret(id: string): Promise<void> {
    const database = this.requireDatabase();
    database.transaction(() => {
      database.deleteSecret(id);
      database.sweepUnreferencedSecrets();
    });
  }

  /** Decrypts a stored secret in the main process; the renderer has no path here. */
  public readSecret(id: string): string {
    const secret = this.requireDatabase().getSecret(id);
    if (!secret) throw new Error('Secret was not found');
    return this.vault.decrypt(secret);
  }

  public resolveSshProfile(
    profileId: string,
    sessionId: string,
    cols: number,
    rows: number
  ): SshTerminalRequest {
    const profile = this.requireDatabase().getProfileRow(profileId);
    if (!profile || profile.kind !== 'ssh' || !profile.host || !profile.user) {
      throw new Error('SSH profile is missing its connection target');
    }
    const refs = profile.secretRefs;
    const password = refs?.password ? this.decryptSecret(refs.password) : undefined;
    const privateKey = refs?.privateKey ? this.decryptSecret(refs.privateKey) : undefined;
    const passphrase = refs?.passphrase ? this.decryptSecret(refs.passphrase) : undefined;
    return SshTerminalRequestSchema.parse({
      sessionId,
      host: profile.host,
      port: profile.port ?? 22,
      username: profile.user,
      term: profile.term,
      cols,
      rows,
      password,
      privateKey,
      passphrase
    });
  }

  public aiConnectionsSnapshot(): AiConnectionRecord[] {
    return this.requireDatabase()
      .listAiConnections()
      .map((connection) => ({
        ...connection,
        models: connection.models.map((model) => ({
          ...model,
          responses: model.responses ? { ...model.responses } : undefined
        }))
      }));
  }

  public async saveAiConnection(rawInput: AiConnectionInput): Promise<AiConnectionRecord[]> {
    const database = this.requireDatabase();
    const input = AiConnectionInputSchema.parse(rawInput);
    const endpoint = normalizeEndpoint(input.baseUrl, input.protocol);
    const id = input.id ?? randomUUID();
    const current = database.listAiConnections().find((connection) => connection.id === id);
    const previousRef = current?.apiKeyRef;
    let apiKeyRef = previousRef;
    let newSecret: [string, EncryptedSecret] | undefined;
    if (input.apiKey !== undefined && input.apiKey.length > 0) {
      if (!this.vault.isUnlocked) throw new Error('Vault is locked');
      const secretId = newSecretId();
      newSecret = [secretId, this.vault.encrypt(`ai-api-key:${id}`, input.apiKey)];
      apiKeyRef = secretId;
    } else if (input.apiKey !== undefined) {
      apiKeyRef = undefined;
    }
    const models = input.models.map((model) => {
      const previous = current?.models.find((candidate) => candidate.model === model.model);
      const responses =
        input.protocol === 'responses'
          ? AiResponsesModelDefaultsSchema.parse(
              model.responses ?? previous?.responses ?? {}
            )
          : undefined;
      return { ...model, responses };
    });
    const connection = AiConnectionRecordSchema.parse({
      id,
      name: input.name,
      protocol: input.protocol,
      baseUrl: endpoint.baseUrl,
      models,
      defaultModel: input.defaultModel,
      apiKeyRef,
      acceptedEndpoint:
        current &&
        normalizeEndpoint(current.baseUrl, current.protocol).identity === endpoint.identity
          ? current.acceptedEndpoint
          : undefined
    });
    database.transaction(() => {
      if (newSecret) database.putSecret(newSecret[0], newSecret[1]);
      database.upsertAiConnection(connection, new Date().toISOString());
      database.sweepUnreferencedSecrets();
    });
    return this.aiConnectionsSnapshot();
  }

  public async deleteAiConnection(id: string): Promise<AiConnectionRecord[]> {
    const database = this.requireDatabase();
    database.transaction(() => {
      database.deleteAiConnection(id);
      database.sweepUnreferencedSecrets();
    });
    return this.aiConnectionsSnapshot();
  }

  public resolveAiConnection(
    id: string,
    model: string
  ): {
    endpoint: string;
    protocol: 'responses' | 'chat-completions';
    model: string;
    apiKey?: string;
    responseOptions: ReturnType<typeof AiResponsesModelDefaultsSchema.parse>;
    acceptedEndpoint?: string;
    connectionId: string;
  } {
    const connection = this.requireDatabase()
      .listAiConnections()
      .find((item) => item.id === id);
    if (!connection) throw new Error('AI connection was not found');
    const selected =
      connection.models.find((item) => item.model === model) ??
      connection.models.find((item) => item.model === connection.defaultModel);
    if (!selected) throw new Error('AI model was not found in the selected connection');
    const apiKey = connection.apiKeyRef ? this.decryptSecret(connection.apiKeyRef) : undefined;
    return {
      connectionId: connection.id,
      endpoint: connection.baseUrl,
      protocol: connection.protocol,
      model: selected.model,
      apiKey,
      responseOptions:
        selected.responses ?? AiResponsesModelDefaultsSchema.parse({}),
      acceptedEndpoint: connection.acceptedEndpoint
    };
  }

  public async acceptAiEndpoint(id: string, identity: string): Promise<AiConnectionRecord[]> {
    const database = this.requireDatabase();
    const connection = database.listAiConnections().find((item) => item.id === id);
    if (!connection) throw new Error('AI connection was not found');
    const endpoint = normalizeEndpoint(connection.baseUrl, connection.protocol);
    if (endpoint.identity !== identity) throw new Error('AI endpoint identity has changed');
    database.transaction(() => {
      database.upsertAiConnection(
        { ...connection, acceptedEndpoint: identity },
        new Date().toISOString()
      );
    });
    return this.aiConnectionsSnapshot();
  }

  public close(): void {
    this.profileDatabase?.close();
    this.profileDatabase = undefined;
  }

  private decryptSecret(id: string): string {
    const secret = this.requireDatabase().getSecret(id);
    if (!secret) throw new Error('SSH profile references a missing secret');
    return this.vault.decrypt(secret);
  }

  private copyProfile(profile: SessionProfileRecord): SessionProfile {
    return {
      ...profile,
      args: profile.args ? [...profile.args] : undefined,
      secretRefs: profile.secretRefs ? { ...profile.secretRefs } : undefined
    };
  }
}
