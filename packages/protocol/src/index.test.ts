import { describe, expect, it } from 'vitest';
import {
  AppInfoSchema,
  DEFAULT_TERMINAL_LIGATURE_SEQUENCES,
  normalizeLigatureSequences,
  normalizeTerminalLineEndings,
  SftpDownloadRequestSchema,
  SftpListRequestSchema,
  SftpOperationResultSchema,
  SftpRemoteEntrySchema,
  SftpUploadRequestSchema,
  SessionProfileSaveRequestSchema,
  SettingsRecordSchema,
  TerminalCommandActionSchema,
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
      directory: '.',
      reanchor: false
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
    expect(SftpUploadRequestSchema.parse({ sessionId: 'ssh-1', remoteDirectory: '/tmp' })).toEqual({
      sessionId: 'ssh-1',
      remoteDirectory: '/tmp',
      choose: 'both'
    });
    expect(
      SftpDownloadRequestSchema.safeParse({
        sessionId: 'ssh-1',
        remotePath: '/tmp/notes.txt',
        suggestedName: 'notes.txt'
      }).success
    ).toBe(true);
    expect(SftpOperationResultSchema.parse({ accepted: false })).toEqual({ accepted: false });
  });

  it('requires an explicit shell and revision for command actions', () => {
    expect(
      TerminalCommandActionSchema.safeParse({
        sessionId: 'local-1',
        action: 'run',
        shell: 'bash',
        payload: 'printf hello',
        revision: '0123456789abcdef0123456789abcdef'
      }).success
    ).toBe(true);
    expect(
      TerminalCommandActionSchema.safeParse({
        sessionId: 'local-1',
        action: 'run',
        payload: 'printf hello',
        revision: 'stale'
      }).success
    ).toBe(false);
  });

  it('keeps profile credential input transient at the IPC boundary', () => {
    const base = {
      id: 'ssh-1',
      kind: 'ssh' as const,
      name: 'Remote',
      term: 'xterm-256color' as const,
      host: 'server.example.test',
      user: 'operator'
    };
    expect(
      SessionProfileSaveRequestSchema.safeParse({
        profile: base,
        credentials: { password: 'secret' }
      }).success
    ).toBe(true);
    expect(
      SessionProfileSaveRequestSchema.safeParse({
        profile: { ...base, secretRefs: { password: 'secret-ref' } }
      }).success
    ).toBe(false);
  });

  it('defaults terminal font ligatures for records saved before the setting existed', () => {
    const legacy = {
      schemaVersion: 1,
      language: 'en-US',
      theme: 'Catppuccin Mocha',
      terminalFontSize: 14,
      terminalLineHeight: 1.2,
      terminalCursor: 'block',
      defaultTerm: 'xterm-256color',
      splitCommandPresentation: false,
      terminalContextPrecedingLines: 100
    };
    expect(SettingsRecordSchema.parse(legacy).terminalFontLigatures).toBe(false);
    expect(SettingsRecordSchema.parse({ ...legacy, terminalFontLigatures: true })).toMatchObject({
      terminalFontLigatures: true
    });
    expect(
      SettingsRecordSchema.safeParse({
        ...legacy,
        terminalFontLigatures: 'yes'
      }).success
    ).toBe(false);
  });

  it('keeps quit-on-close for records saved before keepRunningInBackground existed', () => {
    const legacy = {
      schemaVersion: 1,
      language: 'zh-CN',
      theme: 'Catppuccin Mocha',
      terminalFontSize: 14,
      terminalLineHeight: 1.2,
      terminalCursor: 'bar',
      defaultTerm: 'xterm-256color',
      splitCommandPresentation: true,
      allowRiskyRun: false,
      terminalContextPrecedingLines: 100
    };
    expect(SettingsRecordSchema.parse(legacy).keepRunningInBackground).toBe(false);
    expect(SettingsRecordSchema.parse({ ...legacy, keepRunningInBackground: true })).toMatchObject({
      keepRunningInBackground: true
    });
    expect(
      SettingsRecordSchema.safeParse({
        ...legacy,
        keepRunningInBackground: 'yes'
      }).success
    ).toBe(false);
  });

  it('normalizes ligature sequences and orders them longest-first', () => {
    expect(normalizeLigatureSequences(['=>', '=>', '<', 'a', '!=', '->>', '   ', '=>!!'])).toEqual([
      '=>!!',
      '->>',
      '!=',
      '=>'
    ]);
    expect(normalizeLigatureSequences(DEFAULT_TERMINAL_LIGATURE_SEQUENCES)).toEqual(
      normalizeLigatureSequences(normalizeLigatureSequences(DEFAULT_TERMINAL_LIGATURE_SEQUENCES))
    );
    expect(
      normalizeLigatureSequences(DEFAULT_TERMINAL_LIGATURE_SEQUENCES).every(
        (sequence) => sequence.length >= 2 && sequence.length <= 8
      )
    ).toBe(true);
  });
});

describe('normalizeTerminalLineEndings', () => {
  it('converts LF and CRLF line breaks into accept-line CR', () => {
    expect(normalizeTerminalLineEndings('$paths = @(\n  "a",\n  "b"\n)')).toBe(
      '$paths = @(\r  "a",\r  "b"\r)'
    );
    expect(normalizeTerminalLineEndings('one\r\ntwo')).toBe('one\rtwo');
    expect(normalizeTerminalLineEndings('lf\n crlf\r\n cr')).toBe('lf\r crlf\r cr');
  });

  it('leaves text without line breaks and lone CR characters untouched', () => {
    expect(normalizeTerminalLineEndings('single line')).toBe('single line');
    expect(normalizeTerminalLineEndings('')).toBe('');
    expect(normalizeTerminalLineEndings('carriage\rreturn')).toBe('carriage\rreturn');
  });

  it('is idempotent and preserves multibyte characters', () => {
    const text = 'echo "héllo 🌟"\r\nsecond\nthird';
    expect(normalizeTerminalLineEndings(normalizeTerminalLineEndings(text))).toBe(
      normalizeTerminalLineEndings(text)
    );
    expect(normalizeTerminalLineEndings(text)).toBe('echo "héllo 🌟"\rsecond\rthird');
  });
});
