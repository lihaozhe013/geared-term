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
export const VaultStatusSchema = z.object({ initialized: z.boolean(), unlocked: z.boolean() });

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
    rightPanel: z.enum(['sftp', 'assistant']).nullable(),
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

export type AppInfo = z.infer<typeof AppInfoSchema>;
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export type StructuredError = z.infer<typeof StructuredErrorSchema>;
export type TerminalPortMessage = z.infer<typeof TerminalPortMessageSchema>;
export type LocalTerminalRequest = z.infer<typeof LocalTerminalRequestSchema>;
export type TerminalClientMessage = z.infer<typeof TerminalClientMessageSchema>;
export type SshTerminalRequest = z.infer<typeof SshTerminalRequestSchema>;
export type SshProfileTerminalRequest = z.infer<typeof SshProfileTerminalRequestSchema>;
export type VaultPasswordRequest = z.infer<typeof VaultPasswordRequestSchema>;
export type VaultStatus = z.infer<typeof VaultStatusSchema>;
export type SessionProfileRecord = z.infer<typeof SessionProfileRecordSchema>;
export type UiStateRecord = z.infer<typeof UiStateRecordSchema>;
export type SettingsRecord = z.infer<typeof SettingsRecordSchema>;
export type WslDistribution = z.infer<typeof WslDistributionSchema>;
export type AiConnectionRecord = z.infer<typeof AiConnectionRecordSchema>;
export type AiConnectionInput = z.infer<typeof AiConnectionInputSchema>;
export type AiChatMessage = z.infer<typeof AiChatMessageSchema>;
export type AiStreamRequest = z.infer<typeof AiStreamRequestSchema>;
export type AiStreamEvent = z.infer<typeof AiStreamEventSchema>;
