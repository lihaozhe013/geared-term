import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isGuardedRoot,
  listLocalDirectory,
  makeLocalDirectory,
  removeLocalPaths,
  renameLocalPath,
  validateLocalName
} from './local-files';

const guardedRoot = process.platform === 'win32' ? 'C:\\' : '/';

async function tempDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'geared-local-files-'));
}

describe('validateLocalName', () => {
  it('accepts ordinary names', () => {
    expect(validateLocalName(' reports ')).toBe('reports');
  });

  it('rejects traversal and separators', () => {
    expect(() => validateLocalName('..')).toThrow(/Invalid file name/u);
    expect(() => validateLocalName('a/b')).toThrow(/Invalid file name/u);
    expect(() => validateLocalName('a\\b')).toThrow(/Invalid file name/u);
    expect(() => validateLocalName('')).toThrow(/Invalid file name/u);
  });
});

describe('isGuardedRoot', () => {
  it('recognizes the platform root', () => {
    expect(isGuardedRoot(guardedRoot)).toBe(true);
    expect(isGuardedRoot(join(guardedRoot, 'tmp'))).toBe(false);
  });
});

describe('listLocalDirectory', () => {
  it('lists directories with metadata and sorts directories first', async () => {
    const root = await tempDirectory();
    await mkdir(join(root, 'zeta'));
    await writeFile(join(root, 'alpha.txt'), 'x');
    const entries = await listLocalDirectory(root);
    expect(entries.map((entry) => entry.name)).toEqual(['zeta', 'alpha.txt']);
    const file = entries.find((entry) => entry.name === 'alpha.txt');
    expect(file?.kind).toBe('file');
    expect(file?.permissions).toMatch(/^0o\d+$/u);
  });

  it('returns an overview for the null directory', async () => {
    const entries = await listLocalDirectory(null);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((entry) => entry.guarded)).toBe(true);
  });
});

describe('mutations', () => {
  it('creates folders and refuses invalid names', async () => {
    const root = await tempDirectory();
    await makeLocalDirectory(root, 'fresh');
    const names = (await listLocalDirectory(root)).map((entry) => entry.name);
    expect(names).toContain('fresh');
    await expect(makeLocalDirectory(root, '../escape')).rejects.toThrow(/Invalid file name/u);
  });

  it('refuses to rename or delete guarded roots', async () => {
    await expect(renameLocalPath(guardedRoot, '/tmp/whatever')).rejects.toThrow(
      /Drive roots cannot be renamed/u
    );
    await expect(removeLocalPaths([guardedRoot])).rejects.toThrow(/Drive roots cannot be deleted/u);
  });

  it('refuses to rename onto an existing name', async () => {
    const root = await tempDirectory();
    await makeLocalDirectory(root, 'one');
    await makeLocalDirectory(root, 'two');
    await expect(renameLocalPath(join(root, 'one'), join(root, 'two'))).rejects.toThrow(
      /already exists/u
    );
  });

  it('deletes recursively', async () => {
    const root = await tempDirectory();
    await mkdir(join(root, 'tree', 'branch'), { recursive: true });
    await writeFile(join(root, 'tree', 'branch', 'leaf.txt'), 'x');
    await removeLocalPaths([join(root, 'tree')]);
    expect((await listLocalDirectory(root)).map((entry) => entry.name)).toEqual([]);
  });
});
