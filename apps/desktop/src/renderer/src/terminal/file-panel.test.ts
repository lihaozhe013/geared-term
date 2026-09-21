import { describe, expect, it } from 'vitest';
import type {
  LocalTerminalRequest,
  SshProfileTerminalRequest,
  SshTerminalRequest
} from '@geared-term/protocol';
import { filePanelMode } from './file-panel';

const localRequest: LocalTerminalRequest = {
  sessionId: 'local-1',
  args: [],
  cols: 80,
  rows: 24,
  term: 'xterm-256color'
};

const sshRequest: SshTerminalRequest = {
  sessionId: 'ssh-1',
  host: 'server.example.test',
  port: 22,
  username: 'operator',
  password: 'secret',
  cols: 80,
  rows: 24,
  term: 'xterm-256color'
};

const profileRequest: SshProfileTerminalRequest = {
  sessionId: 'ssh-profile-1',
  profileId: 'profile-1',
  cols: 80,
  rows: 24
};

describe('filePanelMode', () => {
  it('classifies SSH requests as SFTP', () => {
    expect(filePanelMode(sshRequest)).toBe('sftp');
    expect(filePanelMode(profileRequest)).toBe('sftp');
  });

  it('classifies ordinary local shell requests as local files', () => {
    expect(filePanelMode(localRequest)).toBe('local');
    expect(filePanelMode({ ...localRequest, shell: '/bin/zsh' })).toBe('local');
  });

  it('does not expose host file operations for WSL or missing sessions', () => {
    expect(filePanelMode({ ...localRequest, shell: 'wsl.exe' })).toBeNull();
    expect(filePanelMode({ ...localRequest, shell: 'C:\\Windows\\System32\\wsl.exe' })).toBeNull();
    expect(filePanelMode(undefined)).toBeNull();
  });
});
