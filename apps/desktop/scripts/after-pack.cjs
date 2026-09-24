const { spawnSync } = require('node:child_process');
const { join } = require('node:path');
const { Arch } = require('electron-builder');
const { stagePackaged } = require('./conpty-assets.cjs');

function signingAuthorities(appPath) {
  const result = spawnSync('/usr/bin/codesign', ['-dvvv', appPath], { encoding: 'utf8' });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  return [...output.matchAll(/^Authority=(.*)$/gmu)].map((match) => match[1].trim());
}

async function signMacAppAdHoc(appPath) {
  // electron-builder skips signing entirely without an identity, leaving the bundle seal broken
  // (`codesign --verify` fails). Sign ad-hoc so the packaged bundle is internally valid, and step
  // aside when a real Developer ID signature is configured.
  if (signingAuthorities(appPath).length > 0) return;
  const { signApp } = require('@electron/osx-sign');
  await signApp({
    app: appPath,
    identity: '-',
    identityValidation: false,
    platform: 'darwin',
    preAutoEntitlements: false,
    preEmbedProvisioningProfile: false,
    // Hardened Runtime and secure timestamps belong to notarized Developer ID builds, which
    // electron-builder signs itself; an ad-hoc signature must not contact a timestamp authority.
    optionsForFile: () => ({ hardenedRuntime: false, timestamp: 'none' })
  });
}

module.exports = async (context) => {
  if (context.electronPlatformName === 'win32') {
    if (context.arch === Arch.x64) stagePackaged(context.appOutDir);
    return;
  }
  if (context.electronPlatformName !== 'darwin') return;
  await signMacAppAdHoc(join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`));
};
