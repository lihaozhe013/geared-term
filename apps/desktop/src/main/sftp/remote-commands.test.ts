import { describe, expect, it } from 'vitest';
import { parseRemoteFileCommands } from '@geared-term/protocol';
import { buildRemoteFileCommand, quoteRemotePath } from './remote-commands';

describe('quoteRemotePath', () => {
  it('single-quotes plain paths', () => {
    expect(quoteRemotePath('/tmp/file.txt')).toBe("'/tmp/file.txt'");
  });

  it('escapes embedded single quotes', () => {
    expect(quoteRemotePath("/tmp/it's.txt")).toBe("'/tmp/it'\\''s.txt'");
  });

  it('rejects control characters instead of injecting them', () => {
    expect(() => quoteRemotePath('/tmp/be' + String.fromCharCode(27) + '[31m.txt')).toThrow(
      /control characters/u
    );
    expect(() => quoteRemotePath('/tmp/be\rol.txt')).toThrow(/control characters/u);
  });

  it('keeps unicode names', () => {
    expect(quoteRemotePath('/tmp/报告.txt')).toBe("'/tmp/报告.txt'");
  });
});

describe('buildRemoteFileCommand', () => {
  it('appends the quoted path to the command', () => {
    expect(buildRemoteFileCommand('cat', '/tmp/a b.txt')).toBe("cat '/tmp/a b.txt'");
  });

  it('rejects multi-word commands', () => {
    expect(() => buildRemoteFileCommand('cat /etc/passwd', '/tmp/x')).toThrow(/single executable/u);
  });
});

describe('parseRemoteFileCommands', () => {
  it('splits, trims, and deduplicates one-per-line commands', () => {
    expect(parseRemoteFileCommands('cat\n  less \ncat\n\nless')).toEqual(['cat', 'less']);
  });

  it('drops lines with control characters', () => {
    expect(parseRemoteFileCommands('cat\ncat' + String.fromCharCode(7) + 'x')).toEqual(['cat']);
  });
});
