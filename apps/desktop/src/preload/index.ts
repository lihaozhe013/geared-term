import { contextBridge, ipcRenderer } from 'electron';
import {
  AppInfoSchema,
  AiConnectionDeleteRequestSchema,
  AiConnectionInputSchema,
  AiConnectionRecordSchema,
  AiStreamClientMessageSchema,
  AiStreamEventSchema,
  AiStreamRequestSchema,
  EnvironmentFactsSchema,
  EnvironmentProbeRequestSchema,
  EnvironmentRecordSchema,
  LocalTerminalRequestSchema,
  ProfileIdRequestSchema,
  SessionProfileRecordSchema,
  SessionProfileSaveRequestSchema,
  SettingsRecordSchema,
  SftpDownloadRequestSchema,
  SftpListRequestSchema,
  SftpOperationResultSchema,
  SftpRemoteEntrySchema,
  SftpUploadRequestSchema,
  SshProfileTerminalRequestSchema,
  SshTerminalRequestSchema,
  TerminalCommandActionSchema,
  VaultPasswordRequestSchema,
  VaultStatusSchema,
  TerminalClientMessageSchema,
  TerminalPortMessageSchema,
  UiStateRecordSchema,
  WslDistributionSchema,
  type LocalTerminalRequest,
  type AiConnectionInput,
  type AiStreamRequest,
  type EnvironmentProbeRequest,
  type EnvironmentRecord,
  type SessionProfileRecord,
  type SessionProfileSaveRequest,
  type SettingsRecord,
  type SftpListRequest,
  type SftpDownloadRequest,
  type SftpUploadRequest,
  type TerminalCommandAction,
  type SshProfileTerminalRequest,
  type SshTerminalRequest,
  type UiStateRecord,
  type VaultPasswordRequest,
  type WslDistribution
} from '@geared-term/protocol';

const api = Object.freeze({
  getAppInfo: async () => AppInfoSchema.parse(await ipcRenderer.invoke('app:get-info', {})),
  createLocalTerminal: (input: LocalTerminalRequest, onMessage: (message: unknown) => void) => {
    const request = LocalTerminalRequestSchema.parse(input);
    const channel = new MessageChannel();
    channel.port1.onmessage = (event) => {
      const result = TerminalPortMessageSchema.safeParse(event.data);
      if (result.success) {
        onMessage(result.data);
      }
    };
    channel.port1.start();
    ipcRenderer.postMessage('terminal:create-local', request, [channel.port2]);
    return Object.freeze({
      sendInput: (data: string) =>
        channel.port1.postMessage(TerminalClientMessageSchema.parse({ kind: 'input', data })),
      resize: (cols: number, rows: number) =>
        channel.port1.postMessage(
          TerminalClientMessageSchema.parse({ kind: 'resize', cols, rows })
        ),
      acknowledge: (bytes: number) =>
        channel.port1.postMessage(TerminalClientMessageSchema.parse({ kind: 'ack', bytes })),
      close: () => {
        channel.port1.postMessage({ kind: 'close' });
        channel.port1.close();
      }
    });
  },
  createSshTerminal: (input: SshTerminalRequest, onMessage: (message: unknown) => void) => {
    const request = SshTerminalRequestSchema.parse(input);
    const channel = new MessageChannel();
    channel.port1.onmessage = (event) => {
      const result = TerminalPortMessageSchema.safeParse(event.data);
      if (result.success) onMessage(result.data);
    };
    channel.port1.start();
    ipcRenderer.postMessage('terminal:create-ssh', request, [channel.port2]);
    return Object.freeze({
      sendInput: (data: string) =>
        channel.port1.postMessage(TerminalClientMessageSchema.parse({ kind: 'input', data })),
      resize: (cols: number, rows: number) =>
        channel.port1.postMessage(
          TerminalClientMessageSchema.parse({ kind: 'resize', cols, rows })
        ),
      acknowledge: (bytes: number) =>
        channel.port1.postMessage(TerminalClientMessageSchema.parse({ kind: 'ack', bytes })),
      decideHostKey: (decision: 'approve' | 'reject') =>
        channel.port1.postMessage(
          TerminalClientMessageSchema.parse({ kind: 'host-key-decision', decision })
        ),
      close: () => {
        channel.port1.postMessage({ kind: 'close' });
        channel.port1.close();
      }
    });
  },
  createSavedSshTerminal: (
    input: SshProfileTerminalRequest,
    onMessage: (message: unknown) => void
  ) => {
    const request = SshProfileTerminalRequestSchema.parse(input);
    const channel = new MessageChannel();
    channel.port1.onmessage = (event) => {
      const result = TerminalPortMessageSchema.safeParse(event.data);
      if (result.success) onMessage(result.data);
    };
    channel.port1.start();
    ipcRenderer.postMessage('terminal:create-saved-ssh', request, [channel.port2]);
    return Object.freeze({
      sendInput: (data: string) =>
        channel.port1.postMessage(TerminalClientMessageSchema.parse({ kind: 'input', data })),
      resize: (cols: number, rows: number) =>
        channel.port1.postMessage(
          TerminalClientMessageSchema.parse({ kind: 'resize', cols, rows })
        ),
      acknowledge: (bytes: number) =>
        channel.port1.postMessage(TerminalClientMessageSchema.parse({ kind: 'ack', bytes })),
      decideHostKey: (decision: 'approve' | 'reject') =>
        channel.port1.postMessage(
          TerminalClientMessageSchema.parse({ kind: 'host-key-decision', decision })
        ),
      close: () => {
        channel.port1.postMessage({ kind: 'close' });
        channel.port1.close();
      }
    });
  },
  getVaultStatus: async () => VaultStatusSchema.parse(await ipcRenderer.invoke('vault:get-status')),
  initializeVault: async (input: VaultPasswordRequest) => {
    const request = VaultPasswordRequestSchema.parse(input);
    return VaultStatusSchema.parse(await ipcRenderer.invoke('vault:initialize', request));
  },
  unlockVault: async (input: VaultPasswordRequest) => {
    const request = VaultPasswordRequestSchema.parse(input);
    return VaultStatusSchema.parse(await ipcRenderer.invoke('vault:unlock', request));
  },
  lockVault: async () => VaultStatusSchema.parse(await ipcRenderer.invoke('vault:lock')),
  listAiConnections: async () =>
    AiConnectionRecordSchema.array().parse(await ipcRenderer.invoke('ai:list')),
  saveAiConnection: async (input: AiConnectionInput) => {
    const connection = AiConnectionInputSchema.parse(input);
    return AiConnectionRecordSchema.array().parse(await ipcRenderer.invoke('ai:save', connection));
  },
  deleteAiConnection: async (id: string) => {
    const request = AiConnectionDeleteRequestSchema.parse({ id });
    return AiConnectionRecordSchema.array().parse(await ipcRenderer.invoke('ai:delete', request));
  },
  streamAi: (input: AiStreamRequest, onEvent: (event: unknown) => void) => {
    const request = AiStreamRequestSchema.parse(input);
    const channel = new MessageChannel();
    channel.port1.onmessage = (event) => {
      const result = AiStreamEventSchema.safeParse(event.data);
      if (result.success) onEvent(result.data);
    };
    channel.port1.start();
    ipcRenderer.postMessage('ai:stream', request, [channel.port2]);
    return Object.freeze({
      cancel: () => {
        channel.port1.postMessage(AiStreamClientMessageSchema.parse({ kind: 'cancel' }));
        channel.port1.close();
      }
    });
  },
  listProfiles: async () =>
    SessionProfileRecordSchema.array().parse(await ipcRenderer.invoke('profile:list')),
  saveProfile: async (input: SessionProfileRecord) => {
    const profile = SessionProfileRecordSchema.parse(input);
    const { secretRefs: _secretRefs, ...profileWithoutSecrets } = profile;
    return SessionProfileRecordSchema.array().parse(
      await ipcRenderer.invoke('profile:save-with-credentials', {
        profile: profileWithoutSecrets
      })
    );
  },
  saveProfileWithCredentials: async (input: SessionProfileSaveRequest) => {
    const request = SessionProfileSaveRequestSchema.parse(input);
    return SessionProfileRecordSchema.array().parse(
      await ipcRenderer.invoke('profile:save-with-credentials', request)
    );
  },
  deleteProfile: async (id: string) => {
    const request = ProfileIdRequestSchema.parse({ id });
    return SessionProfileRecordSchema.array().parse(
      await ipcRenderer.invoke('profile:delete', request)
    );
  },
  getUiState: async () => UiStateRecordSchema.parse(await ipcRenderer.invoke('ui:get-state')),
  saveUiState: async (input: UiStateRecord) => {
    const state = UiStateRecordSchema.parse(input);
    return UiStateRecordSchema.parse(await ipcRenderer.invoke('ui:save-state', state));
  },
  getSettings: async () => SettingsRecordSchema.parse(await ipcRenderer.invoke('settings:get')),
  saveSettings: async (input: SettingsRecord) => {
    const settings = SettingsRecordSchema.parse(input);
    return SettingsRecordSchema.parse(await ipcRenderer.invoke('settings:save', settings));
  },
  listSftp: async (input: SftpListRequest) => {
    const request = SftpListRequestSchema.parse(input);
    return SftpRemoteEntrySchema.array().parse(await ipcRenderer.invoke('sftp:list', request));
  },
  uploadSftp: async (input: SftpUploadRequest) => {
    const request = SftpUploadRequestSchema.parse(input);
    return SftpOperationResultSchema.parse(await ipcRenderer.invoke('sftp:upload', request));
  },
  downloadSftp: async (input: SftpDownloadRequest) => {
    const request = SftpDownloadRequestSchema.parse(input);
    return SftpOperationResultSchema.parse(await ipcRenderer.invoke('sftp:download', request));
  },
  executeCommandAction: async (input: TerminalCommandAction) => {
    const action = TerminalCommandActionSchema.parse(input);
    return ipcRenderer.invoke('terminal:command-action', action) as Promise<{ accepted: true }>;
  },
  listEnvironments: async () =>
    EnvironmentRecordSchema.array().parse(await ipcRenderer.invoke('environment:list')),
  saveEnvironment: async (input: EnvironmentRecord) => {
    const environment = EnvironmentRecordSchema.parse(input);
    return EnvironmentRecordSchema.array().parse(
      await ipcRenderer.invoke('environment:save', environment)
    );
  },
  deleteEnvironment: async (id: string) =>
    EnvironmentRecordSchema.array().parse(await ipcRenderer.invoke('environment:delete', { id })),
  probeEnvironment: async (input: EnvironmentProbeRequest) => {
    const request = EnvironmentProbeRequestSchema.parse(input);
    return EnvironmentFactsSchema.parse(await ipcRenderer.invoke('environment:probe', request));
  },
  discoverWsl: async (): Promise<WslDistribution[]> =>
    WslDistributionSchema.array().parse(await ipcRenderer.invoke('wsl:list'))
});

contextBridge.exposeInMainWorld('geared', api);
