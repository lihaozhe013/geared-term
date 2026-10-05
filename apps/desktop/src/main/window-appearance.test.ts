import { describe, expect, it } from 'vitest';
import { windowAppearanceOptions } from './window-appearance';

describe('windowAppearanceOptions', () => {
  it('sets launch-time macOS vibrancy to follow the system window focus', () => {
    expect(windowAppearanceOptions('frosted', 'darwin')).toEqual({
      transparent: true,
      backgroundColor: '#00000000',
      vibrancy: 'under-window',
      visualEffectState: 'followWindow'
    });
  });

  it('does not configure macOS vibrancy for translucency or solid windows', () => {
    expect(windowAppearanceOptions('translucent', 'darwin')).toEqual({
      transparent: true,
      backgroundColor: '#00000000'
    });
    expect(windowAppearanceOptions('solid', 'darwin')).toEqual({
      transparent: false,
      backgroundColor: '#111318'
    });
  });

  it('leaves other platforms on their existing material configuration path', () => {
    expect(windowAppearanceOptions('frosted', 'win32')).toEqual({
      transparent: true,
      backgroundColor: '#00000000'
    });
  });
});
