import { contextBridge, ipcRenderer } from 'electron';
import {
  AppInfoSchema,
  AiConnectionDeleteRequestSchema,
  AiConnectionInputSchema,
  AiConnectionRecordSchema,
  AiStreamClientMessageSchema,
  AiStreamEventSchema,
  AiStreamRequestSchema,
  AiDiscoverModelsRequestSchema,
  AiDiscoveredModelsSchema,
  AiHistoryListSchema,
  AiHistoryLoadRequestSchema,
  AiHistoryLoadResultSchema,
  AiHistorySaveRequestSchema,
  AiHistorySavedSchema,
  EnvironmentFactsSchema,
  EnvironmentProbeRequestSchema,
  EnvironmentRecordSchema,
  LocalTerminalRequestSchema,
  ProfileIdRequestSchema,
  SessionProfileRecordSchema,
  SessionProfileSaveRequestSchema,
  SettingsOpenRequestSchema,
  SettingsRecordSchema,
  SftpDownloadRequestSchema,
  SftpListRequestSchema,
  SftpListResultSchema,
  SftpMkdirRequestSchema,
  SftpRenameRequestSchema,
  SftpDeleteRequestSchema,
  SftpUploadPathsRequestSchema,
  SftpDownloadPathsRequestSchema,
  SftpTransferIdRequestSchema,
  SftpTransferSchema,
  SftpTransferEventSchema,
  SftpRemoteCommandRequestSchema,
  SftpCdEventSchema,
  LocalListRequestSchema,
  LocalEntrySchema,
  LocalMkdirRequestSchema,
  LocalRenameRequestSchema,
  LocalDeleteRequestSchema,
  LocalOpenRequestSchema,
  RuntimeInfoSchema,
  UserThemeListSchema,
  SftpOperationResultSchema,
  SftpUploadRequestSchema,
  SshProfileTerminalRequestSchema,
  SshTerminalRequestSchema,
  TerminalCommandActionSchema,
  VaultPasswordRequestSchema,
  VaultRotateRequestSchema,
  VaultStatusSchema,
  AutoUnlockStatusSchema,
  TerminalClientMessageSchema,
  TerminalPortMessageSchema,
  UiStateRecordSchema,
  WslDistributionSchema,
  type LocalTerminalRequest,
  type AiConnectionInput,
  type AiStreamRequest,
  type AiDiscoverModelsRequest,
  type AiHistoryLoadRequest,
  type AiHistorySaveRequest,
  type EnvironmentProbeRequest,
  type EnvironmentRecord,
  type SessionProfileRecord,
  type SessionProfileSaveRequest,
  type VaultRotateRequest,
  type SettingsRecord,
  type SftpListRequest,
  type SftpDownloadRequest,
  type SftpUploadRequest,
  type SftpMkdirRequest,
  type SftpRenameRequest,
  type SftpDeleteRequest,
  type SftpUploadPathsRequest,
  type SftpDownloadPathsRequest,
  type SftpTransferEvent,
  type SftpRemoteCommandRequest,
  type SftpCdEvent,
  type LocalMkdirRequest,
  type LocalRenameRequest,
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
  rotateVault: async (input: VaultRotateRequest) => {
    const request = VaultRotateRequestSchema.parse(input);
    return VaultStatusSchema.parse(await ipcRenderer.invoke('vault:rotate', request));
  },
  getAutoUnlockStatus: async () =>
    AutoUnlockStatusSchema.parse(await ipcRenderer.invoke('vault:auto-unlock-status')),
  enableAutoUnlock: async () =>
    AutoUnlockStatusSchema.parse(await ipcRenderer.invoke('vault:enable-auto-unlock')),
  disableAutoUnlock: async () =>
    AutoUnlockStatusSchema.parse(await ipcRenderer.invoke('vault:disable-auto-unlock')),
  listAiConnections: async () =>
    AiConnectionRecordSchema.array().parse(await ipcRenderer.invoke('ai:list')),
  saveAiConnection: async (input: AiConnectionInput) => {
    const connection = AiConnectionInputSchema.parse(input);
    return AiConnectionRecordSchema.array().parse(await ipcRenderer.invoke('ai:save', connection));
  },
  discoverAiModels: async (input: AiDiscoverModelsRequest) => {
    const request = AiDiscoverModelsRequestSchema.parse(input);
    return AiDiscoveredModelsSchema.parse(await ipcRenderer.invoke('ai:discover-models', request));
  },
  listAiHistory: async () => AiHistoryListSchema.parse(await ipcRenderer.invoke('ai:history:list')),
  loadAiHistory: async (input: AiHistoryLoadRequest) => {
    const request = AiHistoryLoadRequestSchema.parse(input);
    return AiHistoryLoadResultSchema.parse(await ipcRenderer.invoke('ai:history:load', request));
  },
  saveAiHistory: async (input: AiHistorySaveRequest) => {
    const request = AiHistorySaveRequestSchema.parse(input);
    return AiHistorySavedSchema.parse(await ipcRenderer.invoke('ai:history:save', request));
  },
  deleteAiHistory: async (id: string) => {
    const request = AiHistoryLoadRequestSchema.parse({ id });
    return (await ipcRenderer.invoke('ai:history:delete', request)) as { deleted: boolean };
  },
  openAiHistoryDirectory: async () =>
    (await ipcRenderer.invoke('ai:history:open-directory')) as { opened: boolean },
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
  openSettings: async (category?: string) => {
    const request = SettingsOpenRequestSchema.parse({ category });
    return SftpOperationResultSchema.parse(await ipcRenderer.invoke('app:open-settings', request));
  },
  onSettingsChanged: (listener: (settings: SettingsRecord) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      const result = SettingsRecordSchema.safeParse(payload);
      if (result.success) listener(result.data);
    };
    ipcRenderer.on('settings:changed', handler);
    return () => ipcRenderer.removeListener('settings:changed', handler);
  },
  onSettingsNavigate: (listener: (category: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      if (typeof payload === 'string') listener(payload);
    };
    ipcRenderer.on('settings:navigate', handler);
    return () => ipcRenderer.removeListener('settings:navigate', handler);
  },
  listSftp: async (input: SftpListRequest) => {
    const request = SftpListRequestSchema.parse(input);
    return SftpListResultSchema.parse(await ipcRenderer.invoke('sftp:list', request));
  },
  sftpMkdir: async (input: SftpMkdirRequest) => {
    const request = SftpMkdirRequestSchema.parse(input);
    return SftpOperationResultSchema.parse(await ipcRenderer.invoke('sftp:mkdir', request));
  },
  sftpRename: async (input: SftpRenameRequest) => {
    const request = SftpRenameRequestSchema.parse(input);
    return SftpOperationResultSchema.parse(await ipcRenderer.invoke('sftp:rename', request));
  },
  sftpDelete: async (input: SftpDeleteRequest) => {
    const request = SftpDeleteRequestSchema.parse(input);
    return SftpOperationResultSchema.parse(await ipcRenderer.invoke('sftp:delete', request));
  },
  uploadPathsSftp: async (input: SftpUploadPathsRequest) => {
    const request = SftpUploadPathsRequestSchema.parse(input);
    return SftpTransferSchema.array().parse(await ipcRenderer.invoke('sftp:upload-paths', request));
  },
  downloadPathsSftp: async (input: SftpDownloadPathsRequest) => {
    const request = SftpDownloadPathsRequestSchema.parse(input);
    return SftpTransferSchema.array().parse(
      await ipcRenderer.invoke('sftp:download-paths', request)
    );
  },
  listSftpTransfers: async (sessionId?: string) =>
    SftpTransferSchema.array().parse(await ipcRenderer.invoke('sftp:transfers', { sessionId })),
  cancelSftpTransfer: async (transferId: string) => {
    const request = SftpTransferIdRequestSchema.parse({ transferId });
    return SftpOperationResultSchema.parse(
      await ipcRenderer.invoke('sftp:cancel-transfer', request)
    );
  },
  runRemoteFileCommand: async (input: SftpRemoteCommandRequest) => {
    const request = SftpRemoteCommandRequestSchema.parse(input);
    return SftpOperationResultSchema.parse(
      await ipcRenderer.invoke('sftp:remote-command', request)
    );
  },
  listLocalFiles: async (directory: string | null) => {
    const request = LocalListRequestSchema.parse({ directory });
    return LocalEntrySchema.array().parse(await ipcRenderer.invoke('local:list', request));
  },
  makeLocalDirectory: async (input: LocalMkdirRequest) => {
    const request = LocalMkdirRequestSchema.parse(input);
    return SftpOperationResultSchema.parse(await ipcRenderer.invoke('local:mkdir', request));
  },
  renameLocalPath: async (input: LocalRenameRequest) => {
    const request = LocalRenameRequestSchema.parse(input);
    return SftpOperationResultSchema.parse(await ipcRenderer.invoke('local:rename', request));
  },
  deleteLocalPaths: async (paths: string[]) => {
    const request = LocalDeleteRequestSchema.parse({ paths });
    return SftpOperationResultSchema.parse(await ipcRenderer.invoke('local:delete', request));
  },
  openLocalPath: async (path: string) => {
    const request = LocalOpenRequestSchema.parse({ path });
    return SftpOperationResultSchema.parse(await ipcRenderer.invoke('local:open', request));
  },
  revealLocalPath: async (path: string) => {
    const request = LocalOpenRequestSchema.parse({ path });
    return SftpOperationResultSchema.parse(await ipcRenderer.invoke('local:reveal', request));
  },
  onSftpTransferEvent: (listener: (event: SftpTransferEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      const result = SftpTransferEventSchema.safeParse(payload);
      if (result.success) listener(result.data);
    };
    ipcRenderer.on('sftp:transfer-event', handler);
    return () => ipcRenderer.removeListener('sftp:transfer-event', handler);
  },
  onSftpCd: (listener: (event: SftpCdEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      const result = SftpCdEventSchema.safeParse(payload);
      if (result.success) listener(result.data);
    };
    ipcRenderer.on('sftp:cd', handler);
    return () => ipcRenderer.removeListener('sftp:cd', handler);
  },
  onMenuCommand: (listener: (command: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, command: unknown): void => {
      if (typeof command === 'string') listener(command);
    };
    ipcRenderer.on('menu-command', handler);
    return () => ipcRenderer.removeListener('menu-command', handler);
  },
  listUserThemes: async () => UserThemeListSchema.parse(await ipcRenderer.invoke('themes:list')),
  openThemesFolder: async () =>
    SftpOperationResultSchema.parse(await ipcRenderer.invoke('themes:open-folder')),
  getRuntimeInfo: async () => RuntimeInfoSchema.parse(await ipcRenderer.invoke('app:runtime-info')),
  openConfigFolder: async () =>
    SftpOperationResultSchema.parse(await ipcRenderer.invoke('app:open-config-folder')),
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
