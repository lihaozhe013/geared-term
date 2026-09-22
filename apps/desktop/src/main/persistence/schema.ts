import { z } from 'zod';
import {
  AiConnectionRecordSchema,
  EnvironmentRecordSchema,
  SessionProfileRecordSchema,
  SettingsRecordSchema,
  UiStateRecordSchema
} from '@geared-term/protocol';

export const settingsSchemaVersion = 1;
export const profileSchemaVersion = 1;
export const uiStateSchemaVersion = 1;

export const SettingsSchema = SettingsRecordSchema;

export const UiStateSchema = UiStateRecordSchema;

export const EncryptedSecretSchema = z.object({
  version: z.literal(1),
  algorithm: z.literal('aes-256-gcm'),
  nonce: z.string().min(1),
  tag: z.string().min(1),
  ciphertext: z.string().min(1),
  purpose: z.string().min(1).max(100)
});

export const VaultMetadataSchema = z.object({
  version: z.literal(1),
  kdf: z.literal('pbkdf2-sha256'),
  iterations: z.number().int().positive(),
  salt: z.string().min(1)
});

export const VaultStateSchema = z.object({
  schemaVersion: z.literal(1),
  metadata: VaultMetadataSchema,
  verifier: EncryptedSecretSchema.nullable()
});

export const SessionProfileSchema = SessionProfileRecordSchema;
export const AiConnectionSchema = AiConnectionRecordSchema;
export const EnvironmentSchema = EnvironmentRecordSchema;

export const ProfileSchema = z.object({
  schemaVersion: z.literal(profileSchemaVersion),
  sessions: z.array(SessionProfileSchema),
  secrets: z.record(z.string(), EncryptedSecretSchema),
  aiConnections: z.array(AiConnectionSchema),
  environments: z.array(EnvironmentSchema).default([])
});

export type Settings = z.infer<typeof SettingsSchema>;
export type UiState = z.infer<typeof UiStateSchema>;
export type EncryptedSecret = z.infer<typeof EncryptedSecretSchema>;
export type VaultState = z.infer<typeof VaultStateSchema>;
export type SessionProfile = z.infer<typeof SessionProfileSchema>;
export type Profile = z.infer<typeof ProfileSchema>;
export type AiConnection = z.infer<typeof AiConnectionSchema>;
export type Environment = z.infer<typeof EnvironmentSchema>;

export const defaultSettings: Settings = {
  schemaVersion: settingsSchemaVersion,
  language: 'system',
  theme: 'Catppuccin Mocha',
  terminalFontSize: 14,
  terminalLineHeight: 1.2,
  terminalCursor: 'block',
  defaultTerm: 'xterm-256color',
  splitCommandPresentation: true,
  allowRiskyRun: true,
  keepRunningInBackground: true,
  terminalContextPrecedingLines: 100,
  remoteFileCommands: 'cat\nless\nvim',
  uiFontFamily: '',
  uiFontSize: 14,
  terminalFontFamily: 'JetBrains Mono',
  terminalFontLigatures: true,
  keybindings: {},
  terminalFontFallbacks: [],
  defaultAiConnectionId: null,
  globalAiInstructions: ''
};

export const defaultUiState: UiState = {
  schemaVersion: uiStateSchemaVersion,
  maximized: false,
  sidebarCollapsed: false,
  rightPanel: null,
  rightPanelCollapsed: false,
  sidebarWidth: 240,
  rightPanelWidth: 360
};

export const defaultProfile: Profile = {
  schemaVersion: profileSchemaVersion,
  sessions: [],
  secrets: {},
  aiConnections: [],
  environments: []
};
