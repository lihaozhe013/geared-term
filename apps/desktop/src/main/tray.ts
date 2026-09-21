import { app, Menu, nativeImage, Tray } from 'electron';
import { join } from 'node:path';
import type { Logger } from './logging';
import type { MenuLocale } from './menu';

const trayLabels: Record<MenuLocale, { show: string; quit: string }> = {
  'en-US': { show: 'Show Geared Term', quit: 'Quit Geared Term' },
  'zh-CN': { show: '显示 Geared Term', quit: '退出 Geared Term' }
};

function trayIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icons', 'geared-term.png')
    : join(app.getAppPath(), 'resources', 'icons', 'geared-term.png');
}

function trayIcon(): Electron.NativeImage {
  const size = process.platform === 'win32' ? 16 : 24;
  return nativeImage.createFromPath(trayIconPath()).resize({ width: size, height: size });
}

/**
 * Resident tray icon for background mode on Windows/Linux. macOS intentionally
 * has no tray icon: the app keeps its Dock entry and re-shows through the
 * activate handler, matching standard macOS application behavior.
 */
export class TrayController {
  private tray: Tray | undefined;
  private locale: MenuLocale = 'en-US';

  public constructor(
    private readonly logger: Logger,
    private readonly onToggleWindow: () => void,
    private readonly onQuit: () => void
  ) {}

  /** Idempotent: creates, recreates (locale change), or removes the icon. */
  public sync(enabled: boolean, locale: MenuLocale): void {
    if (process.platform === 'darwin') return;
    if (!enabled) {
      this.destroy();
      return;
    }
    if (this.tray && !this.tray.isDestroyed()) {
      if (locale === this.locale) return;
      this.destroy();
    }
    this.locale = locale;
    try {
      const tray = new Tray(trayIcon());
      tray.setToolTip('Geared Term');
      tray.setContextMenu(this.buildContextMenu());
      tray.on('click', () => this.onToggleWindow());
      this.tray = tray;
    } catch (error) {
      // Some Linux desktop environments expose no StatusNotifier host; the
      // single-instance lock still lets a fresh launch restore the window.
      this.logger.error('system', 'Tray icon unavailable', {
        error: error instanceof Error ? error.message : String(error)
      });
      this.tray = undefined;
    }
  }

  public destroy(): void {
    if (!this.tray || this.tray.isDestroyed()) return;
    this.tray.destroy();
    this.tray = undefined;
  }

  private buildContextMenu(): Electron.Menu {
    const labels = trayLabels[this.locale];
    return Menu.buildFromTemplate([
      { label: labels.show, click: () => this.onToggleWindow() },
      { type: 'separator' },
      { label: labels.quit, click: () => this.onQuit() }
    ]);
  }
}
