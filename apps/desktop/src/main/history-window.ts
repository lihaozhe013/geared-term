import { BrowserWindow } from 'electron';
import { join } from 'node:path';
import type { Logger } from './logging';

/**
 * Single-instance chat-history window. Continuing a conversation broadcasts the
 * history id to every renderer so the assistant panel can pick it up.
 */
export class HistoryWindowManager {
  private window: BrowserWindow | undefined;

  constructor(
    private readonly logger: Logger,
    private readonly isDevelopment: boolean
  ) {}

  open(): void {
    if (this.window && !this.window.isDestroyed()) {
      if (this.window.isMinimized()) this.window.restore();
      this.window.focus();
      return;
    }
    const window = new BrowserWindow({
      width: 960,
      height: 640,
      minWidth: 720,
      minHeight: 480,
      title: 'Chat History',
      show: false,
      autoHideMenuBar: true,
      backgroundColor: '#0d1117',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false
      }
    });
    window.once('ready-to-show', () => window.show());
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => {
      const rendererUrl = process.env.ELECTRON_RENDERER_URL;
      if (this.isDevelopment && rendererUrl && url.startsWith(rendererUrl)) {
        return;
      }
      event.preventDefault();
      this.logger.warn('system', 'Blocked history window navigation', { url });
    });
    const rendererUrl = process.env.ELECTRON_RENDERER_URL;
    if (rendererUrl) {
      void window.loadURL(`${rendererUrl}/history.html`);
    } else {
      void window.loadFile(join(__dirname, '../renderer/history.html'));
    }
    window.on('closed', () => {
      if (this.window === window) this.window = undefined;
    });
    this.window = window;
  }
}
