import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import {
  SFTP_EDITOR_MAX_BYTES,
  type SftpEditorDocument,
  type SftpEditorLineEnding,
  type SftpEditorSaveResult
} from '@geared-term/protocol';
import { RemoteFileLimitError, type RemoteFileStats, type SftpService } from './sftp-service';

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

export type RemoteEditorRevision = {
  sha256: string;
  byteLength: number;
  modifiedAt: number | null;
};

export type RemoteEditorSnapshot = {
  document: SftpEditorDocument;
  revision: RemoteEditorRevision;
};

export type RemoteEditorSaveOutcome = {
  result: SftpEditorSaveResult;
  snapshot?: RemoteEditorSnapshot;
};

type RemoteBytes = {
  content: Buffer;
  stats: RemoteFileStats;
};

export class RemoteEditorNotFileError extends Error {
  public constructor() {
    super('Only regular remote files can be edited');
    this.name = 'RemoteEditorNotFileError';
  }
}

export class RemoteEditorTextError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'RemoteEditorTextError';
  }
}

export class RemoteEditorVerificationError extends Error {
  public constructor() {
    super('The remote file did not match the saved content after writing');
    this.name = 'RemoteEditorVerificationError';
  }
}

export function isMissingRemoteFileError(error: unknown): boolean {
  const code = (error as { code?: number | string }).code;
  const message = error instanceof Error ? error.message : String(error);
  return code === 2 || code === 'ENOENT' || /no such file|not found/iu.test(message);
}

function hash(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function revisionOf(content: Buffer, stats: RemoteFileStats): RemoteEditorRevision {
  return {
    sha256: hash(content),
    byteLength: content.length,
    modifiedAt: stats.modifiedAt
  };
}

function lineEndingOf(content: string): SftpEditorLineEnding {
  const hasCrLf = content.includes('\r\n');
  const withoutCrLf = content.replace(/\r\n/gu, '');
  const hasOtherBreak = withoutCrLf.includes('\n') || withoutCrLf.includes('\r');
  if (hasCrLf && hasOtherBreak) return 'mixed';
  if (withoutCrLf.includes('\r')) return 'mixed';
  return hasCrLf ? 'crlf' : 'lf';
}

function normalizeForEditor(content: string, lineEnding: SftpEditorLineEnding): string {
  if (lineEnding === 'lf') return content;
  return content.replace(/\r\n|\r/gu, '\n');
}

function decodeRemoteText(bytes: Buffer): {
  content: string;
  hasBom: boolean;
  lineEnding: SftpEditorLineEnding;
} {
  const hasBom = bytes.subarray(0, UTF8_BOM.length).equals(UTF8_BOM);
  const body = hasBom ? bytes.subarray(UTF8_BOM.length) : bytes;
  if (body.includes(0)) throw new RemoteEditorTextError('Binary remote files cannot be edited');
  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    throw new RemoteEditorTextError('Only valid UTF-8 remote files can be edited');
  }
  const lineEnding = lineEndingOf(decoded);
  return {
    content: normalizeForEditor(decoded, lineEnding),
    hasBom,
    lineEnding
  };
}

export function encodeRemoteText(
  content: string,
  lineEnding: SftpEditorLineEnding,
  hasBom: boolean
): Buffer {
  if (content.includes('\0')) throw new RemoteEditorTextError('Text files cannot contain NUL');
  const normalized = content.replace(/\r\n|\r/gu, '\n');
  const withLineEndings = lineEnding === 'crlf' ? normalized.replace(/\n/gu, '\r\n') : normalized;
  const body = Buffer.from(withLineEndings, 'utf8');
  const encoded = hasBom ? Buffer.concat([UTF8_BOM, body]) : body;
  if (encoded.length > SFTP_EDITOR_MAX_BYTES) {
    throw new RemoteFileLimitError(SFTP_EDITOR_MAX_BYTES);
  }
  return encoded;
}

async function readRemoteBytes(service: SftpService, remotePath: string): Promise<RemoteBytes> {
  const initial = await service.fileStats(remotePath);
  if (!initial.isFile) throw new RemoteEditorNotFileError();
  if (initial.size > SFTP_EDITOR_MAX_BYTES) {
    throw new RemoteFileLimitError(SFTP_EDITOR_MAX_BYTES);
  }
  const content = await service.readFileLimited(remotePath, SFTP_EDITOR_MAX_BYTES);
  const stats = await service.fileStats(remotePath);
  if (!stats.isFile) throw new RemoteEditorNotFileError();
  if (stats.size > SFTP_EDITOR_MAX_BYTES || content.length > SFTP_EDITOR_MAX_BYTES) {
    throw new RemoteFileLimitError(SFTP_EDITOR_MAX_BYTES);
  }
  return { content, stats };
}

function snapshotOf(remotePath: string, bytes: RemoteBytes): RemoteEditorSnapshot {
  const decoded = decodeRemoteText(bytes.content);
  return {
    document: {
      name: posix.basename(remotePath),
      remotePath,
      content: decoded.content,
      byteLength: bytes.content.length,
      modifiedAt: bytes.stats.modifiedAt,
      hasBom: decoded.hasBom,
      lineEnding: decoded.lineEnding
    },
    revision: revisionOf(bytes.content, bytes.stats)
  };
}

export async function readRemoteEditorFile(
  service: SftpService,
  remotePath: string
): Promise<RemoteEditorSnapshot> {
  return snapshotOf(remotePath, await readRemoteBytes(service, remotePath));
}

export async function saveRemoteEditorFile(
  service: SftpService,
  remotePath: string,
  content: string,
  format: Pick<SftpEditorDocument, 'hasBom' | 'lineEnding'>,
  expected: RemoteEditorRevision,
  overwriteConflict: boolean
): Promise<RemoteEditorSaveOutcome> {
  const encoded = encodeRemoteText(content, format.lineEnding, format.hasBom);
  let current: RemoteBytes;
  try {
    current = await readRemoteBytes(service, remotePath);
  } catch (error) {
    if (isMissingRemoteFileError(error)) {
      return { result: { status: 'conflict', reason: 'missing' } };
    }
    if (error instanceof RemoteEditorNotFileError) {
      return { result: { status: 'conflict', reason: 'not-file' } };
    }
    throw error;
  }
  const currentRevision = revisionOf(current.content, current.stats);
  if (!overwriteConflict && currentRevision.sha256 !== expected.sha256) {
    return {
      result: {
        status: 'conflict',
        reason: 'modified',
        currentByteLength: currentRevision.byteLength,
        currentModifiedAt: currentRevision.modifiedAt
      }
    };
  }

  await service.overwriteExisting(remotePath, encoded);
  const verifiedBytes = await readRemoteBytes(service, remotePath);
  if (hash(verifiedBytes.content) !== hash(encoded)) throw new RemoteEditorVerificationError();
  const snapshot = snapshotOf(remotePath, verifiedBytes);
  return {
    result: {
      status: 'saved',
      byteLength: snapshot.document.byteLength,
      modifiedAt: snapshot.document.modifiedAt
    },
    snapshot
  };
}
