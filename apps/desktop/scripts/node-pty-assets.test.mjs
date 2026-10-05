import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  stat,
  symlink,
  writeFile
} from 'node:fs/promises';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareDevelopment, preparePackaged } from './node-pty-assets.cjs';

const temporaryRoots = [];

async function createPackage({ directories = ['prebuilds/darwin-arm64'], mode = 0o644 } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'geared-node-pty-assets-'));
  temporaryRoots.push(root);
  for (const directory of directories) {
    const path = join(root, directory);
    await mkdir(path, { recursive: true });
    await writeFile(join(path, 'pty.node'), 'native binding');
    await writeFile(join(path, 'spawn-helper'), 'helper executable');
    await chmod(join(path, 'spawn-helper'), mode);
  }
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe('macOS node-pty helper preparation', () => {
  it.each(['build/Release', 'build/Debug', 'prebuilds/darwin-arm64'])(
    'repairs an unexecutable helper in %s',
    async (directory) => {
      const root = await createPackage({ directories: [directory] });
      const resolvedRoot = await realpath(root);

      const prepared = prepareDevelopment({ nodePtyRoot: root, platform: 'darwin', arch: 'arm64' });

      expect(prepared).toEqual([join(resolvedRoot, directory, 'spawn-helper')]);
      expect((await stat(prepared[0]).then((entry) => entry.mode)) & 0o777).toBe(0o755);
    }
  );

  it('prepares every loader candidate and remains idempotent', async () => {
    const directories = ['build/Release', 'build/Debug', 'prebuilds/darwin-arm64'];
    const root = await createPackage({ directories });

    const first = prepareDevelopment({ nodePtyRoot: root, platform: 'darwin', arch: 'arm64' });
    const second = prepareDevelopment({ nodePtyRoot: root, platform: 'darwin', arch: 'arm64' });

    expect(first).toHaveLength(3);
    expect(second).toEqual(first);
    for (const helper of second) {
      expect((await stat(helper).then((entry) => entry.mode)) & 0o777).toBe(0o755);
    }
  });

  it('selects the x64 prebuild for an Intel macOS package', async () => {
    const root = await createPackage({ directories: ['prebuilds/darwin-x64'] });
    const resolvedRoot = await realpath(root);

    const prepared = preparePackaged({ nodePtyRoot: root, platform: 'darwin', arch: 'x64' });

    expect(prepared).toEqual([join(resolvedRoot, 'prebuilds/darwin-x64/spawn-helper')]);
    expect((await stat(prepared[0])).mode & 0o777).toBe(0o755);
  });

  it('repairs a hard-linked project copy without changing the linked source', async () => {
    const root = await createPackage();
    const helper = join(root, 'prebuilds/darwin-arm64/spawn-helper');
    const sharedSource = join(root, 'shared-store-helper');
    await link(helper, sharedSource);

    preparePackaged({ nodePtyRoot: root, platform: 'darwin', arch: 'arm64' });

    expect((await stat(helper)).nlink).toBe(1);
    expect((await stat(helper)).mode & 0o777).toBe(0o755);
    expect((await stat(sharedSource)).nlink).toBe(1);
    expect((await stat(sharedSource)).mode & 0o777).toBe(0o644);
  });

  it('does not modify a packaged node-pty path that escapes app dependencies', async () => {
    const root = await mkdtemp(join(tmpdir(), 'geared-packaged-boundary-'));
    temporaryRoots.push(root);
    const outsidePackage = await createPackage();
    const modulesRoot = join(root, 'Resources', 'app.asar.unpacked', 'node_modules');
    await mkdir(modulesRoot, { recursive: true });
    const packageLink = join(modulesRoot, 'node-pty');
    await symlink(outsidePackage, packageLink, 'dir');

    expect(() =>
      preparePackaged({ nodePtyRoot: packageLink, platform: 'darwin', arch: 'arm64' })
    ).toThrow('Resolved node-pty outside the packaged dependency directory');
    expect(
      (await stat(join(outsidePackage, 'prebuilds/darwin-arm64/spawn-helper'))).mode & 0o777
    ).toBe(0o644);
  });

  it('reports a binding whose adjacent helper is missing', async () => {
    const root = await createPackage();
    const helper = join(await realpath(root), 'prebuilds/darwin-arm64/spawn-helper');
    await rm(helper);

    expect(() => preparePackaged({ nodePtyRoot: root, platform: 'darwin', arch: 'arm64' })).toThrow(
      `Unable to inspect node-pty spawn-helper ${helper}`
    );
  });

  it('reports permission failures with the affected helper path', async () => {
    const root = await createPackage();
    const helper = join(await realpath(root), 'prebuilds/darwin-arm64/spawn-helper');
    const failingFileSystem = {
      ...fs,
      chmodSync: vi.fn(() => {
        throw new Error('permission denied');
      })
    };

    expect(() =>
      prepareDevelopment({
        nodePtyRoot: root,
        platform: 'darwin',
        arch: 'arm64',
        fileSystem: failingFileSystem
      })
    ).toThrow(`Unable to prepare node-pty spawn-helper ${helper}: permission denied`);
  });

  it('does not alter a helper in a package without a macOS binding', async () => {
    const root = await createPackage({ directories: ['prebuilds/darwin-arm64'], mode: 0o644 });
    const resolvedRoot = await realpath(root);
    await rm(join(root, 'prebuilds/darwin-arm64/pty.node'));

    expect(() =>
      prepareDevelopment({ nodePtyRoot: root, platform: 'darwin', arch: 'arm64' })
    ).toThrow(`No macOS node-pty pty.node binding was found under ${resolvedRoot}`);
    expect((await stat(join(root, 'prebuilds/darwin-arm64/spawn-helper'))).mode & 0o777).toBe(
      0o644
    );
  });

  it('skips helper discovery on platforms that do not use the macOS spawn helper', async () => {
    const root = await createPackage();

    expect(prepareDevelopment({ nodePtyRoot: join(root, 'missing'), platform: 'linux' })).toEqual(
      []
    );
  });
});
