import { contextBridge, ipcRenderer } from 'electron';
import {
  AppInfoSchema,
  AiConnectionDeleteRequestSchema,
  AiConnectionInputSchema,
  AiConnectionRecordSchema,
  AiStreamClientMessageSchema,
  AiStreamEventSchema,
  AiStreamRequestSchema,
  LocalTerminalRequestSchema,
  ProfileIdRequestSchema,
  SessionProfileRecordSchema,
  SshProfileTerminalRequestSchema,
  SshTerminalRequestSchema,
  VaultPasswordRequestSchema,
  VaultStatusSchema,
  TerminalClientMessageSchema,
  TerminalPortMessageSchema,
  UiStateRecordSchema,
  WslDistributionSchema,
  type LocalTerminalRequest,
  type AiConnectionInput,
  type AiStreamRequest,
  type SessionProfileRecord,
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
    return SessionProfileRecordSchema.array().parse(
      await ipcRenderer.invoke('profile:save', profile)
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
  discoverWsl: async (): Promise<WslDistribution[]> =>
    WslDistributionSchema.array().parse(await ipcRenderer.invoke('wsl:list'))
});

contextBridge.exposeInMainWorld('geared', api);
