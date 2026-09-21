import type {
  LocalTerminalRequest,
  SshProfileTerminalRequest,
  SshTerminalRequest
} from '@geared-term/protocol';

export type FilePanelRequest =
  LocalTerminalRequest | SshTerminalRequest | SshProfileTerminalRequest;

export type FilePanelMode = 'sftp' | 'local' | null;

export function filePanelMode(request: FilePanelRequest | undefined): FilePanelMode {
  if (!request) return null;
  if ('host' in request || 'profileId' in request) return 'sftp';
  if (request.shell?.toLowerCase().endsWith('wsl.exe')) return null;
  return 'local';
}
