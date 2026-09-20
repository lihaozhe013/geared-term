import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';

/** Shared hidden-title-bar configuration for every application window. */
export function windowChromeOptions(): Pick<
  BrowserWindowConstructorOptions,
  'autoHideMenuBar' | 'titleBarOverlay' | 'titleBarStyle' | 'trafficLightPosition'
> {
  if (process.platform === 'darwin') {
    return {
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 14, y: 13 }
    };
  }

  return {
    autoHideMenuBar: true,
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
