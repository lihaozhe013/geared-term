import type { SftpEditorLineEnding } from '@geared-term/protocol';

export function remoteEditorByteLength(
  content: string,
  lineEnding: SftpEditorLineEnding,
  hasBom: boolean
): number {
  const normalized = content.replace(/\r\n|\r/gu, '\n');
  const encoded = lineEnding === 'crlf' ? normalized.replace(/\n/gu, '\r\n') : normalized;
  return new TextEncoder().encode(encoded).length + (hasBom ? 3 : 0);
}

export function savedLineEnding(lineEnding: SftpEditorLineEnding): SftpEditorLineEnding {
  return lineEnding === 'mixed' ? 'lf' : lineEnding;
}
