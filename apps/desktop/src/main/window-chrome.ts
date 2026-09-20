import { app, type BrowserWindow, type BrowserWindowConstructorOptions } from 'electron';
import { join } from 'node:path';
import type { Logger } from './logging';

function applicationIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icons', 'geared-term.png')
    : join(app.getAppPath(), 'resources', 'icons', 'geared-term.png');
}

/** Shared hidden-title-bar configuration for every application window. */
export function windowChromeOptions(): Pick<
  BrowserWindowConstructorOptions,
  'autoHideMenuBar' | 'icon' | 'titleBarStyle' | 'trafficLightPosition'
> {
  if (process.platform === 'darwin') {
    return {
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 14, y: 13 }
    };
  }

  return {
    autoHideMenuBar: true,
    icon: applicationIconPath(),
    titleBarStyle: 'hidden'
  };
}

/**
 * Mirrors the window maximized state to its renderer so the custom title bar
 * window controls can swap between the maximize and restore glyphs.
 */
export function forwardWindowControlState(window: BrowserWindow): void {
  const send = (): void => {
    if (!window.isDestroyed()) {
      window.webContents.send('window:maximized-changed', window.isMaximized());
    }
  };
  window.on('maximize', send);
  window.on('unmaximize', send);
}

export function hideNativeMenuBar(window: BrowserWindow): void {
  if (process.platform !== 'darwin') window.setMenuBarVisibility(false);
}

/**
 * Shows a hidden window after its first document load, while retaining
 * ready-to-show for a smoother first paint when Electron emits it.
 */
export function showWindowWhenReady(
  window: BrowserWindow,
  logger: Logger,
  windowName: string
): void {
  let shown = false;

  const show = (trigger: string): void => {
    if (shown || window.isDestroyed()) return;
    shown = true;
    window.show();
    logger.info('app', 'Window shown', { window: windowName, trigger });
  };

  window.once('ready-to-show', () => show('ready-to-show'));
  window.webContents.once('did-finish-load', () => show('did-finish-load'));
  window.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return;
      logger.error('system', 'Window failed to load', {
        window: windowName,
        errorCode,
        errorDescription,
        validatedURL
      });
      show('did-fail-load');
    }
  );
  window.webContents.on('render-process-gone', (_event, details) => {
    logger.error('system', 'Window renderer process exited', {
      window: windowName,
      reason: details.reason,
      exitCode: details.exitCode
    });
  });
}
