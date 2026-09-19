import { join } from 'node:path';
import type { Logger } from '../logging';
import { createVaultMetadata, Vault, type VaultMetadata } from '../vault/vault';
import { VersionedJsonStore } from './json-store';
import {
  defaultProfile,
  defaultSettings,
  defaultUiState,
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
    const nextProfile = SessionProfileSchema.parse(profile);
    const sessions = this.profileValue.sessions.filter((item) => item.id !== nextProfile.id);
    sessions.push(nextProfile);
    this.profileValue = ProfileSchema.parse({ ...this.profileValue, sessions });
    await this.profile.save(this.profileValue);
    return this.profileSnapshot();
  }

  public async deleteProfile(id: string): Promise<SessionProfile[]> {
    const sessions = this.profileValue.sessions.filter((item) => item.id !== id);
    if (sessions.length !== this.profileValue.sessions.length) {
      this.profileValue = ProfileSchema.parse({ ...this.profileValue, sessions });
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
}
