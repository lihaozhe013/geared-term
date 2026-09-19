import { contextBridge, ipcRenderer } from 'electron';
import {
  AppInfoSchema,
  LocalTerminalRequestSchema,
  SshTerminalRequestSchema,
  VaultPasswordRequestSchema,
  VaultStatusSchema,
  TerminalClientMessageSchema,
  TerminalPortMessageSchema,
  type LocalTerminalRequest,
  type SshTerminalRequest,
  type VaultPasswordRequest
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
  getVaultStatus: async () => VaultStatusSchema.parse(await ipcRenderer.invoke('vault:get-status')),
  initializeVault: async (input: VaultPasswordRequest) => {
    const request = VaultPasswordRequestSchema.parse(input);
    return VaultStatusSchema.parse(await ipcRenderer.invoke('vault:initialize', request));
  },
  unlockVault: async (input: VaultPasswordRequest) => {
    const request = VaultPasswordRequestSchema.parse(input);
    return VaultStatusSchema.parse(await ipcRenderer.invoke('vault:unlock', request));
  },
  lockVault: async () => VaultStatusSchema.parse(await ipcRenderer.invoke('vault:lock'))
});

contextBridge.exposeInMainWorld('geared', api);
