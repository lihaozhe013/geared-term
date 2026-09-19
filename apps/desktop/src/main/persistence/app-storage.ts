import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  AiConnectionInputSchema,
  AiConnectionRecordSchema,
  type ProfileCredentials,
  SshTerminalRequestSchema,
  type AiConnectionInput,
  type AiConnectionRecord,
  type EnvironmentRecord,
  type SshTerminalRequest
} from '@geared-term/protocol';
import type { Logger } from '../logging';
import { createVaultMetadata, Vault, type VaultMetadata } from '../vault/vault';
import { normalizeEndpoint } from '../ai/endpoint';
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
  type Profile,
  type SessionProfile,
  type Settings,
  type UiState,
  type VaultState
} from './schema';

export class AppStorage {
  public readonly settings: VersionedJsonStore<Settings>;
  public readonly profile: VersionedJsonStore<Profile>;
  public readonly uiState: VersionedJsonStore<UiState>;
  public readonly vaultState: VersionedJsonStore<VaultState>;
  public vault: Vault;
  private vaultStateSnapshot: VaultState;
  private settingsValue: Settings = defaultSettings;
  private profileValue: Profile = defaultProfile;
  private uiStateValue: UiState = defaultUiState;

  public constructor(
    private readonly rootDirectory: string,
    private readonly logger: Logger
  ) {
    this.settings = new VersionedJsonStore(
      join(rootDirectory, 'config.json'),
      SettingsSchema,
      defaultSettings
    );
    this.profile = new VersionedJsonStore(
      join(rootDirectory, 'profile.json'),
      ProfileSchema,
      defaultProfile
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
    const [settings, profile, uiState, vaultState] = await Promise.all([
      this.settings.load(),
      this.profile.load(),
      this.uiState.load(),
      this.vaultState.load()
    ]);
    this.vaultStateSnapshot = vaultState.value;
    this.settingsValue = settings.value;
    this.profileValue = profile.value;
    this.uiStateValue = uiState.value;
    this.vault = new Vault(vaultState.value.metadata as VaultMetadata);
    await Promise.all([
      settings.source === 'default' ? this.settings.save(settings.value) : Promise.resolve(),
      profile.source === 'default' ? this.profile.save(profile.value) : Promise.resolve(),
      uiState.source === 'default' ? this.uiState.save(uiState.value) : Promise.resolve(),
      vaultState.source === 'default' ? this.vaultState.save(vaultState.value) : Promise.resolve()
    ]);
    if (settings.recovered || profile.recovered || uiState.recovered || vaultState.recovered) {
      this.logger.warn('system', 'Application storage recovered', {
        settings: settings.source,
        profile: profile.source,
        uiState: uiState.source,
        vault: vaultState.source
      });
    }
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
    const current = await this.vaultState.load();
    if (current.value.verifier) {
      throw new Error('Vault is already initialized');
    }
    this.vault.initialize(password);
    this.vaultStateSnapshot = { ...current.value, verifier: this.vault.createVerifier() };
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
  }

  public vaultStatus(): { initialized: boolean; unlocked: boolean } {
    return {
      initialized: this.vaultStateSnapshot.verifier !== null,
      unlocked: this.vault.isUnlocked
    };
  }

  public profileSnapshot(): SessionProfile[] {
    return this.profileValue.sessions.map((profile) => ({
      ...profile,
      args: profile.args ? [...profile.args] : undefined,
      secretRefs: profile.secretRefs ? { ...profile.secretRefs } : undefined
    }));
  }

  public async saveProfile(profile: SessionProfile): Promise<SessionProfile[]> {
    return this.saveProfileWithCredentials(profile);
  }

  public async saveProfileWithCredentials(
    profile: SessionProfile,
    credentials?: ProfileCredentials
  ): Promise<SessionProfile[]> {
    const parsedProfile = SessionProfileSchema.parse(profile);
    const current = this.profileValue.sessions.find((item) => item.id === parsedProfile.id);
    if (current && current.kind !== parsedProfile.kind) {
      throw new Error('Session type cannot be changed after creation');
    }
    let nextProfile = parsedProfile;
    let secrets = { ...this.profileValue.secrets };
    const replacedSecretRefs: string[] = Object.values(current?.secretRefs ?? {});

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
      for (const [key, purpose] of credentialEntries) {
        const value = credentials?.[key];
        if (value === undefined) continue;
        const previousRef = secretRefs[key];
        if (previousRef) replacedSecretRefs.push(previousRef);
        delete secretRefs[key];
        if (value.length > 0) {
          const id = randomUUID();
          secrets[id] = this.vault.encrypt(`${purpose}:${parsedProfile.id}`, value);
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
    }

    const sessions = this.profileValue.sessions.filter((item) => item.id !== nextProfile.id);
    sessions.push(nextProfile);
    const retainedSecretRefs = this.collectSecretRefs(sessions);
    for (const connection of this.profileValue.aiConnections) {
      if (connection.apiKeyRef) retainedSecretRefs.add(connection.apiKeyRef);
    }
    for (const id of replacedSecretRefs) {
      if (!retainedSecretRefs.has(id)) delete secrets[id];
    }
    this.profileValue = ProfileSchema.parse({ ...this.profileValue, sessions, secrets });
    await this.profile.save(this.profileValue);
    return this.profileSnapshot();
  }

  public environmentSnapshot(): EnvironmentRecord[] {
    return this.profileValue.environments.map((environment) => ({
      ...environment,
      facts: { ...environment.facts }
    }));
  }

  public async saveEnvironment(environment: EnvironmentRecord): Promise<EnvironmentRecord[]> {
    const nextEnvironment = EnvironmentSchema.parse(environment);
    const environments = this.profileValue.environments.filter(
      (item) => item.id !== nextEnvironment.id
    );
    environments.push(nextEnvironment);
    this.profileValue = ProfileSchema.parse({ ...this.profileValue, environments });
    await this.profile.save(this.profileValue);
    return this.environmentSnapshot();
  }

  public async deleteEnvironment(id: string): Promise<EnvironmentRecord[]> {
    const environments = this.profileValue.environments.filter((item) => item.id !== id);
    if (environments.length !== this.profileValue.environments.length) {
      this.profileValue = ProfileSchema.parse({ ...this.profileValue, environments });
      await this.profile.save(this.profileValue);
    }
    return this.environmentSnapshot();
  }

  public async deleteProfile(id: string): Promise<SessionProfile[]> {
    const removed = this.profileValue.sessions.find((item) => item.id === id);
    const sessions = this.profileValue.sessions.filter((item) => item.id !== id);
    if (sessions.length !== this.profileValue.sessions.length) {
      const secrets = { ...this.profileValue.secrets };
      const retainedSecretRefs = this.collectSecretRefs(sessions);
      for (const connection of this.profileValue.aiConnections) {
        if (connection.apiKeyRef) retainedSecretRefs.add(connection.apiKeyRef);
      }
      for (const idToRemove of Object.values(removed?.secretRefs ?? {})) {
        if (!retainedSecretRefs.has(idToRemove)) delete secrets[idToRemove];
      }
      this.profileValue = ProfileSchema.parse({ ...this.profileValue, sessions, secrets });
      await this.profile.save(this.profileValue);
    }
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
    const secret = this.vault.encrypt(purpose, value);
    this.profileValue = ProfileSchema.parse({
      ...this.profileValue,
      secrets: { ...this.profileValue.secrets, [id]: secret }
    });
    await this.profile.save(this.profileValue);
    return id;
  }

  public async deleteSecret(id: string): Promise<void> {
    if (!Object.hasOwn(this.profileValue.secrets, id)) return;
    const secrets = { ...this.profileValue.secrets };
    delete secrets[id];
    this.profileValue = ProfileSchema.parse({ ...this.profileValue, secrets });
    await this.profile.save(this.profileValue);
  }

  public resolveSshProfile(
    profileId: string,
    sessionId: string,
    cols: number,
    rows: number
  ): SshTerminalRequest {
    const profile = this.profileValue.sessions.find((item) => item.id === profileId);
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
    return this.profileValue.aiConnections.map((connection) => ({
      ...connection,
      models: [...connection.models]
    }));
  }

  public async saveAiConnection(rawInput: AiConnectionInput): Promise<AiConnectionRecord[]> {
    const input = AiConnectionInputSchema.parse(rawInput);
    const endpoint = normalizeEndpoint(input.baseUrl, input.protocol);
    const id = input.id ?? randomUUID();
    const current = this.profileValue.aiConnections.find((connection) => connection.id === id);
    let apiKeyRef = current?.apiKeyRef;
    if (input.apiKey !== undefined) {
      if (input.apiKey.length === 0) {
        if (apiKeyRef) await this.deleteSecret(apiKeyRef);
        apiKeyRef = undefined;
      } else {
        if (apiKeyRef) await this.deleteSecret(apiKeyRef);
        apiKeyRef = await this.saveSecret(`ai-api-key:${id}`, input.apiKey);
      }
    }
    const connection = AiConnectionRecordSchema.parse({
      id,
      name: input.name,
      protocol: input.protocol,
      baseUrl: endpoint.baseUrl,
      models: [input.model],
      defaultModel: input.model,
      apiKeyRef
    });
    const aiConnections = this.profileValue.aiConnections.filter((item) => item.id !== id);
    aiConnections.push(connection);
    this.profileValue = ProfileSchema.parse({ ...this.profileValue, aiConnections });
    await this.profile.save(this.profileValue);
    return this.aiConnectionsSnapshot();
  }

  public async deleteAiConnection(id: string): Promise<AiConnectionRecord[]> {
    const current = this.profileValue.aiConnections.find((connection) => connection.id === id);
    if (!current) return this.aiConnectionsSnapshot();
    if (current.apiKeyRef) await this.deleteSecret(current.apiKeyRef);
    const aiConnections = this.profileValue.aiConnections.filter((item) => item.id !== id);
    this.profileValue = ProfileSchema.parse({ ...this.profileValue, aiConnections });
    await this.profile.save(this.profileValue);
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
  } {
    const connection = this.profileValue.aiConnections.find((item) => item.id === id);
    if (!connection) throw new Error('AI connection was not found');
    const apiKey = connection.apiKeyRef ? this.decryptSecret(connection.apiKeyRef) : undefined;
    return {
      endpoint: connection.baseUrl,
      protocol: connection.protocol,
      model: model || connection.defaultModel,
      apiKey
    };
  }

  private decryptSecret(id: string): string {
    const secret = this.profileValue.secrets[id];
    if (!secret) throw new Error('SSH profile references a missing secret');
    return this.vault.decrypt(secret);
  }

  private collectSecretRefs(sessions: SessionProfile[]): Set<string> {
    const refs = new Set<string>();
    for (const session of sessions) {
      for (const id of Object.values(session.secretRefs ?? {})) {
        refs.add(id);
      }
    }
    return refs;
  }
}
