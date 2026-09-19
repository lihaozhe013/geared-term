import { z } from 'zod';

export const settingsSchemaVersion = 1;
export const profileSchemaVersion = 1;
export const uiStateSchemaVersion = 1;

export const SettingsSchema = z.object({
  schemaVersion: z.literal(settingsSchemaVersion),
  language: z.enum(['en-US', 'zh-CN', 'system']),
  theme: z.string().min(1).max(160),
  terminalFontSize: z.number().min(8).max(32),
  terminalLineHeight: z.number().min(1).max(2),
  terminalCursor: z.enum(['block', 'underline', 'bar']),
  defaultTerm: z.enum(['xterm-256color', 'xterm', 'vt520', 'linux', 'screen']),
  splitCommandPresentation: z.boolean(),
  terminalContextPrecedingLines: z.number().int().min(0).max(2000)
});

export const UiStateSchema = z.object({
  schemaVersion: z.literal(uiStateSchemaVersion),
  bounds: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number().positive(),
      height: z.number().positive()
    })
    .optional(),
  maximized: z.boolean(),
  sidebarCollapsed: z.boolean(),
  rightPanel: z.enum(['sftp', 'assistant']).nullable(),
  rightPanelCollapsed: z.boolean(),
  splitRatio: z.number().min(0.15).max(0.85)
});

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

export const SessionProfileSchema = z.object({
  id: z.string().min(1).max(128),
  kind: z.enum(['local', 'wsl', 'ssh']),
  name: z.string().min(1).max(160),
  group: z.string().max(160).optional(),
  term: z.enum(['xterm-256color', 'xterm', 'vt520', 'linux', 'screen']),
  host: z.string().max(512).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  user: z.string().max(256).optional(),
  shell: z.string().max(512).optional(),
  args: z.array(z.string().max(4096)).max(32).optional(),
  cwd: z.string().max(4096).optional(),
  distribution: z.string().max(256).optional(),
  secretRefs: z
    .object({
      password: z.string().max(128).optional(),
      privateKey: z.string().max(128).optional(),
      passphrase: z.string().max(128).optional()
    })
    .optional()
});

export const ProfileSchema = z.object({
  schemaVersion: z.literal(profileSchemaVersion),
  sessions: z.array(SessionProfileSchema),
  secrets: z.record(z.string(), EncryptedSecretSchema),
  aiConnections: z.array(
    z.object({
      id: z.string().min(1).max(128),
      name: z.string().min(1).max(160),
      protocol: z.enum(['responses', 'chat-completions']),
      baseUrl: z.string().url(),
      apiKey: z.string().max(128).optional(),
      models: z.array(z.string().max(256)),
      defaultModel: z.string().max(256)
    })
  )
});

export type Settings = z.infer<typeof SettingsSchema>;
export type UiState = z.infer<typeof UiStateSchema>;
export type EncryptedSecret = z.infer<typeof EncryptedSecretSchema>;
export type VaultState = z.infer<typeof VaultStateSchema>;
export type Profile = z.infer<typeof ProfileSchema>;

export const defaultSettings: Settings = {
  schemaVersion: settingsSchemaVersion,
  language: 'system',
  theme: 'Augur Dark+',
  terminalFontSize: 14,
  terminalLineHeight: 1.2,
  terminalCursor: 'block',
  defaultTerm: 'xterm-256color',
  splitCommandPresentation: false,
  terminalContextPrecedingLines: 100
};

export const defaultUiState: UiState = {
  schemaVersion: uiStateSchemaVersion,
  maximized: false,
  sidebarCollapsed: false,
  rightPanel: null,
  rightPanelCollapsed: false,
  splitRatio: 0.7
};

export const defaultProfile: Profile = {
  schemaVersion: profileSchemaVersion,
  sessions: [],
  secrets: {},
  aiConnections: []
};
