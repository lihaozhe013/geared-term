export {};

declare module '*.css';

import type {
  LocalTerminalRequest,
  SessionProfileRecord,
  SshTerminalRequest,
  UiStateRecord,
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
      getVaultStatus: () => Promise<VaultStatus>;
      initializeVault: (input: VaultPasswordRequest) => Promise<VaultStatus>;
      unlockVault: (input: VaultPasswordRequest) => Promise<VaultStatus>;
      lockVault: () => Promise<VaultStatus>;
      listProfiles: () => Promise<SessionProfileRecord[]>;
      saveProfile: (input: SessionProfileRecord) => Promise<SessionProfileRecord[]>;
      deleteProfile: (id: string) => Promise<SessionProfileRecord[]>;
      getUiState: () => Promise<UiStateRecord>;
      saveUiState: (input: UiStateRecord) => Promise<UiStateRecord>;
    };
  }
}
