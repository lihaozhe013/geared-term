const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const { dirname, isAbsolute, join, relative, resolve, sep } = require('node:path');

const helperMode = 0o755;
const bindingDirectories = ['build/Release', 'build/Debug'];

function errorDetails(error) {
  return error instanceof Error ? error.message : String(error);
}

function scopedPath(root, candidate) {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const pathFromRoot = relative(resolvedRoot, resolvedCandidate);
  if (pathFromRoot.startsWith(`..${sep}`) || pathFromRoot === '..' || isAbsolute(pathFromRoot)) {
    throw new Error(`Refusing to modify a path outside the node-pty package: ${resolvedCandidate}`);
  }
  return resolvedCandidate;
}

function replaceHardLinkedHelper(helper, fileSystem) {
  const temporary = `${helper}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fileSystem.copyFileSync(helper, temporary, fileSystem.constants.COPYFILE_EXCL);
    fileSystem.chmodSync(temporary, helperMode);
    fileSystem.renameSync(temporary, helper);
  } catch (error) {
    try {
      fileSystem.unlinkSync(temporary);
    } catch (cleanupError) {
      if (cleanupError.code !== 'ENOENT') {
        throw new Error(
          `Unable to clean up node-pty helper copy ${temporary}: ${errorDetails(cleanupError)}`,
          { cause: error }
        );
      }
    }
    throw error;
  }
}

function prepareSpawnHelpers({ nodePtyRoot, platform, arch, fileSystem = fs }) {
  if (platform !== 'darwin') return [];
  if (arch !== 'arm64' && arch !== 'x64') {
    throw new Error(`Unsupported macOS architecture for node-pty: ${arch}`);
  }

  const packageRoot = resolve(nodePtyRoot);
  const candidates = [
    ...bindingDirectories.map((directory) => join(packageRoot, directory)),
    join(packageRoot, 'prebuilds', `darwin-${arch}`)
  ];
  const prepared = [];

  for (const directory of candidates) {
    const binding = join(directory, 'pty.node');
    let bindingStat;
    try {
      bindingStat = fileSystem.statSync(binding);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw new Error(`Unable to inspect node-pty binding ${binding}: ${errorDetails(error)}`, {
        cause: error
      });
    }
    if (!bindingStat.isFile()) continue;

    const helper = scopedPath(packageRoot, join(directory, 'spawn-helper'));
    let helperStat;
    try {
      helperStat = fileSystem.lstatSync(helper);
    } catch (error) {
      throw new Error(`Unable to inspect node-pty spawn-helper ${helper}: ${errorDetails(error)}`, {
        cause: error
      });
    }
    if (!helperStat.isFile()) {
      throw new Error(`node-pty spawn-helper is not a regular file: ${helper}`);
    }

    try {
      if ((helperStat.mode & 0o777) !== helperMode) {
        if (helperStat.nlink > 1) {
          replaceHardLinkedHelper(helper, fileSystem);
        } else {
          fileSystem.chmodSync(helper, helperMode);
        }
      }
      const verified = fileSystem.statSync(helper);
      if ((verified.mode & 0o777) !== helperMode) {
        throw new Error(`expected permissions 0755, found ${(verified.mode & 0o777).toString(8)}`);
      }
    } catch (error) {
      throw new Error(`Unable to prepare node-pty spawn-helper ${helper}: ${errorDetails(error)}`, {
        cause: error
      });
    }
    prepared.push(helper);
  }

  if (prepared.length === 0) {
    throw new Error(`No macOS node-pty pty.node binding was found under ${packageRoot}`);
  }
  return prepared;
}

function prepareDevelopment(options = {}) {
  const fileSystem = options.fileSystem ?? fs;
  const platform = options.platform ?? process.platform;
  if (platform !== 'darwin') return [];

  let nodePtyRoot;
  try {
    if (options.nodePtyRoot) {
      nodePtyRoot = fileSystem.realpathSync(options.nodePtyRoot);
    } else {
      const modulesRoot = fileSystem.realpathSync(
        join(__dirname, '..', '..', '..', 'node_modules')
      );
      nodePtyRoot = fileSystem.realpathSync(join(__dirname, '..', 'node_modules', 'node-pty'));
      const pathFromModules = relative(modulesRoot, nodePtyRoot);
      if (
        pathFromModules.startsWith(`..${sep}`) ||
        pathFromModules === '..' ||
        isAbsolute(pathFromModules)
      ) {
        throw new Error(
          `Resolved node-pty outside the workspace dependency directory: ${nodePtyRoot}`
        );
      }
    }
  } catch (error) {
    throw new Error(`Unable to resolve the desktop node-pty dependency: ${errorDetails(error)}`, {
      cause: error
    });
  }

  return prepareSpawnHelpers({
    nodePtyRoot,
    platform,
    arch: options.arch ?? process.arch,
    fileSystem
  });
}

function preparePackaged({ nodePtyRoot, platform = 'darwin', arch, fileSystem = fs }) {
  if (platform !== 'darwin') return [];
  let resolvedRoot;
  try {
    resolvedRoot = fileSystem.realpathSync(nodePtyRoot);
    const resolvedModulesRoot = fileSystem.realpathSync(dirname(resolve(nodePtyRoot)));
    if (dirname(resolvedRoot) !== resolvedModulesRoot) {
      throw new Error(
        `Resolved node-pty outside the packaged dependency directory: ${resolvedRoot}`
      );
    }
  } catch (error) {
    throw new Error(
      `Unable to resolve packaged node-pty at ${nodePtyRoot}: ${errorDetails(error)}`,
      {
        cause: error
      }
    );
  }
  return prepareSpawnHelpers({ nodePtyRoot: resolvedRoot, platform, arch, fileSystem });
}

module.exports = { prepareDevelopment, preparePackaged, prepareSpawnHelpers };
