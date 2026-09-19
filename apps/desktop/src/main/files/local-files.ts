import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import { basename, dirname, join, parse } from 'node:path';
import type { LocalEntry } from '@geared-term/protocol';

const ILLEGAL_NAME_CHARACTERS = /[\\/:*?"<>|\u0000-\u001f]/u;

export function isWindows(): boolean {
  return process.platform === 'win32';
}

export function isGuardedRoot(path: string): boolean {
  if (isWindows()) {
    const parsed = parse(path);
    return parsed.root === path && /^[A-Za-z]:\\$/u.test(path);
  }
  return path === '/';
}

export function enumerateWindowsDrives(): string[] {
  const drives: string[] = [];
  for (let code = 65; code <= 90; code += 1) {
    const letter = String.fromCharCode(code);
    if (existsSync(`${letter}:\\`)) drives.push(`${letter}:\\`);
  }
  return drives;
}

function permissionString(mode: number): string {
  return `0o${(mode & 0o7777).toString(8)}`;
}

async function toEntry(directory: string, name: string, guarded: boolean): Promise<LocalEntry> {
  const path = join(directory, name);
  try {
    const link = await fs.lstat(path);
    const kind = link.isSymbolicLink()
      ? 'symlink'
      : link.isDirectory()
        ? 'directory'
        : link.isFile()
          ? 'file'
          : 'other';
    return {
      name: name || path,
      path,
      kind,
      size: link.size,
      modifiedAt: Math.round(link.mtimeMs),
      permissions: permissionString(link.mode),
      guarded: guarded || isGuardedRoot(path)
    };
  } catch {
    return {
      name: name || path,
      path,
      kind: 'other',
      size: 0,
      modifiedAt: null,
      permissions: '',
      guarded: guarded || isGuardedRoot(path)
    };
  }
}

export async function listLocalDirectory(directory: string | null): Promise<LocalEntry[]> {
  if (directory === null || directory.trim() === '') {
    if (isWindows()) {
      return enumerateWindowsDrives().map((drive) => ({
        name: drive.slice(0, 2),
        path: drive,
        kind: 'drive' as const,
        size: 0,
        modifiedAt: null,
        permissions: '',
        guarded: true
      }));
    }
    return [
      {
        name: '/',
        path: '/',
        kind: 'directory' as const,
        size: 0,
        modifiedAt: null,
        permissions: '',
        guarded: true
      }
    ];
  }
  const entries: LocalEntry[] = [];
  for (const name of await fs.readdir(directory)) {
    entries.push(await toEntry(directory, name, false));
  }
  return entries.sort((left, right) => {
    if (left.kind !== right.kind) {
      if (left.kind === 'directory') return -1;
      if (right.kind === 'directory') return 1;
    }
    return left.name.localeCompare(right.name, 'en', { numeric: true });
  });
}

export function validateLocalName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed === '.' || trimmed === '..' || ILLEGAL_NAME_CHARACTERS.test(trimmed)) {
    throw new Error('Invalid file name');
  }
  return trimmed;
}

export async function makeLocalDirectory(parent: string, name: string): Promise<void> {
  const trimmed = validateLocalName(name);
  await fs.mkdir(join(parent, trimmed), { recursive: false });
}

export async function renameLocalPath(source: string, destination: string): Promise<void> {
  if (isGuardedRoot(source)) throw new Error('Drive roots cannot be renamed');
  if (isGuardedRoot(destination)) throw new Error('Cannot rename onto a drive root');
  const trimmed = validateLocalName(basename(destination));
  const target = join(dirname(destination), trimmed);
  try {
    await fs.lstat(target);
    throw new Error('A file with that name already exists');
  } catch (error) {
    if ((error as { code?: string }).code !== 'ENOENT') throw error;
  }
  await fs.rename(source, target);
}

export async function removeLocalPaths(paths: string[]): Promise<void> {
  for (const path of paths) {
    if (isGuardedRoot(path)) throw new Error('Drive roots cannot be deleted');
  }
  for (const path of paths) {
    await fs.rm(path, { recursive: true, force: true });
  }
}
