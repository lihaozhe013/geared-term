const { createHash } = require('node:crypto');
const {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync
} = require('node:fs');
const { dirname, join } = require('node:path');

const assetDirectory = join(__dirname, '..', 'resources', 'conpty', 'win32-x64');
const manifest = JSON.parse(readFileSync(join(assetDirectory, 'manifest.json'), 'utf8'));

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function verifyAssets() {
  for (const [name, expectedHash] of Object.entries(manifest.files)) {
    const path = join(assetDirectory, name);
    if (!existsSync(path)) {
      throw new Error(`Required Microsoft ConPTY file is missing: ${path}`);
    }
    const actualHash = sha256(path);
    if (actualHash !== expectedHash) {
      throw new Error(`Microsoft ConPTY file hash mismatch: ${path}`);
    }
  }
}

function replaceFile(source, destination) {
  mkdirSync(dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.tmp`;
  try {
    copyFileSync(source, temporary);
    if (existsSync(destination)) unlinkSync(destination);
    renameSync(temporary, destination);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function stageBesideBindings(bindings) {
  if (bindings.length === 0) {
    throw new Error('No node-pty conpty.node native binding was found to stage ConPTY beside');
  }
  for (const binding of bindings) {
    const destinationDirectory = join(dirname(binding), 'conpty');
    for (const name of Object.keys(manifest.files)) {
      const source = join(assetDirectory, name);
      const destination = join(destinationDirectory, name);
      replaceFile(source, destination);
      if (sha256(destination) !== manifest.files[name]) {
        throw new Error(`Staged Microsoft ConPTY file failed verification: ${destination}`);
      }
    }
  }
}

function stageDevelopment() {
  if (process.platform !== 'win32' || process.arch !== 'x64') return;
  verifyAssets();
  const nodePtyRoot = realpathSync(join(__dirname, '..', 'node_modules', 'node-pty'));
  const bindings = [
    join(nodePtyRoot, 'build', 'Release', 'conpty.node'),
    join(nodePtyRoot, 'build', 'Debug', 'conpty.node'),
    join(nodePtyRoot, 'prebuilds', 'win32-x64', 'conpty.node')
  ].filter(existsSync);
  stageBesideBindings(bindings);
}

function collectBindings(directory, result = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      collectBindings(path, result);
    } else if (
      entry.isFile() &&
      entry.name === 'conpty.node' &&
      /(?:build[\\/](?:Release|Debug)|prebuilds[\\/]win32-x64)[\\/]conpty\.node$/i.test(path)
    ) {
      result.push(path);
    }
  }
  return result;
}

function stagePackaged(appOutDir) {
  verifyAssets();
  const unpackedRoot = join(appOutDir, 'resources', 'app.asar.unpacked');
  if (!existsSync(unpackedRoot)) {
    throw new Error(`Packaged native modules are missing: ${unpackedRoot}`);
  }
  stageBesideBindings(collectBindings(unpackedRoot));
}

module.exports = { manifest, stageDevelopment, stagePackaged, verifyAssets };
