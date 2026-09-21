import { describe, expect, it } from 'vitest';
import { remoteEditorByteLength, savedLineEnding } from './model';

describe('remote editor document model', () => {
  it('counts encoded UTF-8 bytes with BOM and remote line endings', () => {
    expect(remoteEditorByteLength('a\nb', 'lf', false)).toBe(3);
    expect(remoteEditorByteLength('a\nb', 'crlf', false)).toBe(4);
    expect(remoteEditorByteLength('你\n', 'lf', true)).toBe(7);
  });

  it('normalizes mixed line endings after a save', () => {
    expect(savedLineEnding('mixed')).toBe('lf');
    expect(savedLineEnding('crlf')).toBe('crlf');
  });
});
