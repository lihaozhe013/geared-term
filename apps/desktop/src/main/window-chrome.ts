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
  'autoHideMenuBar' | 'icon' | 'titleBarOverlay' | 'titleBarStyle' | 'trafficLightPosition'
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
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0d1117',
      symbolColor: '#c7d0df',
      height: 40
    }
  };
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
