export {};

declare module '*.css';

import type {
  AiConnectionInput,
  AiConnectionRecord,
  LocalTerminalRequest,
  SessionProfileRecord,
  SettingsRecord,
  SshProfileTerminalRequest,
  SshTerminalRequest,
  AiStreamRequest,
  UiStateRecord,
  WslDistribution,
  VaultPasswordRequest,
  VaultStatus
} from '@geared-term/protocol';

declare global {
  interface Window {
    geared: {
      getAppInfo: () => Promise<{
        name: 'Geared Term';
        version: string;
        isPackaged: boolean;
        platform: NodeJS.Platform;
      }>;
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
      listAiConnections: () => Promise<AiConnectionRecord[]>;
      saveAiConnection: (input: AiConnectionInput) => Promise<AiConnectionRecord[]>;
      deleteAiConnection: (id: string) => Promise<AiConnectionRecord[]>;
      streamAi: (
        input: AiStreamRequest,
        onEvent: (event: unknown) => void
      ) => { cancel: () => void };
      listProfiles: () => Promise<SessionProfileRecord[]>;
      saveProfile: (input: SessionProfileRecord) => Promise<SessionProfileRecord[]>;
      deleteProfile: (id: string) => Promise<SessionProfileRecord[]>;
      getUiState: () => Promise<UiStateRecord>;
      saveUiState: (input: UiStateRecord) => Promise<UiStateRecord>;
      getSettings: () => Promise<SettingsRecord>;
      saveSettings: (input: SettingsRecord) => Promise<SettingsRecord>;
      discoverWsl: () => Promise<WslDistribution[]>;
    };
  }
}
