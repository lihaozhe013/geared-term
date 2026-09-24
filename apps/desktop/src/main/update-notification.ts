import type { BrowserWindow, MessageBoxOptions } from 'electron';
import type { InstallChannel } from '@geared-term/protocol';
import type { Logger } from './logging';
import type { MenuLocale } from './menu';
import type { NightlyRelease } from './update-release';

type ShowMessageBox = (
  parent: BrowserWindow,
  options: MessageBoxOptions
) => Promise<{ response: number }>;

export class UpdateNotificationController {
  private pendingRelease: NightlyRelease | undefined;
  private hasPrompted = false;

  public constructor(
    private readonly logger: Logger,
    private readonly getMainWindow: () => BrowserWindow | undefined,
    private readonly getLocale: () => MenuLocale,
    private readonly openAboutSettings: () => void,
    private readonly showMessageBox: ShowMessageBox,
    private readonly getInstallChannel: () => InstallChannel = () => 'manual'
  ) {}

  public notify(release: NightlyRelease): void {
    if (this.hasPrompted) return;
    this.hasPrompted = true;
    this.pendingRelease = release;
    this.showPendingPrompt();
  }

  public onMainWindowPresented(): void {
    this.showPendingPrompt();
  }

  private showPendingPrompt(): void {
    const release = this.pendingRelease;
    const window = this.getMainWindow();
    if (
      !release ||
      !window ||
      window.isDestroyed() ||
      !window.isVisible() ||
      window.isMinimized()
    ) {
      return;
    }

    this.pendingRelease = undefined;
    const chinese = this.getLocale() === 'zh-CN';
    const commit = release.commitSha.slice(0, 7);
    const homebrewManaged = this.getInstallChannel() === 'homebrew-cask';
    const guidance = chinese
      ? homebrewManaged
        ? '\u5f53\u524d\u5b89\u88c5\u7531 Homebrew \u7ba1\u7406\uff0c\u8fd0\u884c brew upgrade --cask geared-term \u5373\u53ef\u5347\u7ea7\u3002'
        : '\u524d\u5f80\u8bbe\u7f6e \u2192 \u5173\u4e8e\u67e5\u770b\u66f4\u65b0\u9009\u9879\u3002'
      : homebrewManaged
        ? 'This install is managed by Homebrew: run brew upgrade --cask geared-term to update.'
        : 'Open Settings → About to view update options.';
    const options: MessageBoxOptions = chinese
      ? {
          type: 'info',
          title: '\u53d1\u73b0\u65b0\u7248\u672c',
          message: `\u53d1\u73b0\u4e86\u8f83\u65b0\u7684 nightly \u7248\u672c\uff08\u63d0\u4ea4 ${commit}\uff09\u3002${guidance}`,
          buttons: ['\u524d\u5f80\u8bbe\u7f6e', '\u7a0d\u540e'],
          defaultId: 0,
          cancelId: 1
        }
      : {
          type: 'info',
          title: 'Update available',
          message: `A newer nightly build is available (${commit}). ${guidance}`,
          buttons: ['Open Settings', 'Later'],
          defaultId: 0,
          cancelId: 1
        };

    void this.showMessageBox(window, options)
      .then(({ response }) => {
        if (response === 0) this.openAboutSettings();
      })
      .catch((error: unknown) => {
        this.logger.warn('system', 'Unable to show update notification', {
          error: error instanceof Error ? error.message : String(error)
        });
      });
  }
}
