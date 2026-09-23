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

export const UpdateStatusSchema = z
  .object({
    state: z.enum([
      'idle',
      'checking',
      'up-to-date',
      'available',
      'downloading',
      'downloaded',
      'error'
    ]),
    currentSha: z.union([z.literal('unknown'), z.string().regex(/^[a-f0-9]{40}$/i)]),
    latestSha: z
      .string()
      .regex(/^[a-f0-9]{40}$/i)
      .optional(),
    latestVersion: z.string().max(128).optional(),
    releaseUrl: z.string().url().max(2048).optional(),
    canInstall: z.boolean().default(false),
    progress: z.number().min(0).max(100).optional(),
    error: z.string().max(512).optional()
  })
  .strict();

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

export const SETTINGS_CATEGORIES = [
  'general',
  'appearance',
  'terminal',
  'shortcuts',
  'sftp',
  'ai-connections',
  'ai-assistant',
  'security',
  'about'
] as const;

export const SettingsOpenRequestSchema = z
  .object({ category: z.enum(SETTINGS_CATEGORIES).optional() })
  .strict();

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
    sidebarWidth: z.number().int().min(170).max(520).default(240),
    rightPanelWidth: z.number().int().min(280).max(760).default(360),
    splitRatio: z.number().min(0.15).max(0.85).optional()
  })
  .strict();

/** Persisted keybinding overrides keyed by command id; unknown ids and
 *  invalid specs are dropped when bindings are resolved. */
export const KeybindingOverridesSchema = z
  .record(z.string().min(1).max(64), z.string().min(1).max(64))
  .default({});

export const SettingsRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    language: z.enum(['en-US', 'zh-CN', 'system']),
    theme: z.string().min(1).max(160),
    terminalFontSize: z.number().min(8).max(32),
    terminalLineHeight: z.number().min(1).max(2),
    terminalPadding: z.number().int().min(0).max(32).default(0),
    terminalCursor: z.enum(['block', 'underline', 'bar']),
    defaultTerm: z.enum(['xterm-256color', 'xterm', 'vt520', 'linux', 'screen']),
    splitCommandPresentation: z.boolean(),
    allowRiskyRun: z.boolean().default(false),
    /** False keeps the historical quit-on-close behavior for missing settings. */
    keepRunningInBackground: z.boolean().default(false),
    terminalContextPrecedingLines: z.number().int().min(0).max(2000),
    remoteFileCommands: z.string().max(4096).default('cat\nless\nvim'),
    uiFontFamily: z.string().max(256).default(''),
    uiFontSize: z.number().min(10).max(24).default(13),
    terminalFontFamily: z.string().min(1).max(256).default('Cascadia Code'),
    terminalFontLigatures: z.boolean().default(false),
    keybindings: KeybindingOverridesSchema,
    terminalFontFallbacks: z
      .array(
        z
          .object({
            name: z.string().min(1).max(128),
            scale: z.number().min(0.5).max(2).default(1),
            offsetX: z.number().int().min(-10).max(10).default(0),
            offsetY: z.number().int().min(-10).max(10).default(0)
          })
          .strict()
      )
      .max(8)
      .default([]),
    defaultAiConnectionId: IdSchema.nullable().default(null),
    globalAiInstructions: z.string().max(8192).default('')
  })
  .strict();

export const WslDistributionSchema = z.object({
  name: z.string().min(1).max(256),
  isDefault: z.boolean(),
  state: z.enum(['running', 'stopped', 'transitional', 'unknown']),
  version: z.union([z.literal(1), z.literal(2), z.null()])
});

export const AiResponsesReasoningEffortSchema = z.enum([
  'default',
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
]);

export const AiResponsesVerbositySchema = z.enum(['default', 'low', 'medium', 'high']);

export const AiResponsesModelDefaultsSchema = z
  .object({
    reasoningEffort: AiResponsesReasoningEffortSchema.default('default'),
    verbosity: AiResponsesVerbositySchema.default('default'),
    reasoningSummary: z.boolean().default(true),
    webSearch: z.boolean().default(false)
  })
  .strict();

export const AiModelProfileSchema = z
  .object({
    id: z.string().min(1).max(256),
    model: z.string().min(1).max(256),
    label: z.string().max(256).optional(),
    responses: AiResponsesModelDefaultsSchema.optional()
  })
  .strict();

const LegacyAiModelSchema = z.string().min(1).max(256);
const AiModelListSchema = z.array(z.union([AiModelProfileSchema, LegacyAiModelSchema])).max(256);

function normalizeAiModels(
  models: Array<z.infer<typeof AiModelProfileSchema> | string>
): Array<z.infer<typeof AiModelProfileSchema>> {
  return models.map((model) =>
    typeof model === 'string' ? { id: model, model } : AiModelProfileSchema.parse(model)
  );
}

export const AiConnectionRecordSchema = z
  .object({
    id: IdSchema,
    name: z.string().min(1).max(160),
    protocol: z.enum(['responses', 'chat-completions']),
    baseUrl: z.string().url(),
    models: AiModelListSchema,
    defaultModel: z.string().min(1).max(256),
    apiKeyRef: IdSchema.optional(),
    acceptedEndpoint: z.string().max(512).optional()
  })
  .strict()
  .transform((value) => ({ ...value, models: normalizeAiModels(value.models) }));

const AiConnectionInputRecordSchema = z
  .object({
    id: IdSchema.optional(),
    name: z.string().min(1).max(160),
    protocol: z.enum(['responses', 'chat-completions']),
    baseUrl: z.string().min(1).max(2048),
    models: z.array(AiModelProfileSchema).min(1).max(256),
    defaultModel: z.string().min(1).max(256),
    apiKey: z.string().max(4096).optional()
  })
  .strict();

const LegacyAiConnectionInputSchema = z
  .object({
    id: IdSchema.optional(),
    name: z.string().min(1).max(160),
    protocol: z.enum(['responses', 'chat-completions']),
    baseUrl: z.string().min(1).max(2048),
    model: z.string().min(1).max(256),
    apiKey: z.string().max(4096).optional()
  })
  .strict();

export const AiConnectionInputSchema = z
  .union([AiConnectionInputRecordSchema, LegacyAiConnectionInputSchema])
  .transform((value) => {
    if ('model' in value) {
      return {
        ...value,
        models: [{ id: value.model, model: value.model }],
        defaultModel: value.model
      };
    }
    return value;
  });

export const AiConnectionDeleteRequestSchema = z.object({ id: IdSchema }).strict();

export const AiEndpointConsentRequestSchema = z
  .object({ connectionId: IdSchema, identity: z.string().max(512) })
  .strict();

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

export const AiHistoryIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9._-]+$/)
  .max(128);

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

export const AiSourceReferenceSchema = z
  .object({
    url: z
      .string()
      .url()
      .regex(/^https?:\/\//iu),
    title: z.string().max(512).optional()
  })
  .strict();

export const AiContinuationMetadataSchema = z
  .object({
    connectionId: IdSchema,
    model: z.string().min(1).max(256),
    items: z.array(z.record(z.string(), z.unknown())).max(32)
  })
  .strict();

export const AiSnapshotAttachmentSchema = z
  .object({
    source: z.enum(['selection', 'viewport', 'viewport+preceding']),
    truncated: z.boolean(),
    lineStart: z.number().int().nonnegative().nullable(),
    lineEnd: z.number().int().nonnegative().nullable(),
    charCount: z.number().int().nonnegative(),
    alternateScreen: z.boolean(),
    text: z.string().max(256 * 1024)
  })
  .strict();

export const AiHistoryMessageSchema = z
  .object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(256 * 1024),
    reasoning: z
      .string()
      .max(256 * 1024)
      .optional(),
    usage: z
      .object({
        inputTokens: z.number().int().nonnegative().optional(),
        outputTokens: z.number().int().nonnegative().optional(),
        reasoningTokens: z.number().int().nonnegative().optional()
      })
      .strict()
      .optional(),
    // Terminal snapshot attachments are no longer produced, but the field is
    // kept so persisted history files written by older builds still validate
    // (this schema is strict) instead of losing their message metadata.
    snapshot: AiSnapshotAttachmentSchema.optional(),
    sources: z.array(AiSourceReferenceSchema).max(128).optional(),
    continuation: AiContinuationMetadataSchema.optional()
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

export const AiHistoryContinueSchema = z.object({ id: AiHistoryIdSchema }).strict();

export const AiChatMessageSchema = z
  .object({
    role: z.enum(['system', 'user', 'assistant']),
    content: z.string().max(256 * 1024),
    continuation: AiContinuationMetadataSchema.optional()
  })
  .strict();

export const AiStreamResponseOptionsSchema = AiResponsesModelDefaultsSchema;

export const AiStreamRequestSchema = z
  .object({
    streamId: IdSchema,
    connectionId: IdSchema,
    model: z.string().min(1).max(256),
    targetKey: z.string().min(1).max(512).optional(),
    messages: z.array(AiChatMessageSchema).max(100),
    prompt: z
      .string()
      .min(1)
      .max(256 * 1024),
    responseOptions: AiStreamResponseOptionsSchema.optional()
  })
  .strict();

export const AiStreamClientMessageSchema = z.object({ kind: z.literal('cancel') }).strict();

export const AiActivityLabelSchema = z.enum([
  'connecting',
  'working',
  'writing',
  'searching-web',
  'searching-query',
  'reading-source',
  'reading-sources',
  'queued'
]);

export const AiStreamEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('delta'), text: z.string() }),
  z.object({ kind: z.literal('reasoning'), text: z.string() }),
  z.object({
    kind: z.literal('activity'),
    id: z.string().min(1).max(128),
    label: AiActivityLabelSchema,
    detail: z.string().max(200).optional(),
    state: z.enum(['running', 'done']).default('running')
  }),
  z.object({
    kind: z.literal('usage'),
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    reasoningTokens: z.number().int().nonnegative().optional()
  }),
  z.object({
    kind: z.literal('source'),
    url: z
      .string()
      .url()
      .regex(/^https?:\/\//iu),
    title: z.string().max(512).optional()
  }),
  z.object({
    kind: z.literal('continuation'),
    connectionId: IdSchema,
    model: z.string().min(1).max(256),
    items: z.array(z.record(z.string(), z.unknown())).max(32)
  }),
  z.object({
    kind: z.literal('consent-required'),
    endpoint: z.string().url(),
    identity: z.string().max(512),
    categories: z.array(
      z.enum([
        'system-prompt',
        'global-instructions',
        'environment-facts',
        'environment-instructions',
        'conversation-history',
        'current-prompt'
      ])
    )
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
  z.object({ kind: z.literal('host-key-decision'), decision: z.enum(['approve', 'reject']) }),
  // A shell line reconstructed by the renderer after Enter (raw buffer, or the
  // screen echo when completion/history made the buffer unreliable).
  z.object({ kind: z.literal('cd-line'), line: z.string().min(1).max(1024) })
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
    directory: z.string().min(1).max(4096).default('.'),
    // Panel listings that mirror the shell (cd-followed or cd-injected) may
    // re-anchor the tracked directory; standalone panel browsing must not.
    reanchor: z.boolean().default(false)
  })
  .strict();

export const SftpSendCdRequestSchema = z
  .object({
    sessionId: IdSchema,
    directory: z.string().min(1).max(4096)
  })
  .strict();

export const SftpSessionRequestSchema = z
  .object({
    sessionId: IdSchema
  })
  .strict();

export const SftpUploadRequestSchema = z
  .object({
    sessionId: IdSchema,
    remoteDirectory: z.string().min(1).max(4096).default('.'),
    choose: z.enum(['files', 'folders', 'both']).default('both')
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

export const SftpListResultSchema = z
  .object({
    directory: z.string().max(8192),
    entries: z.array(SftpRemoteEntrySchema).max(20000)
  })
  .strict();

export const SftpMkdirRequestSchema = z
  .object({
    sessionId: IdSchema,
    path: z.string().min(1).max(8192)
  })
  .strict();

export const SftpRenameRequestSchema = z
  .object({
    sessionId: IdSchema,
    source: z.string().min(1).max(8192),
    destination: z.string().min(1).max(8192)
  })
  .strict();

export const SftpDeleteRequestSchema = z
  .object({
    sessionId: IdSchema,
    paths: z.array(z.string().min(1).max(8192)).min(1).max(5000)
  })
  .strict();

export const SftpUploadPathsRequestSchema = z
  .object({
    sessionId: IdSchema,
    localPaths: z.array(z.string().min(1).max(4096)).min(1).max(5000),
    remoteDirectory: z.string().min(1).max(8192)
  })
  .strict();

export const SftpDownloadPathsRequestSchema = z
  .object({
    sessionId: IdSchema,
    remotePaths: z.array(z.string().min(1).max(8192)).min(1).max(5000),
    localDirectory: z.string().min(1).max(4096)
  })
  .strict();

export const SftpTransferIdRequestSchema = z.object({ transferId: IdSchema }).strict();

export const SftpTransferStatusSchema = z.enum([
  'queued',
  'active',
  'completed',
  'failed',
  'cancelled'
]);

export const SftpTransferSchema = z
  .object({
    id: IdSchema,
    sessionId: IdSchema,
    direction: z.enum(['upload', 'download']),
    name: z.string().min(1).max(4096),
    remotePath: z.string().min(1).max(8192),
    localPath: z.string().min(1).max(4096),
    totalBytes: z.number().int().nonnegative().nullable(),
    transferredBytes: z.number().int().nonnegative(),
    // Tree transfers report one aggregated entry per selected top-level item.
    fileCount: z.number().int().positive().optional(),
    status: SftpTransferStatusSchema,
    error: z.string().max(512).optional()
  })
  .strict();

export const SftpTransferEventSchema = z
  .object({
    kind: z.enum(['progress', 'state']),
    transfer: SftpTransferSchema
  })
  .strict();

export const SftpRemoteCommandRequestSchema = z
  .object({
    sessionId: IdSchema,
    command: z.string().min(1).max(256),
    remotePath: z.string().min(1).max(8192)
  })
  .strict();

export const SftpCdEventSchema = z
  .object({
    sessionId: IdSchema,
    directory: z.string().max(8192).nullable()
  })
  .strict();

export const SFTP_EDITOR_MAX_BYTES = 3 * 1024 * 1024;

export const SftpEditorOpenRequestSchema = z
  .object({
    sessionId: IdSchema,
    remotePath: z.string().min(1).max(8192)
  })
  .strict();

export const SftpEditorOpenResultSchema = z
  .object({
    status: z.enum(['opened', 'focused', 'busy']),
    activePath: z.string().min(1).max(8192)
  })
  .strict();

export const SftpEditorLineEndingSchema = z.enum(['lf', 'crlf', 'mixed']);

export const SftpEditorDocumentSchema = z
  .object({
    name: z.string().min(1).max(4096),
    remotePath: z.string().min(1).max(8192),
    content: z.string().max(SFTP_EDITOR_MAX_BYTES),
    byteLength: z.number().int().nonnegative().max(SFTP_EDITOR_MAX_BYTES),
    modifiedAt: z.number().int().nonnegative().nullable(),
    hasBom: z.boolean(),
    lineEnding: SftpEditorLineEndingSchema
  })
  .strict();

export const SftpEditorSaveRequestSchema = z
  .object({
    content: z.string().max(SFTP_EDITOR_MAX_BYTES),
    overwriteConflict: z.boolean().default(false)
  })
  .strict();

export const SftpEditorSaveResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('saved'),
      byteLength: z.number().int().nonnegative().max(SFTP_EDITOR_MAX_BYTES),
      modifiedAt: z.number().int().nonnegative().nullable()
    })
    .strict(),
  z
    .object({
      status: z.literal('conflict'),
      reason: z.enum(['modified', 'missing', 'not-file']),
      currentByteLength: z.number().int().nonnegative().optional(),
      currentModifiedAt: z.number().int().nonnegative().nullable().optional()
    })
    .strict()
]);

export const SftpEditorDirtyRequestSchema = z.object({ dirty: z.boolean() }).strict();

export const SftpEditorSavedEventSchema = z
  .object({
    sessionId: IdSchema,
    remotePath: z.string().min(1).max(8192)
  })
  .strict();

export const TerminalSnapshotDraftRequestSchema = z
  .object({ text: z.string().max(256 * 1024) })
  .strict();

export const TerminalSnapshotDraftSchema = z.object({ text: z.string().max(256 * 1024) }).strict();

export const TerminalSnapshotDraftChatRequestSchema = z.object({ text: z.string() }).strict();

export const TerminalSnapshotDraftChatEventSchema = z.object({ text: z.string() }).strict();

export const LocalListRequestSchema = z
  .object({
    directory: z.string().max(4096).nullable().default(null)
  })
  .strict();

export const LocalSessionRequestSchema = z
  .object({
    sessionId: IdSchema
  })
  .strict();

export const LocalWorkingDirectorySchema = z.string().min(1).max(4096).nullable();

export const LocalEntrySchema = z
  .object({
    name: z.string().min(1).max(4096),
    path: z.string().min(1).max(4096),
    kind: z.enum(['file', 'directory', 'drive', 'symlink', 'other']),
    size: z.number().int().nonnegative(),
    modifiedAt: z.number().int().nonnegative().nullable(),
    permissions: z.string().max(16),
    guarded: z.boolean()
  })
  .strict();

export const LocalMkdirRequestSchema = z
  .object({
    parent: z.string().min(1).max(4096),
    name: z.string().min(1).max(255)
  })
  .strict();

export const LocalRenameRequestSchema = z
  .object({
    source: z.string().min(1).max(4096),
    destination: z.string().min(1).max(4096)
  })
  .strict();

export const LocalDeleteRequestSchema = z
  .object({
    paths: z.array(z.string().min(1).max(4096)).min(1).max(5000)
  })
  .strict();

export const LocalOpenRequestSchema = z
  .object({
    path: z.string().min(1).max(4096)
  })
  .strict();

export const BUILTIN_THEME_NAMES = [
  'Geared Dark',
  'Midnight',
  'Light',
  'Catppuccin Mocha',
  'Catppuccin Macchiato',
  'Catppuccin Frappé',
  'Catppuccin Latte'
] as const;

const ThemeColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/u);

export const ThemeColorsSchema = z
  .object({
    background: ThemeColorSchema,
    foreground: ThemeColorSchema,
    cursor: ThemeColorSchema,
    selection: ThemeColorSchema.optional(),
    accent: ThemeColorSchema.optional(),
    bright: ThemeColorSchema.optional(),
    panel: ThemeColorSchema.optional(),
    panelAlt: ThemeColorSchema.optional(),
    shell: ThemeColorSchema.optional(),
    divider: ThemeColorSchema.optional(),
    text: ThemeColorSchema.optional(),
    border: ThemeColorSchema.optional(),
    borderStrong: ThemeColorSchema.optional(),
    inputBackground: ThemeColorSchema.optional(),
    hover: ThemeColorSchema.optional(),
    textDim: ThemeColorSchema.optional(),
    textMuted: ThemeColorSchema.optional(),
    danger: ThemeColorSchema.optional(),
    searchMatch: ThemeColorSchema.optional(),
    searchMatchActive: ThemeColorSchema.optional(),
    ansi: z.array(ThemeColorSchema).length(16).optional()
  })
  .strict();

export const UserThemeSchema = z
  .object({
    name: z.string().min(1).max(160),
    colors: ThemeColorsSchema
  })
  .strict();

export const InvalidThemeFileSchema = z
  .object({
    file: z.string().max(4096),
    error: z.string().max(512)
  })
  .strict();

export const UserThemeListSchema = z
  .object({
    themes: z.array(UserThemeSchema).max(200),
    invalid: z.array(InvalidThemeFileSchema).max(200)
  })
  .strict();

export const RuntimeInfoSchema = z
  .object({
    electron: z.string().max(64),
    chrome: z.string().max(64),
    node: z.string().max(64),
    configDirectory: z.string().max(4096),
    themeDirectory: z.string().max(4096)
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

/**
 * Shells treat CR as accept-line, but on Windows ConPTY an LF in the input
 * stream is not a proper Enter and derails PSReadLine's multi-line rendering.
 * Every line break written to a terminal must therefore become CR, matching
 * what a keyboard Enter (or a mainstream terminal paste) sends.
 */
export function normalizeTerminalLineEndings(text: string): string {
  return text.replace(/\r?\n/g, '\r');
}

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
    verified: z.boolean().default(false),
    detectedAt: z.string().max(64).nullable()
  })
  .strict();

export const EnvironmentProbeRequestSchema = z
  .object({
    kind: z.enum(['local', 'wsl']),
    distribution: z.string().max(256).optional(),
    shell: z.string().max(512).optional(),
    cwd: z.string().max(4096).optional(),
    environment: z.record(z.string().max(128), z.string().max(4096)).optional()
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
export type UpdateStatus = z.infer<typeof UpdateStatusSchema>;
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export type StructuredError = z.infer<typeof StructuredErrorSchema>;
export type TerminalPortMessage = z.infer<typeof TerminalPortMessageSchema>;
export type LocalTerminalRequest = z.infer<typeof LocalTerminalRequestSchema>;
export type TerminalClientMessage = z.infer<typeof TerminalClientMessageSchema>;
export type SshTerminalRequest = z.infer<typeof SshTerminalRequestSchema>;
export type SshProfileTerminalRequest = z.infer<typeof SshProfileTerminalRequestSchema>;
export type SftpListRequest = z.infer<typeof SftpListRequestSchema>;
export type SftpSendCdRequest = z.infer<typeof SftpSendCdRequestSchema>;
export type SftpSessionRequest = z.infer<typeof SftpSessionRequestSchema>;
export type SftpUploadRequest = z.infer<typeof SftpUploadRequestSchema>;
export type SftpDownloadRequest = z.infer<typeof SftpDownloadRequestSchema>;
export type SftpOperationResult = z.infer<typeof SftpOperationResultSchema>;
export type SftpRemoteEntry = z.infer<typeof SftpRemoteEntrySchema>;
export type SftpListResult = z.infer<typeof SftpListResultSchema>;
export type SftpMkdirRequest = z.infer<typeof SftpMkdirRequestSchema>;
export type SftpRenameRequest = z.infer<typeof SftpRenameRequestSchema>;
export type SftpDeleteRequest = z.infer<typeof SftpDeleteRequestSchema>;
export type SftpUploadPathsRequest = z.infer<typeof SftpUploadPathsRequestSchema>;
export type SftpDownloadPathsRequest = z.infer<typeof SftpDownloadPathsRequestSchema>;
export type SftpTransferIdRequest = z.infer<typeof SftpTransferIdRequestSchema>;
export type SftpTransferStatus = z.infer<typeof SftpTransferStatusSchema>;
export type SftpTransfer = z.infer<typeof SftpTransferSchema>;
export type SftpTransferEvent = z.infer<typeof SftpTransferEventSchema>;
export type SftpRemoteCommandRequest = z.infer<typeof SftpRemoteCommandRequestSchema>;
export type SftpCdEvent = z.infer<typeof SftpCdEventSchema>;
export type SftpEditorOpenRequest = z.infer<typeof SftpEditorOpenRequestSchema>;
export type SftpEditorOpenResult = z.infer<typeof SftpEditorOpenResultSchema>;
export type SftpEditorLineEnding = z.infer<typeof SftpEditorLineEndingSchema>;
export type SftpEditorDocument = z.infer<typeof SftpEditorDocumentSchema>;
export type SftpEditorSaveRequest = z.infer<typeof SftpEditorSaveRequestSchema>;
export type SftpEditorSaveResult = z.infer<typeof SftpEditorSaveResultSchema>;
export type SftpEditorDirtyRequest = z.infer<typeof SftpEditorDirtyRequestSchema>;
export type SftpEditorSavedEvent = z.infer<typeof SftpEditorSavedEventSchema>;
export type TerminalSnapshotDraftRequest = z.infer<typeof TerminalSnapshotDraftRequestSchema>;
export type TerminalSnapshotDraft = z.infer<typeof TerminalSnapshotDraftSchema>;
export type TerminalSnapshotDraftChatRequest = z.infer<
  typeof TerminalSnapshotDraftChatRequestSchema
>;
export type TerminalSnapshotDraftChatEvent = z.infer<typeof TerminalSnapshotDraftChatEventSchema>;
export type LocalListRequest = z.infer<typeof LocalListRequestSchema>;
export type LocalSessionRequest = z.infer<typeof LocalSessionRequestSchema>;
export type LocalWorkingDirectory = z.infer<typeof LocalWorkingDirectorySchema>;
export type LocalEntry = z.infer<typeof LocalEntrySchema>;
export type LocalMkdirRequest = z.infer<typeof LocalMkdirRequestSchema>;
export type LocalRenameRequest = z.infer<typeof LocalRenameRequestSchema>;
export type LocalDeleteRequest = z.infer<typeof LocalDeleteRequestSchema>;
export type LocalOpenRequest = z.infer<typeof LocalOpenRequestSchema>;
export type ThemeColors = z.infer<typeof ThemeColorsSchema>;
export type UserTheme = z.infer<typeof UserThemeSchema>;
export type InvalidThemeFile = z.infer<typeof InvalidThemeFileSchema>;
export type UserThemeList = z.infer<typeof UserThemeListSchema>;
export type RuntimeInfo = z.infer<typeof RuntimeInfoSchema>;

const REMOTE_COMMAND_CONTROL_CHARACTERS = /[\u0000-\u0008\u000a-\u001f\u007f]/u;

/** Parses the one-per-line remote-file commands setting, deduplicating in order. */
export function parseRemoteFileCommands(text: string): string[] {
  const seen = new Set<string>();
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || REMOTE_COMMAND_CONTROL_CHARACTERS.test(line)) continue;
    seen.add(line);
    if (seen.size >= 32) break;
  }
  return [...seen];
}

export type TerminalFontFallbackEntry = {
  name: string;
  scale: number;
  offsetX: number;
  offsetY: number;
};

/**
 * Normalizes the ordered terminal fallback fonts: blanks and invalid entries
 * are removed, duplicates collapse to the first occurrence, the primary font
 * is excluded, and the remaining order is preserved.
 */
export function normalizeTerminalFontFallbacks(
  primary: string,
  entries: TerminalFontFallbackEntry[]
): TerminalFontFallbackEntry[] {
  const normalizedPrimary = primary.trim().toLowerCase();
  const seen = new Set<string>();
  const result: TerminalFontFallbackEntry[] = [];
  for (const entry of entries) {
    const name = entry.name.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (key === normalizedPrimary || seen.has(key)) continue;
    seen.add(key);
    result.push({ ...entry, name });
    if (result.length >= 8) break;
  }
  return result;
}

/**
 * Conservative set of programming ligature sequences shared by the most
 * common coding fonts (Fira Code, Cascadia Code, JetBrains Mono). Used as the
 * joiner table when the actual font cannot be inspected.
 */
export const DEFAULT_TERMINAL_LIGATURE_SEQUENCES: readonly string[] = parseLigatureCorpus(`
  -> ->> --> -< -<<
  => =>> =<<
  == === =:= =/= =/
  != !== !!
  <= <<= <=> <== <==>
  >= >>= >>> >>-
  <- <-- <<- <-> <-->
  :: ::: :=
  && || ||=
  ..< ..= ... ..
  << >>
  |> <| <|> ||>
  ~~ ~~> ~=
  ++ +++
  /// //! /* */ //
  ## ### -- --- __
  <$ <@ <+ <* </ </>
`);

/**
 * Additional, font-specific ligature sequences that are only probed against
 * the real font tables and are never joined blindly by the fallback table.
 */
export const EXTENDED_TERMINAL_LIGATURE_SEQUENCES: readonly string[] = parseLigatureCorpus(`
  =< <: >: -~ .? =^
  ?. ?: ;; ;;;
  ||| <|| |-> <-< <-| |- -|
  >-> >=> <~~ ~~<
  /\\ \\/ <//> <% %>
  |= &= ::= [|] {|} |]
`);

function parseLigatureCorpus(corpus: string): string[] {
  return corpus.split(/\s+/).filter((sequence) => sequence.length > 0);
}

const LIGATURE_SEQUENCE_PATTERN = /^[\x21-\x7e]+$/;

/**
 * Normalizes a ligature sequence list: keeps only printable ASCII sequences of
 * two to eight characters, deduplicates, and orders longest-first so that
 * regex-based joiners prefer the widest match at each position.
 */
export function normalizeLigatureSequences(sequences: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const raw of sequences) {
    const sequence = raw.trim();
    if (sequence.length < 2 || sequence.length > 8) continue;
    if (!LIGATURE_SEQUENCE_PATTERN.test(sequence)) continue;
    seen.add(sequence);
  }
  return [...seen].sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
}

export const TerminalLigatureRequestSchema = z
  .object({
    fontFamily: z.string().min(1).max(256)
  })
  .strict();

export const TerminalLigatureSequencesSchema = z.array(z.string().min(1).max(8)).max(2048);
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
export type AiHistoryContinue = z.infer<typeof AiHistoryContinueSchema>;
export type AiSourceReference = z.infer<typeof AiSourceReferenceSchema>;
export type AiContinuationMetadata = z.infer<typeof AiContinuationMetadataSchema>;
export type VaultStatus = z.infer<typeof VaultStatusSchema>;
export type SessionProfileRecord = z.infer<typeof SessionProfileRecordSchema>;
export type ProfileCredentials = z.infer<typeof ProfileCredentialsSchema>;
export type SessionProfileSaveProfile = z.infer<typeof SessionProfileSaveProfileSchema>;
export type SessionProfileSaveRequest = z.infer<typeof SessionProfileSaveRequestSchema>;
export type UiStateRecord = z.infer<typeof UiStateRecordSchema>;
export type SettingsRecord = z.infer<typeof SettingsRecordSchema>;
export type TerminalLigatureRequest = z.infer<typeof TerminalLigatureRequestSchema>;
export type WslDistribution = z.infer<typeof WslDistributionSchema>;
export type AiConnectionRecord = z.infer<typeof AiConnectionRecordSchema>;
export type AiConnectionInput = z.infer<typeof AiConnectionInputSchema>;
export type AiEndpointConsentRequest = z.infer<typeof AiEndpointConsentRequestSchema>;
export type AiResponsesReasoningEffort = z.infer<typeof AiResponsesReasoningEffortSchema>;
export type AiResponsesVerbosity = z.infer<typeof AiResponsesVerbositySchema>;
export type AiResponsesModelDefaults = z.infer<typeof AiResponsesModelDefaultsSchema>;
export type AiModelProfile = z.infer<typeof AiModelProfileSchema>;
export type AiChatMessage = z.infer<typeof AiChatMessageSchema>;
export type AiSnapshotAttachment = z.infer<typeof AiSnapshotAttachmentSchema>;
export type AiStreamRequest = z.infer<typeof AiStreamRequestSchema>;
export type AiStreamEvent = z.infer<typeof AiStreamEventSchema>;
export type AiActivityLabel = z.infer<typeof AiActivityLabelSchema>;
