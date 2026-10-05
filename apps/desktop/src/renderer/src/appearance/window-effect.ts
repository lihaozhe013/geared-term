import type { AppInfo, SettingsRecord } from '@geared-term/protocol';

export type WindowEffect = SettingsRecord['windowEffect'];

export function isFrostedGlassSupported(info: AppInfo): boolean {
  if (info.platform === 'darwin') return true;
  if (info.platform !== 'win32') return false;
  const build = Number(info.systemVersion.split('.')[2]);
  return Number.isInteger(build) && build >= 22621;
}

export function requiresWindowRestart(requested: WindowEffect, atLaunch: WindowEffect): boolean {
  return (requested === 'solid') !== (atLaunch === 'solid');
}

export function effectiveWindowEffect(
  requested: WindowEffect,
  atLaunch: WindowEffect,
  info: AppInfo | null
): WindowEffect {
  if (requiresWindowRestart(requested, atLaunch)) return atLaunch;
  if (requested === 'frosted' && info && !isFrostedGlassSupported(info)) return 'translucent';
  return requested;
}

export function applyWindowSurface(effect: WindowEffect, opacityPercent: number): void {
  document.documentElement.dataset.windowEffect = effect;
  document.documentElement.style.setProperty('--gt-window-opacity', `${opacityPercent}%`);
}
