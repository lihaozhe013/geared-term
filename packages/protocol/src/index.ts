import { z } from 'zod';

export const IdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

export const ErrorCodeSchema = z.enum([
  'invalid_request',
  'not_found',
  'not_ready',
  'permission_denied',
  'invalid_state',
  'internal',
  'timeout'
]);

export const StructuredErrorSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string().min(1).max(512),
  retryable: z.boolean(),
  requestId: IdSchema.optional(),
  details: z.record(z.string(), z.unknown()).optional()
});

export const AppInfoSchema = z.object({
  name: z.literal('Geared Term'),
  version: z.string().min(1),
  isPackaged: z.boolean(),
  platform: z.enum(['win32', 'darwin', 'linux', 'freebsd', 'openbsd', 'sunos', 'aix'])
});

export const EmptyRequestSchema = z.object({}).strict();

export const VaultPasswordRequestSchema = z
  .object({ password: z.string().min(1).max(1024) })
  .strict();
export const VaultRotateRequestSchema = z
  .object({ oldPassword: z.string().min(1).max(1024), newPassword: z.string().min(1).max(1024) })
  .strict();
export const VaultStatusSchema = z.object({ initialized: z.boolean(), unlocked: z.boolean() });
export const AutoUnlockStatusSchema = z.object({
  supported: z.boolean(),
  reason: z.string().max(512).optional(),
  enabled: z.boolean()
});

export const IpcChannelSchema = z.enum(['app:get-info']);

export const SessionProfileRecordSchema = z
  .object({
    id: IdSchema,
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
    environmentId: IdSchema.optional(),
    secretRefs: z
      .object({
        password: IdSchema.optional(),
        privateKey: IdSchema.optional(),
        passphrase: IdSchema.optional()
      })
      .optional()
  })
  .strict();

export const ProfileIdRequestSchema = z.object({ id: IdSchema }).strict();

export const ProfileCredentialsSchema = z
  .object({
    password: z.string().max(4096).optional(),
    privateKey: z
      .string()
      .max(1024 * 1024)
      .optional(),
    passphrase: z.string().max(4096).optional()
  })
  .strict();

export const SessionProfileSaveProfileSchema = SessionProfileRecordSchema.omit({
  secretRefs: true
});

export const SessionProfileSaveRequestSchema = z
  .object({
    profile: SessionProfileSaveProfileSchema,
    credentials: ProfileCredentialsSchema.optional()
  })
  .strict();

export const UiStateRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
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
    rightPanel: z.enum(['sftp', 'assistant', 'environment']).nullable(),
    rightPanelCollapsed: z.boolean(),
    splitRatio: z.number().min(0.15).max(0.85)
  })
  .strict();

export const SettingsRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    language: z.enum(['en-US', 'zh-CN', 'system']),
    theme: z.string().min(1).max(160),
    terminalFontSize: z.number().min(8).max(32),
    terminalLineHeight: z.number().min(1).max(2),
    terminalCursor: z.enum(['block', 'underline', 'bar']),
    defaultTerm: z.enum(['xterm-256color', 'xterm', 'vt520', 'linux', 'screen']),
    splitCommandPresentation: z.boolean(),
    terminalContextPrecedingLines: z.number().int().min(0).max(2000)
  })
  .strict();

export const WslDistributionSchema = z.object({
  name: z.string().min(1).max(256),
  isDefault: z.boolean(),
  state: z.enum(['running', 'stopped', 'transitional', 'unknown']),
  version: z.union([z.literal(1), z.literal(2), z.null()])
});

export const AiConnectionRecordSchema = z
  .object({
    id: IdSchema,
    name: z.string().min(1).max(160),
    protocol: z.enum(['responses', 'chat-completions']),
    baseUrl: z.string().url(),
    models: z.array(z.string().min(1).max(256)).max(256),
    defaultModel: z.string().min(1).max(256),
    apiKeyRef: IdSchema.optional()
  })
  .strict();

export const AiConnectionInputSchema = z
  .object({
    id: IdSchema.optional(),
    name: z.string().min(1).max(160),
    protocol: z.enum(['responses', 'chat-completions']),
    baseUrl: z.string().min(1).max(2048),
    model: z.string().min(1).max(256),
    apiKey: z.string().max(4096).optional()
  })
  .strict();

export const AiConnectionDeleteRequestSchema = z.object({ id: IdSchema }).strict();

export const AiDiscoverModelsRequestSchema = z
  .object({
    connectionId: IdSchema.optional(),
    protocol: z.enum(['responses', 'chat-completions']).optional(),
    baseUrl: z.string().min(1).max(2048).optional(),
    model: z.string().max(256).optional(),
    apiKey: z.string().max(4096).optional()
  })
  .strict();

export const AiDiscoveredModelsSchema = z.object({
  models: z.array(z.string().min(1).max(256)).max(256)
});

export const AiHistoryIdSchema = z.string().regex(/^[A-Za-z0-9._-]+$/).max(128);

export const AiHistorySummarySchema = z
  .object({
    id: AiHistoryIdSchema,
    title: z.string().max(200),
    model: z.string().max(256).optional(),
    updatedAt: z.string().max(64),
    messageCount: z.number().int().nonnegative()
  })
  .strict();

export const AiHistoryListSchema = z.object({ entries: z.array(AiHistorySummarySchema).max(512) });

export const AiHistoryLoadRequestSchema = z.object({ id: AiHistoryIdSchema }).strict();

export const AiHistoryMessageSchema = z
  .object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(256 * 1024)
  })
  .strict();

export const AiHistoryLoadResultSchema = z
  .object({
    id: AiHistoryIdSchema,
    title: z.string().max(200),
    model: z.string().max(256).optional(),
    messages: z.array(AiHistoryMessageSchema).max(1000)
  })
  .strict();

export const AiHistorySaveRequestSchema = z
  .object({
    id: AiHistoryIdSchema.optional(),
    title: z.string().max(200),
    model: z.string().max(256).optional(),
    messages: z.array(AiHistoryMessageSchema).min(1).max(1000)
  })
  .strict();

export const AiHistorySavedSchema = z
  .object({ id: AiHistoryIdSchema, updatedAt: z.string().max(64) })
  .strict();

export const AiChatMessageSchema = z
  .object({
    role: z.enum(['system', 'user', 'assistant']),
    content: z.string().max(256 * 1024)
  })
  .strict();

export const AiStreamRequestSchema = z
  .object({
    streamId: IdSchema,
    connectionId: IdSchema,
    model: z.string().min(1).max(256),
    messages: z.array(AiChatMessageSchema).min(1).max(100)
  })
  .strict();

export const AiStreamClientMessageSchema = z.object({ kind: z.literal('cancel') }).strict();

export const AiStreamEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('delta'), text: z.string() }),
  z.object({ kind: z.literal('reasoning'), text: z.string() }),
  z.object({
    kind: z.literal('usage'),
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional()
  }),
  z.object({
    kind: z.literal('source'),
    url: z.string().url(),
    title: z.string().max(512).optional()
  }),
  z.object({ kind: z.literal('complete') }),
  z.object({ kind: z.literal('error'), message: z.string().min(1).max(1024) })
]);

export const TerminalPortMessageSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('output'),
    sessionId: IdSchema,
    sequence: z.number().int().nonnegative(),
    chunk: z.string()
  }),
  z.object({
    kind: z.literal('state'),
    sessionId: IdSchema,
    sequence: z.number().int().nonnegative(),
    state: z.enum([
      'created',
      'starting',
      'awaiting-user',
      'running',
      'exited',
      'closing',
      'closed',
      'failed'
    ]),
    detail: z.string().max(512).optional()
  }),
  z.object({
    kind: z.literal('ack'),
    sessionId: IdSchema,
    sequence: z.number().int().nonnegative(),
    bytes: z.number().int().nonnegative()
  }),
  z.object({
    kind: z.literal('prompt'),
    sessionId: IdSchema,
    sequence: z.number().int().nonnegative(),
    prompt: z.literal('host-key'),
    host: z.string().min(1).max(512),
    port: z.number().int().min(1).max(65535),
    fingerprint: z.string().min(1).max(256),
    previousFingerprint: z.string().max(256).optional()
  })
]);

export const LocalTerminalRequestSchema = z.object({
  sessionId: IdSchema,
  shell: z.string().min(1).max(512).optional(),
  args: z.array(z.string().max(4096)).max(32).default([]),
  cwd: z.string().max(4096).optional(),
  cols: z.number().int().min(2).max(500).default(80),
  rows: z.number().int().min(1).max(300).default(24),
  term: z.enum(['xterm-256color', 'xterm', 'vt520', 'linux', 'screen']).default('xterm-256color')
});

export const TerminalClientMessageSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('input'), data: z.string().max(64 * 1024) }),
  z.object({
    kind: z.literal('resize'),
    cols: z.number().int().min(2).max(500),
    rows: z.number().int().min(1).max(300)
  }),
  z.object({
    kind: z.literal('ack'),
    bytes: z
      .number()
      .int()
      .positive()
      .max(4 * 1024 * 1024)
  }),
  z.object({ kind: z.literal('close') }),
  z.object({ kind: z.literal('host-key-decision'), decision: z.enum(['approve', 'reject']) })
]);

export const SshTerminalRequestSchema = z
  .object({
    sessionId: IdSchema,
    host: z.string().min(1).max(512),
    port: z.number().int().min(1).max(65535).default(22),
    username: z.string().min(1).max(256),
    term: z.enum(['xterm-256color', 'xterm', 'vt520', 'linux', 'screen']).default('xterm-256color'),
    cols: z.number().int().min(2).max(500).default(80),
    rows: z.number().int().min(1).max(300).default(24),
    password: z.string().max(4096).optional(),
    privateKey: z
      .string()
      .max(1024 * 1024)
      .optional(),
    passphrase: z.string().max(4096).optional()
  })
  .superRefine((value, context) => {
    if (!value.password && !value.privateKey) {
      context.addIssue({
        code: 'custom',
        path: ['password'],
        message: 'Password or private key is required'
      });
    }
  });

export const SshProfileTerminalRequestSchema = z
  .object({
    sessionId: IdSchema,
    profileId: IdSchema,
    cols: z.number().int().min(2).max(500).default(80),
    rows: z.number().int().min(1).max(300).default(24)
  })
  .strict();

export const SftpListRequestSchema = z
  .object({
    sessionId: IdSchema,
    directory: z.string().min(1).max(4096).default('.')
  })
  .strict();

export const SftpUploadRequestSchema = z
  .object({
    sessionId: IdSchema,
    remoteDirectory: z.string().min(1).max(4096).default('.')
  })
  .strict();

export const SftpDownloadRequestSchema = z
  .object({
    sessionId: IdSchema,
    remotePath: z.string().min(1).max(8192),
    suggestedName: z.string().min(1).max(4096)
  })
  .strict();

export const SftpOperationResultSchema = z.object({ accepted: z.boolean() }).strict();

export const SftpRemoteEntrySchema = z
  .object({
    name: z.string().min(1).max(4096),
    path: z.string().min(1).max(8192),
    longName: z.string().max(8192),
    kind: z.enum(['file', 'directory', 'symlink', 'other']),
    size: z.number().int().nonnegative(),
    modifiedAt: z.number().int().nonnegative().nullable()
  })
  .strict();

export const TerminalCommandActionSchema = z
  .object({
    sessionId: IdSchema,
    action: z.enum(['insert', 'run']),
    shell: z.enum(['bash', 'zsh', 'fish', 'powershell', 'cmd', 'unknown']),
    payload: z
      .string()
      .min(1)
      .max(256 * 1024),
    revision: IdSchema
  })
  .strict();

export const EnvironmentFactsSchema = z
  .object({
    os: z.string().max(160).optional(),
    distribution: z.string().max(160).optional(),
    kernel: z.string().max(256).optional(),
    architecture: z.string().max(80).optional(),
    shell: z.string().max(512).optional(),
    shellVersion: z.string().max(512).optional(),
    user: z.string().max(256).optional(),
    hostname: z.string().max(512).optional()
  })
  .strict();

export const EnvironmentRecordSchema = z
  .object({
    id: IdSchema,
    targetKey: z.string().min(1).max(512),
    kind: z.enum(['local', 'wsl', 'ssh']),
    facts: EnvironmentFactsSchema,
    notes: z.string().max(8192),
    instructions: z.string().max(8192),
    attachToAi: z.boolean(),
    detectedAt: z.string().max(64).nullable()
  })
  .strict();

export const EnvironmentProbeRequestSchema = z
  .object({
    kind: z.enum(['local', 'wsl']),
    distribution: z.string().max(256).optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.kind === 'wsl' && !value.distribution?.trim()) {
      context.addIssue({
        code: 'custom',
        path: ['distribution'],
        message: 'WSL distribution is required'
      });
    }
  });

export type AppInfo = z.infer<typeof AppInfoSchema>;
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export type StructuredError = z.infer<typeof StructuredErrorSchema>;
export type TerminalPortMessage = z.infer<typeof TerminalPortMessageSchema>;
export type LocalTerminalRequest = z.infer<typeof LocalTerminalRequestSchema>;
export type TerminalClientMessage = z.infer<typeof TerminalClientMessageSchema>;
export type SshTerminalRequest = z.infer<typeof SshTerminalRequestSchema>;
export type SshProfileTerminalRequest = z.infer<typeof SshProfileTerminalRequestSchema>;
export type SftpListRequest = z.infer<typeof SftpListRequestSchema>;
export type SftpUploadRequest = z.infer<typeof SftpUploadRequestSchema>;
export type SftpDownloadRequest = z.infer<typeof SftpDownloadRequestSchema>;
export type SftpOperationResult = z.infer<typeof SftpOperationResultSchema>;
export type SftpRemoteEntry = z.infer<typeof SftpRemoteEntrySchema>;
export type TerminalCommandAction = z.infer<typeof TerminalCommandActionSchema>;
export type EnvironmentFacts = z.infer<typeof EnvironmentFactsSchema>;
export type EnvironmentRecord = z.infer<typeof EnvironmentRecordSchema>;
export type EnvironmentProbeRequest = z.infer<typeof EnvironmentProbeRequestSchema>;
export type VaultPasswordRequest = z.infer<typeof VaultPasswordRequestSchema>;
export type VaultRotateRequest = z.infer<typeof VaultRotateRequestSchema>;
export type AutoUnlockStatus = z.infer<typeof AutoUnlockStatusSchema>;
export type AiDiscoverModelsRequest = z.infer<typeof AiDiscoverModelsRequestSchema>;
export type AiDiscoveredModels = z.infer<typeof AiDiscoveredModelsSchema>;
export type AiHistorySummary = z.infer<typeof AiHistorySummarySchema>;
export type AiHistoryList = z.infer<typeof AiHistoryListSchema>;
export type AiHistoryMessage = z.infer<typeof AiHistoryMessageSchema>;
export type AiHistoryLoadRequest = z.infer<typeof AiHistoryLoadRequestSchema>;
export type AiHistoryLoadResult = z.infer<typeof AiHistoryLoadResultSchema>;
export type AiHistorySaveRequest = z.infer<typeof AiHistorySaveRequestSchema>;
export type AiHistorySaved = z.infer<typeof AiHistorySavedSchema>;
export type VaultStatus = z.infer<typeof VaultStatusSchema>;
export type SessionProfileRecord = z.infer<typeof SessionProfileRecordSchema>;
export type ProfileCredentials = z.infer<typeof ProfileCredentialsSchema>;
export type SessionProfileSaveProfile = z.infer<typeof SessionProfileSaveProfileSchema>;
export type SessionProfileSaveRequest = z.infer<typeof SessionProfileSaveRequestSchema>;
export type UiStateRecord = z.infer<typeof UiStateRecordSchema>;
export type SettingsRecord = z.infer<typeof SettingsRecordSchema>;
export type WslDistribution = z.infer<typeof WslDistributionSchema>;
export type AiConnectionRecord = z.infer<typeof AiConnectionRecordSchema>;
export type AiConnectionInput = z.infer<typeof AiConnectionInputSchema>;
export type AiChatMessage = z.infer<typeof AiChatMessageSchema>;
export type AiStreamRequest = z.infer<typeof AiStreamRequestSchema>;
export type AiStreamEvent = z.infer<typeof AiStreamEventSchema>;
