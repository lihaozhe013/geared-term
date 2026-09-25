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
  downloadUpdate: vi.fn(),
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

function emitUpdaterEvent(event: string, payload: unknown): void {
  const calls = autoUpdaterMock.on.mock.calls as unknown as Array<
    [string, (input: unknown) => void]
  >;
  for (const [registeredEvent, handler] of calls) {
    if (registeredEvent === event) handler(payload);
  }
}

beforeEach(() => {
  autoUpdaterMock.autoDownload = false;
  autoUpdaterMock.on.mockClear();
  autoUpdaterMock.checkForUpdates.mockReset().mockResolvedValue(null);
  autoUpdaterMock.downloadUpdate.mockReset().mockResolvedValue([]);
  autoUpdaterMock.quitAndInstall.mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async () => nightlyResponse(newerSha))
  );
});

afterEach(() => {
  vi.useRealTimers();
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

describe('automatic update checks', () => {
  it('notifies for an automatic new-SHA result, but not for manual checks', async () => {
    const notify = vi.fn();
    const manager = new UpdateManager(makeLogger(), sha, true, vi.fn(), notify);

    await manager.check('manual');
    expect(notify).not.toHaveBeenCalled();
    await manager.check('automatic');

    expect(notify).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith({
      commitSha: newerSha,
      htmlUrl: 'https://github.com/lihaozhe013/geared-term/releases/tag/nightly',
      hasWindowsInstaller: true
    });
  });

  it('suppresses an in-flight automatic notification after the setting is disabled', async () => {
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

    const request = manager.check('automatic');
    manager.setAutomaticChecksEnabled(false);
    resolveFetch?.(nightlyResponse(newerSha));
    await request;

    expect(notify).not.toHaveBeenCalled();
  });

  it('does not automatically check while disabled and still allows a manual check', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockImplementation(async () => nightlyResponse(newerSha));
    vi.stubGlobal('fetch', fetcher);
    const manager = new UpdateManager(makeLogger(), sha, true, vi.fn(), undefined, false);

    manager.start();
    await vi.advanceTimersByTimeAsync(6000);
    expect(fetcher).not.toHaveBeenCalled();
    expect((await manager.check('manual')).state).toBe('available');
    expect(fetcher).toHaveBeenCalledOnce();
    manager.stop();
  });

  it('schedules the startup check after automatic checks are re-enabled', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn().mockImplementation(async () => nightlyResponse(newerSha));
    vi.stubGlobal('fetch', fetcher);
    const manager = new UpdateManager(makeLogger(), sha, true, vi.fn(), undefined, false);

    manager.start();
    await vi.advanceTimersByTimeAsync(6000);
    expect(fetcher).not.toHaveBeenCalled();

    manager.setAutomaticChecksEnabled(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetcher).toHaveBeenCalledOnce();
    manager.stop();
  });

  it('keeps one automatic request when it joins an in-flight manual check', async () => {
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

  it('notifies with manual-download status for portable builds', async () => {
    vi.stubEnv('PORTABLE_EXECUTABLE_FILE', 'GearedTerm.exe');
    const notify = vi.fn();
    const manager = new UpdateManager(makeLogger(), sha, true, vi.fn(), notify);

    const status = await manager.check('automatic');
    expect(status.state).toBe('available');
    expect(status.canInstall).toBe(false);
    expect(notify).toHaveBeenCalledOnce();
  });

  it('does not notify when current, on failure, or unpackaged', async () => {
    const notify = vi.fn();
    const currentBuildManager = new UpdateManager(makeLogger(), sha, true, vi.fn(), notify);
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

describe('explicit Windows update downloads', () => {
  it('only downloads after an explicit request and publishes progress and readiness', async () => {
    autoUpdaterMock.checkForUpdates.mockResolvedValue({ isUpdateAvailable: true });
    const manager = new UpdateManager(makeLogger(), sha, true, vi.fn(), undefined, true, true);

    const available = await manager.check('manual');
    expect(available).toMatchObject({ state: 'available', canInstall: true });
    expect(autoUpdaterMock.autoDownload).toBe(false);
    expect(autoUpdaterMock.downloadUpdate).not.toHaveBeenCalled();

    manager.startDownload();
    expect(autoUpdaterMock.downloadUpdate).toHaveBeenCalledOnce();
    expect(manager.getStatus()).toMatchObject({ state: 'downloading', progress: 0 });

    emitUpdaterEvent('download-progress', { percent: 37 });
    expect(manager.getStatus()).toMatchObject({ state: 'downloading', progress: 37 });
    emitUpdaterEvent('update-downloaded', { version: '0.1.0-beta.1' });
    expect(manager.getStatus()).toMatchObject({ state: 'downloaded', progress: 100 });

    manager.installDownloadedUpdate();
    expect(autoUpdaterMock.quitAndInstall).toHaveBeenCalledWith(true, true);
  });

  it('rejects downloads unless a Windows installer update is ready', () => {
    const manager = new UpdateManager(makeLogger(), sha, true, vi.fn(), undefined, true, true);
    expect(() => manager.startDownload()).toThrow('No downloadable Windows update is available');
  });
});
