/// <reference types="vite/client" />

export {};

declare module '*.css';

declare module '*.png' {
  const source: string;
  export default source;
}

import type {
  AiConnectionInput,
  AiConnectionRecord,
  AppInfo,
  LocalTerminalRequest,
  SessionProfileRecord,
  SessionProfileSaveRequest,
  ProfileOrderRequest,
  SettingsRecord,
  SftpDownloadRequest,
  SftpListRequest,
  SftpListResult,
  SftpMkdirRequest,
  SftpRenameRequest,
  SftpSendCdRequest,
  SftpDeleteRequest,
  SftpUploadPathsRequest,
  SftpDownloadPathsRequest,
  SftpTransfer,
  SftpTransferEvent,
  SftpRemoteCommandRequest,
  SftpCdEvent,
  SftpOperationResult,
  SftpEditorDocument,
  SftpEditorOpenRequest,
  SftpEditorOpenResult,
  SftpEditorSaveRequest,
  SftpEditorSaveResult,
  SftpEditorSavedEvent,
  TerminalSnapshotDraft,
  TerminalSnapshotDraftRequest,
  TerminalSnapshotDraftChatRequest,
  TerminalSnapshotDraftChatEvent,
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
  UpdateStatus,
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
  const __APP_COMMIT__: string;

  interface Window {
    geared: {
      readonly platform: NodeJS.Platform;
      getAppInfo: () => Promise<AppInfo>;
      getUpdateStatus: () => Promise<UpdateStatus>;
      checkForUpdates: () => Promise<UpdateStatus>;
      installDownloadedUpdate: () => Promise<SftpOperationResult>;
      openNightlyRelease: () => Promise<SftpOperationResult>;
      onUpdateStatus: (listener: (status: UpdateStatus) => void) => () => void;
      createLocalTerminal: (
        input: LocalTerminalRequest,
        onMessage: (message: unknown) => void
      ) => {
        sendInput: (data: string) => void;
        sendCdLine: (line: string) => void;
        resize: (cols: number, rows: number) => void;
        acknowledge: (bytes: number) => void;
        close: () => void;
      };
      createSshTerminal: (
        input: SshTerminalRequest,
        onMessage: (message: unknown) => void
      ) => {
        sendInput: (data: string) => void;
        sendCdLine: (line: string) => void;
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
        sendCdLine: (line: string) => void;
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
      onAiConnectionsChanged: (listener: (connections: AiConnectionRecord[]) => void) => () => void;
      saveAiConnection: (input: AiConnectionInput) => Promise<AiConnectionRecord[]>;
      deleteAiConnection: (id: string) => Promise<AiConnectionRecord[]>;
      acceptAiEndpoint: (input: {
        connectionId: string;
        identity: string;
      }) => Promise<AiConnectionRecord[]>;
      discoverAiModels: (input: AiDiscoverModelsRequest) => Promise<AiDiscoveredModels>;
      listAiHistory: () => Promise<AiHistoryList>;
      loadAiHistory: (input: AiHistoryLoadRequest) => Promise<AiHistoryLoadResult>;
      saveAiHistory: (input: AiHistorySaveRequest) => Promise<AiHistorySaved>;
      deleteAiHistory: (id: string) => Promise<{ deleted: boolean }>;
      clearAiHistory: () => Promise<{ cleared: boolean; removed: number }>;
      openAiHistoryDirectory: () => Promise<{ opened: boolean }>;
      streamAi: (
        input: AiStreamRequest,
        onEvent: (event: unknown) => void
      ) => { cancel: () => void };
      listProfiles: () => Promise<SessionProfileRecord[]>;
      listProfileGroups: () => Promise<string[]>;
      createProfileGroup: (name: string) => Promise<string[]>;
      deleteProfileGroup: (name: string) => Promise<string[]>;
      reorderProfiles: (input: ProfileOrderRequest) => Promise<SessionProfileRecord[]>;
      saveProfile: (input: SessionProfileRecord) => Promise<SessionProfileRecord[]>;
      saveProfileWithCredentials: (
        input: SessionProfileSaveRequest
      ) => Promise<SessionProfileRecord[]>;
      deleteProfile: (id: string) => Promise<SessionProfileRecord[]>;
      getUiState: () => Promise<UiStateRecord>;
      saveUiState: (input: UiStateRecord) => Promise<UiStateRecord>;
      getSettings: () => Promise<SettingsRecord>;
      saveSettings: (input: SettingsRecord) => Promise<SettingsRecord>;
      beginKeyCapture: () => Promise<SftpOperationResult>;
      endKeyCapture: () => Promise<SftpOperationResult>;
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
      openSftpEditor: (input: SftpEditorOpenRequest) => Promise<SftpEditorOpenResult>;
      getSftpEditorDocument: () => Promise<SftpEditorDocument>;
      reloadSftpEditor: () => Promise<SftpEditorDocument>;
      saveSftpEditor: (input: SftpEditorSaveRequest) => Promise<SftpEditorSaveResult>;
      setSftpEditorDirty: (dirty: boolean) => Promise<SftpOperationResult>;
      onSftpEditorSaved: (listener: (event: SftpEditorSavedEvent) => void) => () => void;
      openTerminalSnapshotEditor: (
        input: TerminalSnapshotDraftRequest
      ) => Promise<SftpOperationResult>;
      getTerminalSnapshotDraft: () => Promise<TerminalSnapshotDraft>;
      addTerminalSnapshotToAssistant: (
        input: TerminalSnapshotDraftChatRequest
      ) => Promise<SftpOperationResult>;
      onTerminalSnapshotAddToAssistant: (
        listener: (event: TerminalSnapshotDraftChatEvent) => void
      ) => () => void;
      sftpSendCd: (input: SftpSendCdRequest) => Promise<SftpOperationResult>;
      sftpTrackedDirectory: (sessionId: string) => Promise<string | null>;
      getDownloadsDirectory: () => Promise<string>;
      listLocalFiles: (directory: string | null) => Promise<LocalEntry[]>;
      getLocalWorkingDirectory: (sessionId: string) => Promise<string | null>;
      makeLocalDirectory: (input: LocalMkdirRequest) => Promise<SftpOperationResult>;
      renameLocalPath: (input: LocalRenameRequest) => Promise<SftpOperationResult>;
      deleteLocalPaths: (paths: string[]) => Promise<SftpOperationResult>;
      openLocalPath: (path: string) => Promise<SftpOperationResult>;
      revealLocalPath: (path: string) => Promise<SftpOperationResult>;
      onSftpTransferEvent: (listener: (event: SftpTransferEvent) => void) => () => void;
      onSftpCd: (listener: (event: SftpCdEvent) => void) => () => void;
      onMenuCommand: (listener: (command: string) => void) => () => void;
      executeMenuAction: (action: string) => Promise<SftpOperationResult>;
      isWindowMaximized: () => Promise<boolean>;
      windowControl: (
        action: 'minimize' | 'toggle-maximize' | 'close'
      ) => Promise<SftpOperationResult>;
      onWindowMaximizeChanged: (listener: (maximized: boolean) => void) => () => void;
      listUserThemes: () => Promise<UserThemeList>;
      openThemesFolder: () => Promise<SftpOperationResult>;
      getRuntimeInfo: () => Promise<RuntimeInfo>;
      openConfigFolder: () => Promise<SftpOperationResult>;
      uploadSftp: (input: SftpUploadRequest) => Promise<SftpOperationResult>;
      downloadSftp: (input: SftpDownloadRequest) => Promise<SftpOperationResult>;
      executeCommandAction: (input: TerminalCommandAction) => Promise<{ accepted: true }>;
      getTerminalLigatureSequences: (fontFamily: string) => Promise<string[]>;
      listEnvironments: () => Promise<EnvironmentRecord[]>;
      onEnvironmentUpdated: (listener: (environment: EnvironmentRecord) => void) => () => void;
      saveEnvironment: (input: EnvironmentRecord) => Promise<EnvironmentRecord[]>;
      deleteEnvironment: (id: string) => Promise<EnvironmentRecord[]>;
      probeEnvironment: (input: EnvironmentProbeRequest) => Promise<EnvironmentFacts>;
      discoverWsl: () => Promise<WslDistribution[]>;
    };
  }
}
