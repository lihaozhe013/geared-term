import { BrowserWindow } from 'electron';
import { join } from 'node:path';
import type { Logger } from './logging';
import { hideNativeMenuBar, showWindowWhenReady, windowChromeOptions } from './window-chrome';

export type SettingsCategory =
  | 'general'
  | 'appearance'
  | 'terminal'
  | 'sftp'
  | 'ai-connections'
  | 'ai-assistant'
  | 'security'
  | 'about';

/**
 * Single-instance settings window. Re-opening while visible focuses the window
 * and optionally navigates it to a category, mirroring the reference design.
 */
export class SettingsWindowManager {
  private window: BrowserWindow | undefined;

  constructor(
    private readonly logger: Logger,
    private readonly isDevelopment: boolean
  ) {}

  open(category?: SettingsCategory): void {
    if (this.window && !this.window.isDestroyed()) {
      if (category) this.window.webContents.send('settings:navigate', category);
      if (this.window.isMinimized()) this.window.restore();
      this.window.focus();
      return;
    }
    const window = new BrowserWindow({
      width: 1080,
      height: 720,
      minWidth: 760,
      minHeight: 520,
      title: 'Geared Term Settings',
      show: false,
      ...windowChromeOptions(),
      backgroundColor: '#0d1117',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false
      }
    });
    hideNativeMenuBar(window);
    showWindowWhenReady(window, this.logger, 'settings');
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => {
      const rendererUrl = process.env.ELECTRON_RENDERER_URL;
      if (this.isDevelopment && rendererUrl && url.startsWith(rendererUrl)) {
        return;
      }
      event.preventDefault();
      this.logger.warn('system', 'Blocked settings window navigation', { url });
    });
    if (category) {
      window.webContents.once('did-finish-load', () => {
        if (!window.isDestroyed()) window.webContents.send('settings:navigate', category);
      });
    }
    const rendererUrl = process.env.ELECTRON_RENDERER_URL;
    if (rendererUrl) {
      void window.loadURL(`${rendererUrl}/settings.html`);
    } else {
      void window.loadFile(join(__dirname, '../renderer/settings.html'));
    }
    window.on('closed', () => {
      if (this.window === window) this.window = undefined;
    });
    this.window = window;
  }
}
