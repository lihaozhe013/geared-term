import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from './logging';
import { UpdateManager } from './update-manager';
import { fetchNightlyRelease, parseNightlyRelease } from './update-release';

const autoUpdaterMock = vi.hoisted(() => ({
  autoDownload: false,
  autoInstallOnAppQuit: false,
  allowPrerelease: false,
  channel: 'beta',
  on: vi.fn(),
  checkForUpdates: vi.fn(),
  quitAndInstall: vi.fn()
}));

vi.mock('electron-updater', () => ({ default: { autoUpdater: autoUpdaterMock } }));

const sha = '0123456789abcdef0123456789abcdef01234567';
const newerSha = 'abcdef0123456789abcdef0123456789abcdef01';

function nightlyResponse(commitSha: string): Response {
  return new Response(
    JSON.stringify({
      body: `Automated nightly build for commit ${commitSha}.`,
      html_url: 'https://github.com/lihaozhe013/geared-term/releases/tag/nightly',
      assets: [{ name: 'geared-term-windows-x64-setup.exe' }]
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  } as unknown as Logger;
}

beforeEach(() => {
  autoUpdaterMock.on.mockClear();
  autoUpdaterMock.checkForUpdates.mockReset().mockResolvedValue(null);
  autoUpdaterMock.quitAndInstall.mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async () => nightlyResponse(newerSha))
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('nightly update metadata', () => {
  it('reads the full commit SHA and detects the supported Windows installer', () => {
    expect(
      parseNightlyRelease({
        body: `Automated nightly build for commit ${sha}.`,
        html_url: 'https://github.com/lihaozhe013/geared-term/releases/tag/nightly',
        assets: [{ name: 'geared-term-windows-x64-setup.exe' }]
      })
    ).toEqual({
      commitSha: sha,
      htmlUrl: 'https://github.com/lihaozhe013/geared-term/releases/tag/nightly',
      hasWindowsInstaller: true
    });
  });

  it('rejects a release body without a full commit SHA', () => {
    expect(() =>
      parseNightlyRelease({
        body: 'Automated nightly build without commit metadata.',
        html_url: 'https://github.com/lihaozhe013/geared-term/releases/tag/nightly',
        assets: []
      })
    ).toThrow('Nightly release does not contain a full commit SHA');
  });

  it('rejects failed GitHub responses', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('rate limited', { status: 403 }));

    await expect(fetchNightlyRelease(fetcher)).rejects.toThrow('GitHub returned HTTP 403');
  });

  it('falls back to manual download when the release has no NSIS asset', () => {
    const release = parseNightlyRelease({
      body: `Automated nightly build for commit ${sha}.`,
      html_url: 'https://github.com/lihaozhe013/geared-term/releases/tag/nightly',
      assets: [{ name: 'geared-term-windows-x64-portable.exe' }]
    });

    expect(release.hasWindowsInstaller).toBe(false);
  });
});

describe('automatic update notifications', () => {
  it('notifies once when an automatic check finds a different nightly commit', async () => {
    const notify = vi.fn();
    const manager = new UpdateManager(makeLogger(), sha, true, vi.fn(), notify);

    await manager.check('automatic');
    await manager.check('automatic');

    expect(notify).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith({
      commitSha: newerSha,
      htmlUrl: 'https://github.com/lihaozhe013/geared-term/releases/tag/nightly',
      hasWindowsInstaller: true
    });
  });

  it('does not notify from a manual check, but allows a later automatic check', async () => {
    const notify = vi.fn();
    const manager = new UpdateManager(makeLogger(), sha, true, vi.fn(), notify);

    await manager.check('manual');
    expect(notify).not.toHaveBeenCalled();

    await manager.check('automatic');
    expect(notify).toHaveBeenCalledOnce();
  });

  it('keeps an automatic notification when its check joins an in-flight manual check', async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          })
      )
    );
    const notify = vi.fn();
    const manager = new UpdateManager(makeLogger(), sha, true, vi.fn(), notify);

    const manualCheck = manager.check('manual');
    const automaticCheck = manager.check('automatic');
    resolveFetch?.(nightlyResponse(newerSha));
    await Promise.all([manualCheck, automaticCheck]);

    expect(notify).toHaveBeenCalledOnce();
  });

  it('notifies with the manual-download status for portable builds', async () => {
    vi.stubEnv('PORTABLE_EXECUTABLE_FILE', 'GearedTerm.exe');
    const notify = vi.fn();
    const manager = new UpdateManager(makeLogger(), sha, true, vi.fn(), notify);

    const status = await manager.check('automatic');

    expect(status.state).toBe('available');
    expect(status.canInstall).toBe(false);
    expect(notify).toHaveBeenCalledOnce();
  });

  it.skipIf(process.platform !== 'win32')(
    'does not notify when the Windows updater check fails',
    async () => {
      const notify = vi.fn();
      autoUpdaterMock.checkForUpdates.mockRejectedValueOnce(new Error('updater feed unavailable'));
      const manager = new UpdateManager(makeLogger(), sha, true, vi.fn(), notify);

      const status = await manager.check('automatic');

      expect(status.state).toBe('error');
      expect(notify).not.toHaveBeenCalled();
    }
  );

  it('does not notify when the build is current, checking fails, or the app is unpackaged', async () => {
    const notify = vi.fn();
    const currentBuildManager = new UpdateManager(
      makeLogger(),
      sha,
      true,
      vi.fn(),
      notify
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(nightlyResponse(sha)));
    await currentBuildManager.check('automatic');
    expect(notify).not.toHaveBeenCalled();

    const failedManager = new UpdateManager(makeLogger(), sha, true, vi.fn(), notify);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unavailable')));
    await failedManager.check('automatic');
    expect(notify).not.toHaveBeenCalled();

    const unpackagedManager = new UpdateManager(makeLogger(), sha, false, vi.fn(), notify);
    await unpackagedManager.check('automatic');
    expect(notify).not.toHaveBeenCalled();
  });
});
