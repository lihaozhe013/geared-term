import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectInstallChannel, type InstallChannelProbe } from './install-channel';

function probe(overrides: Partial<InstallChannelProbe> = {}): InstallChannelProbe {
  return { platform: 'darwin', arch: 'arm64', ...overrides };
}

function caskroomPath(prefix: string): string {
  return join(prefix, 'Caskroom', 'geared-term');
}

describe('install channel detection', () => {
  it('reports the Homebrew cask channel only when the caskroom directory exists', () => {
    expect(detectInstallChannel(probe(), (path) => path === caskroomPath('/opt/homebrew'))).toBe(
      'homebrew-cask'
    );
    expect(detectInstallChannel(probe(), () => false)).toBe('manual');
  });

  it('honours HOMEBREW_PREFIX and the Intel default prefix', () => {
    expect(
      detectInstallChannel(
        probe({ homebrewPrefix: '/Users/dev/brew' }),
        (path) => path === caskroomPath('/Users/dev/brew')
      )
    ).toBe('homebrew-cask');
    expect(
      detectInstallChannel(probe({ arch: 'x64' }), (path) => path === caskroomPath('/usr/local'))
    ).toBe('homebrew-cask');
  });

  it('keeps the Windows installer channel distinct from portable builds', () => {
    expect(detectInstallChannel(probe({ platform: 'win32' }), () => false)).toBe(
      'windows-installer'
    );
    expect(
      detectInstallChannel(
        probe({ platform: 'win32', portableExecutableFile: 'GearedTerm.exe' }),
        () => true
      )
    ).toBe('manual');
    expect(
      detectInstallChannel(
        probe({ platform: 'win32', portableExecutableDir: 'C:\\tmp' }),
        () => true
      )
    ).toBe('manual');
  });

  it('never reports Homebrew on other platforms', () => {
    expect(detectInstallChannel(probe({ platform: 'linux' }), () => true)).toBe('manual');
  });
});
