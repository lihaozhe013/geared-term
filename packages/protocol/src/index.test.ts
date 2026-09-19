import { describe, expect, it } from 'vitest';
import {
  AppInfoSchema,
  SftpListRequestSchema,
  SftpRemoteEntrySchema,
  TerminalPortMessageSchema
} from './index';

describe('protocol schemas', () => {
  it('accepts app information', () => {
    const result = AppInfoSchema.safeParse({
      name: 'Geared Term',
      version: '0.1.0',
      isPackaged: false,
      platform: 'win32'
    });
    expect(result.success).toBe(true);
  });

  it('rejects an untrusted terminal message shape', () => {
    const result = TerminalPortMessageSchema.safeParse({
      kind: 'output',
      sessionId: '../escape',
      sequence: -1,
      chunk: 42
    });
    expect(result.success).toBe(false);
  });

  it('bounds SFTP requests and validates remote entries', () => {
    expect(SftpListRequestSchema.parse({ sessionId: 'ssh-1' })).toEqual({
      sessionId: 'ssh-1',
      directory: '.'
    });
    expect(
      SftpRemoteEntrySchema.safeParse({
        name: 'notes.txt',
        path: '/home/user/notes.txt',
        longName: '-rw-r--r-- 1 user user 3 notes.txt',
        kind: 'file',
        size: 3,
        modifiedAt: null
      }).success
    ).toBe(true);
  });
});
