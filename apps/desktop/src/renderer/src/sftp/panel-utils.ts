import type { LocalEntry, SftpRemoteEntry } from '@geared-term/protocol';

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function posixDirname(path: string): string {
  const trimmed = path.replace(/\/+$/u, '');
  const index = trimmed.lastIndexOf('/');
  if (index <= 0) return '/';
  return trimmed.slice(0, index);
}

export function localDirname(path: string): string | null {
  if (/^[A-Za-z]:\\$/u.test(path)) return null;
  const trimmed = path.replace(/[\\/]+$/u, '');
  const index = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'));
  if (index <= 0) return trimmed === '/' ? null : '/';
  return trimmed.slice(0, index);
}

export function kindGlyph(kind: string): string {
  if (kind === 'directory') return '⌷';
  if (kind === 'drive') return '💾';
  if (kind === 'symlink') return '→';
  return '·';
}

/** Rename and mkdir names must stay within the listed directory. */
export function validateEntryName(value: string): boolean {
  return value.length > 0 && !value.includes('/') && !value.includes('\\');
}

export function joinRemote(directory: string, name: string): string {
  const base = directory.endsWith('/') ? directory : `${directory}/`;
  return (base === '/' ? `/${name}` : `${base}${name}`).replace(/\/{2,}/gu, '/');
}

export function joinLocal(parent: string, name: string): string {
  const separator = /[\\/]$/u.test(parent)
    ? ''
    : parent.includes('\\') && !parent.includes('/')
      ? '\\'
      : '/';
  return `${parent}${separator}${name}`;
}

export function entrySide(entry: SftpRemoteEntry | LocalEntry): {
  name: string;
  path: string;
  isDirectory: boolean;
} {
  const directoryLike = entry.kind === 'directory' || entry.kind === 'drive';
  return { name: entry.name, path: entry.path, isDirectory: directoryLike };
}

export const ZOOM_MIN = 10;
export const ZOOM_MAX = 18;
