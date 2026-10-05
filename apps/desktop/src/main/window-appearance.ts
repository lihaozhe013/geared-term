import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';
import type { SettingsRecord } from '@geared-term/protocol';

export type WindowEffect = SettingsRecord['windowEffect'];

export function windowAppearanceOptions(
  effect: WindowEffect,
  platform: NodeJS.Platform = process.platform
): Pick<
  BrowserWindowConstructorOptions,
  'transparent' | 'backgroundColor' | 'vibrancy' | 'visualEffectState'
> {
  const transparent = effect !== 'solid';
  return {
    transparent,
    backgroundColor: transparent ? '#00000000' : '#111318',
    ...(platform === 'darwin' && effect === 'frosted'
      ? { vibrancy: 'under-window', visualEffectState: 'followWindow' }
      : {})
  };
}

export function isFrostedGlassSupported(platform: NodeJS.Platform, systemVersion: string): boolean {
  if (platform === 'darwin') return true;
  if (platform !== 'win32') return false;
  const build = Number(systemVersion.split('.')[2]);
  return Number.isInteger(build) && build >= 22621;
}

export function applyNativeWindowEffect(
  window: BrowserWindow,
  effect: WindowEffect,
  platform: NodeJS.Platform,
  systemVersion: string
): 'solid' | 'translucent' | 'frosted' {
  if (platform === 'darwin') {
    window.setVibrancy(effect === 'frosted' ? 'under-window' : null);
    return effect;
  }
  if (platform === 'win32' && isFrostedGlassSupported(platform, systemVersion)) {
    window.setBackgroundMaterial(effect === 'frosted' ? 'acrylic' : 'none');
    return effect;
  }
  return effect === 'frosted' ? 'translucent' : effect;
}
