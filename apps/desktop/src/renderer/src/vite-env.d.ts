export {};

declare module '*.css';

import type {
  AiConnectionInput,
  AiConnectionRecord,
  AppInfo,
  LocalTerminalRequest,
  SessionProfileRecord,
  SessionProfileSaveRequest,
  SettingsRecord,
  SftpDownloadRequest,
  SftpListRequest,
  SftpListResult,
  SftpMkdirRequest,
  SftpRenameRequest,
  SftpDeleteRequest,
  SftpUploadPathsRequest,
  SftpDownloadPathsRequest,
  SftpTransfer,
  SftpTransferEvent,
  SftpRemoteCommandRequest,
  SftpCdEvent,
  SftpOperationResult,
  SftpUploadRequest,
  LocalEntry,
  LocalMkdirRequest,
  LocalRenameRequest,
  RuntimeInfo,
  UserThemeList,
  TerminalCommandAction,
  SshProfileTerminalRequest,
  SshTerminalRequest,
  AiStreamRequest,
  EnvironmentFacts,
  EnvironmentProbeRequest,
  EnvironmentRecord,
  UiStateRecord,
  WslDistribution,
  VaultPasswordRequest,
  VaultRotateRequest,
  VaultStatus,
  AutoUnlockStatus,
  AiDiscoverModelsRequest,
  AiDiscoveredModels,
  AiHistoryList,
  AiHistoryLoadRequest,
  AiHistoryLoadResult,
  AiHistorySaveRequest,
  AiHistorySaved
} from '@geared-term/protocol';

declare global {
  interface Window {
    geared: {
      getAppInfo: () => Promise<AppInfo>;
      createLocalTerminal: (
        input: LocalTerminalRequest,
        onMessage: (message: unknown) => void
      ) => {
        sendInput: (data: string) => void;
        resize: (cols: number, rows: number) => void;
        acknowledge: (bytes: number) => void;
        close: () => void;
      };
      createSshTerminal: (
        input: SshTerminalRequest,
        onMessage: (message: unknown) => void
      ) => {
        sendInput: (data: string) => void;
        resize: (cols: number, rows: number) => void;
        acknowledge: (bytes: number) => void;
        decideHostKey: (decision: 'approve' | 'reject') => void;
        close: () => void;
      };
      createSavedSshTerminal: (
        input: SshProfileTerminalRequest,
        onMessage: (message: unknown) => void
      ) => {
        sendInput: (data: string) => void;
        resize: (cols: number, rows: number) => void;
        acknowledge: (bytes: number) => void;
        decideHostKey: (decision: 'approve' | 'reject') => void;
        close: () => void;
      };
      getVaultStatus: () => Promise<VaultStatus>;
      initializeVault: (input: VaultPasswordRequest) => Promise<VaultStatus>;
      unlockVault: (input: VaultPasswordRequest) => Promise<VaultStatus>;
      lockVault: () => Promise<VaultStatus>;
      rotateVault: (input: VaultRotateRequest) => Promise<VaultStatus>;
      getAutoUnlockStatus: () => Promise<AutoUnlockStatus>;
      enableAutoUnlock: () => Promise<AutoUnlockStatus>;
      disableAutoUnlock: () => Promise<AutoUnlockStatus>;
      listAiConnections: () => Promise<AiConnectionRecord[]>;
      saveAiConnection: (input: AiConnectionInput) => Promise<AiConnectionRecord[]>;
      deleteAiConnection: (id: string) => Promise<AiConnectionRecord[]>;
      acceptAiEndpoint: (input: { connectionId: string; identity: string }) => Promise<AiConnectionRecord[]>;
      discoverAiModels: (input: AiDiscoverModelsRequest) => Promise<AiDiscoveredModels>;
      listAiHistory: () => Promise<AiHistoryList>;
      loadAiHistory: (input: AiHistoryLoadRequest) => Promise<AiHistoryLoadResult>;
      saveAiHistory: (input: AiHistorySaveRequest) => Promise<AiHistorySaved>;
      deleteAiHistory: (id: string) => Promise<{ deleted: boolean }>;
      openAiHistoryDirectory: () => Promise<{ opened: boolean }>;
      streamAi: (
        input: AiStreamRequest,
        onEvent: (event: unknown) => void
      ) => { cancel: () => void };
      listProfiles: () => Promise<SessionProfileRecord[]>;
      saveProfile: (input: SessionProfileRecord) => Promise<SessionProfileRecord[]>;
      saveProfileWithCredentials: (
        input: SessionProfileSaveRequest
      ) => Promise<SessionProfileRecord[]>;
      deleteProfile: (id: string) => Promise<SessionProfileRecord[]>;
      getUiState: () => Promise<UiStateRecord>;
      saveUiState: (input: UiStateRecord) => Promise<UiStateRecord>;
      getSettings: () => Promise<SettingsRecord>;
      saveSettings: (input: SettingsRecord) => Promise<SettingsRecord>;
      openSettings: (category?: string) => Promise<SftpOperationResult>;
      onSettingsChanged: (listener: (settings: SettingsRecord) => void) => () => void;
      onVaultChanged: (listener: (status: VaultStatus) => void) => () => void;
      onSettingsNavigate: (listener: (category: string) => void) => () => void;
      openHistoryWindow: () => Promise<SftpOperationResult>;
      continueAiHistory: (id: string) => Promise<SftpOperationResult>;
      onAiHistoryContinue: (listener: (id: string) => void) => () => void;
      listSftp: (input: SftpListRequest) => Promise<SftpListResult>;
      sftpMkdir: (input: SftpMkdirRequest) => Promise<SftpOperationResult>;
      sftpRename: (input: SftpRenameRequest) => Promise<SftpOperationResult>;
      sftpDelete: (input: SftpDeleteRequest) => Promise<SftpOperationResult>;
      uploadPathsSftp: (input: SftpUploadPathsRequest) => Promise<SftpTransfer[]>;
      downloadPathsSftp: (input: SftpDownloadPathsRequest) => Promise<SftpTransfer[]>;
      listSftpTransfers: (sessionId?: string) => Promise<SftpTransfer[]>;
      cancelSftpTransfer: (transferId: string) => Promise<SftpOperationResult>;
      runRemoteFileCommand: (input: SftpRemoteCommandRequest) => Promise<SftpOperationResult>;
      listLocalFiles: (directory: string | null) => Promise<LocalEntry[]>;
      makeLocalDirectory: (input: LocalMkdirRequest) => Promise<SftpOperationResult>;
      renameLocalPath: (input: LocalRenameRequest) => Promise<SftpOperationResult>;
      deleteLocalPaths: (paths: string[]) => Promise<SftpOperationResult>;
      openLocalPath: (path: string) => Promise<SftpOperationResult>;
      revealLocalPath: (path: string) => Promise<SftpOperationResult>;
      onSftpTransferEvent: (listener: (event: SftpTransferEvent) => void) => () => void;
      onSftpCd: (listener: (event: SftpCdEvent) => void) => () => void;
      onMenuCommand: (listener: (command: string) => void) => () => void;
      listUserThemes: () => Promise<UserThemeList>;
      openThemesFolder: () => Promise<SftpOperationResult>;
      getRuntimeInfo: () => Promise<RuntimeInfo>;
      openConfigFolder: () => Promise<SftpOperationResult>;
      uploadSftp: (input: SftpUploadRequest) => Promise<SftpOperationResult>;
      downloadSftp: (input: SftpDownloadRequest) => Promise<SftpOperationResult>;
      executeCommandAction: (input: TerminalCommandAction) => Promise<{ accepted: true }>;
      listEnvironments: () => Promise<EnvironmentRecord[]>;
      onEnvironmentUpdated: (listener: (environment: EnvironmentRecord) => void) => () => void;
      saveEnvironment: (input: EnvironmentRecord) => Promise<EnvironmentRecord[]>;
      deleteEnvironment: (id: string) => Promise<EnvironmentRecord[]>;
      probeEnvironment: (input: EnvironmentProbeRequest) => Promise<EnvironmentFacts>;
      discoverWsl: () => Promise<WslDistribution[]>;
    };
  }
}
