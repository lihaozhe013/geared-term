import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { InstallChannel } from '@geared-term/protocol';

const caskToken = 'geared-term';

export interface InstallChannelProbe {
  platform: string;
  arch: string;
  homebrewPrefix?: string;
  portableExecutableFile?: string;
  portableExecutableDir?: string;
}

export function currentInstallChannelProbe(): InstallChannelProbe {
  return {
    platform: process.platform,
    arch: process.arch,
    homebrewPrefix: process.env.HOMEBREW_PREFIX,
    portableExecutableFile: process.env.PORTABLE_EXECUTABLE_FILE,
    portableExecutableDir: process.env.PORTABLE_EXECUTABLE_DIR
  };
}

export function detectInstallChannel(
  probe: InstallChannelProbe,
  exists: (path: string) => boolean = existsSync
): InstallChannel {
  if (probe.platform === 'win32') {
    return probe.portableExecutableFile || probe.portableExecutableDir
      ? 'manual'
      : 'windows-installer';
  }
  if (probe.platform !== 'darwin') return 'manual';
  const prefix = probe.homebrewPrefix?.trim();
  const homebrewRoot =
    prefix && prefix.length > 0 ? prefix : probe.arch === 'arm64' ? '/opt/homebrew' : '/usr/local';
  return exists(join(homebrewRoot, 'Caskroom', caskToken)) ? 'homebrew-cask' : 'manual';
}
