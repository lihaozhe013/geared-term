import electronUpdater from 'electron-updater';
import { UpdateStatusSchema, type UpdateStatus } from '@geared-term/protocol';
import type { Logger } from './logging';
import { fetchNightlyRelease, type NightlyRelease } from './update-release';

const { autoUpdater } = electronUpdater;
const repository = 'lihaozhe013/geared-term';
const releaseUrl = `https://github.com/${repository}/releases/tag/nightly`;
const checkIntervalMs = 24 * 60 * 60 * 1000;

type StatusPublisher = (status: UpdateStatus) => void;
type NewVersionPublisher = (release: NightlyRelease) => void;

export class UpdateManager {
  private status: UpdateStatus;
  private pendingRelease: NightlyRelease | undefined;
  private checkPromise: Promise<UpdateStatus> | undefined;
  private checkTimer: NodeJS.Timeout | undefined;
  private automaticCheckRequested = false;
  private updatePrompted = false;
  private readonly canInstall =
    process.platform === 'win32' &&
    !process.env.PORTABLE_EXECUTABLE_FILE &&
    !process.env.PORTABLE_EXECUTABLE_DIR;

  public constructor(
    private readonly logger: Logger,
    private readonly currentSha: string,
    private readonly isPackaged: boolean,
    private readonly publishStatus: StatusPublisher,
    private readonly publishNewVersion?: NewVersionPublisher
  ) {
    this.status = UpdateStatusSchema.parse({ state: 'idle', currentSha });
    if (this.isPackaged && this.canInstall) {
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = false;
      autoUpdater.allowPrerelease = true;
      autoUpdater.channel = 'beta';
      autoUpdater.on('update-available', (info) => {
        this.logger.info('system', 'Nightly update available', { version: info.version });
        this.publish({
          state: 'downloading',
          latestVersion: info.version,
          progress: 0,
          canInstall: true
        });
      });
      autoUpdater.on('update-not-available', () => {
        if (!this.pendingRelease) return;
        this.publish({ state: 'available', canInstall: false });
      });
      autoUpdater.on('download-progress', (progress) => {
        this.publish({
          state: 'downloading',
          progress: progress.percent,
          canInstall: true
        });
      });
      autoUpdater.on('update-downloaded', (info) => {
        this.logger.info('system', 'Nightly update downloaded', { version: info.version });
        this.publish({
          state: 'downloaded',
          latestVersion: info.version,
          progress: 100,
          canInstall: true
        });
      });
      autoUpdater.on('error', (error) => {
        this.logger.warn('system', 'Nightly update installation failed', {
          error: error.message
        });
        this.publish({ state: 'available', canInstall: false, error: error.message.slice(0, 512) });
      });
    }
  }

  public start(): void {
    if (!this.isPackaged) return;
    this.checkTimer = setTimeout(() => {
      void this.check('automatic');
      this.checkTimer = setInterval(() => void this.check('automatic'), checkIntervalMs);
      this.checkTimer.unref();
    }, 5000);
    this.checkTimer.unref();
  }

  public getStatus(): UpdateStatus {
    return this.status;
  }

  public check(mode: 'automatic' | 'manual' = 'manual'): Promise<UpdateStatus> {
    if (!this.isPackaged) return Promise.resolve(this.status);
    if (mode === 'automatic') this.automaticCheckRequested = true;
    if (this.checkPromise) return this.checkPromise;
    this.publish({ state: 'checking', canInstall: this.canInstall });
    this.checkPromise = this.performCheck(mode).finally(() => {
      this.automaticCheckRequested = false;
      this.checkPromise = undefined;
    });
    return this.checkPromise;
  }

  public installDownloadedUpdate(): void {
    if (!this.canInstall || this.status.state !== 'downloaded') {
      throw new Error('No downloaded Windows update is ready to install');
    }
    autoUpdater.quitAndInstall(true, true);
  }

  public stop(): void {
    if (this.checkTimer) clearTimeout(this.checkTimer);
  }

  private async performCheck(mode: 'automatic' | 'manual'): Promise<UpdateStatus> {
    if (!/^[a-f0-9]{40}$/i.test(this.currentSha)) {
      return this.fail('This build does not include a valid commit SHA', mode);
    }
    try {
      const release = await fetchNightlyRelease(fetch, AbortSignal.timeout(12_000));
      this.pendingRelease = release;
      if (release.commitSha === this.currentSha.toLowerCase()) {
        return this.publish({ state: 'up-to-date', canInstall: false });
      }
      if (this.canInstall) {
        if (!release.hasWindowsInstaller) {
          this.notifyNewVersion(release);
          return this.publish({ state: 'available', canInstall: false });
        }
        const result = await autoUpdater.checkForUpdates();
        this.notifyNewVersion(release);
        if (!result) return this.publish({ state: 'available', canInstall: false });
        if (this.status.state === 'checking') {
          this.publish({ state: 'available', canInstall: true });
        }
        return this.status;
      }
      this.notifyNewVersion(release);
      return this.publish({ state: 'available', canInstall: false });
    } catch (error) {
      return this.fail(error instanceof Error ? error.message : String(error), mode);
    }
  }

  private notifyNewVersion(release: NightlyRelease): void {
    if (!this.automaticCheckRequested || this.updatePrompted || !this.publishNewVersion) return;
    this.updatePrompted = true;
    try {
      this.publishNewVersion(release);
    } catch (error) {
      this.logger.warn('system', 'Unable to notify about a nightly update', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private fail(message: string, mode: 'automatic' | 'manual'): UpdateStatus {
    this.logger.warn('system', 'Nightly update check failed', { error: message, mode });
    return this.publish({ state: 'error', error: message.slice(0, 512), canInstall: false });
  }

  private publish(
    update: Omit<UpdateStatus, 'currentSha' | 'latestSha' | 'releaseUrl' | 'canInstall'> & {
      canInstall?: boolean;
      latestSha?: string;
      releaseUrl?: string;
    }
  ): UpdateStatus {
    this.status = UpdateStatusSchema.parse({
      ...update,
      currentSha: this.currentSha,
      latestSha: update.latestSha ?? this.pendingRelease?.commitSha,
      releaseUrl: update.releaseUrl ?? this.pendingRelease?.htmlUrl ?? releaseUrl
    });
    this.publishStatus(this.status);
    return this.status;
  }
}
