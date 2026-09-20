import { app, type BrowserWindow, type BrowserWindowConstructorOptions } from 'electron';
import { join } from 'node:path';

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
