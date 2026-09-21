import { describe, expect, it } from 'vitest';
import { normalizeTerminalFontFallbacks } from '@geared-term/protocol';
import {
  builtinThemes,
  builtinThemeNames,
  buildSearchDecorations,
  buildXtermTheme,
  derivePalette,
  paletteCssDeclarations,
  resolvePalette
} from './themes';

describe('normalizeTerminalFontFallbacks', () => {
  const entry = (name: string) => ({ name, scale: 1, offsetX: 0, offsetY: 0 });

  it('preserves order', () => {
    expect(
      normalizeTerminalFontFallbacks('Mono', [entry('B'), entry('A')]).map((item) => item.name)
    ).toEqual(['B', 'A']);
  });

  it('removes blanks, duplicates, and the primary font', () => {
    const result = normalizeTerminalFontFallbacks('Cascadia Code', [
      entry('  '),
      entry('JetBrains Mono'),
      entry('jetbrains mono'),
      entry('Cascadia Code'),
      entry('Consolas')
    ]);
    expect(result.map((item) => item.name)).toEqual(['JetBrains Mono', 'Consolas']);
  });

  it('keeps adjustments attached to their fonts', () => {
    const [only] = normalizeTerminalFontFallbacks('Mono', [
      { name: ' Symbols Nerd', scale: 1.1, offsetX: -2, offsetY: 3 }
    ]);
    expect(only).toEqual({ name: 'Symbols Nerd', scale: 1.1, offsetX: -2, offsetY: 3 });
  });
});

describe('themes', () => {
  it('includes the dark default and the four Catppuccin variants', () => {
    for (const name of [
      'Geared Dark',
      'Catppuccin Latte',
      'Catppuccin Frappé',
      'Catppuccin Macchiato',
      'Catppuccin Mocha'
    ]) {
      expect(builtinThemeNames).toContain(name);
    }
  });

  it('derives a full coordinated palette from a minimal theme', () => {
    const palette = derivePalette({
      background: '#101018',
      foreground: '#e0e0e8',
      cursor: '#80ffcc'
    });
    expect(palette.panel).toMatch(/^#[0-9a-f]{6}$/u);
    expect(palette.borderStrong).toMatch(/^#[0-9a-f]{6}$/u);
    expect(palette.danger).toMatch(/^#[0-9a-f]{6}$/u);
    expect(palette.cursor).toBe('#80ffcc');
  });

  it('a user theme overrides a built-in of the same name', () => {
    const palette = resolvePalette('Geared Dark', [
      {
        name: 'Geared Dark',
        colors: { background: '#101018', foreground: '#e0e0e8', cursor: '#80ffcc' }
      }
    ]);
    expect(palette.background).toBe('#101018');
    expect(palette.cursor).toBe('#80ffcc');
    expect(palette.accent).toBe('#5c8ea5');
  });

  it('unknown names fall back to the default theme', () => {
    expect(resolvePalette('Nope', []).background).toBe('#0d1117');
  });

  it('uses the Catppuccin mauve as accent for every flavor', () => {
    const accents = ['Mocha', 'Macchiato', 'Frappé', 'Latte'].map(
      (flavor) => builtinThemes[`Catppuccin ${flavor}`]?.accent
    );
    expect(accents).toEqual(['#cba6f7', '#c6a0f6', '#ca9ee6', '#8839ef']);
  });

  it('pins the Mocha ANSI array to the official terminal palette', () => {
    expect(builtinThemes['Catppuccin Mocha']?.ansi).toEqual([
      '#45475a',
      '#f38ba8',
      '#a6e3a1',
      '#f9e2af',
      '#89b4fa',
      '#f5c2e7',
      '#94e2d5',
      '#bac2de',
      '#585b70',
      '#f38ba8',
      '#a6e3a1',
      '#f9e2af',
      '#89b4fa',
      '#f5c2e7',
      '#94e2d5',
      '#a6adc8'
    ]);
  });

  it('maps the ANSI array onto xterm named theme slots', () => {
    const mocha = builtinThemes['Catppuccin Mocha'];
    expect(mocha).toBeDefined();
    if (!mocha) return;
    const theme = buildXtermTheme(mocha);
    expect(theme.background).toBe('#1e1e2e');
    expect(theme.foreground).toBe('#cdd6f4');
    expect(theme.cursor).toBe('#f5e0dc');
    expect(theme.selectionBackground).toBe('#585b70');
    expect(theme.black).toBe('#45475a');
    expect(theme.green).toBe('#a6e3a1');
    expect(theme.brightBlack).toBe('#585b70');
    expect(theme.brightWhite).toBe('#a6adc8');
    expect(theme.extendedAnsi).toEqual(['#fab387', '#f5e0dc']);
  });

  it('derives a full 16-color ANSI palette for themes without one', () => {
    const derived = derivePalette({
      background: '#101018',
      foreground: '#e0e0e8',
      cursor: '#80ffcc'
    });
    expect(derived.ansi).toHaveLength(16);
    for (const color of derived.ansi) expect(color).toMatch(/^#[0-9a-f]{6}$/u);
    const theme = buildXtermTheme(derived);
    expect(theme.green).toBe(derived.ansi[2]);
  });

  it('keeps a user override of a built-in theme fully ANSI-themed', () => {
    const palette = resolvePalette('Catppuccin Mocha', [
      {
        name: 'Catppuccin Mocha',
        colors: { background: '#101018', foreground: '#e0e0e8', cursor: '#80ffcc' }
      }
    ]);
    expect(palette.ansi).toHaveLength(16);
    expect(palette.extendedAnsi).toEqual(['#fab387', '#f5e0dc']);
  });

  it('emits every ANSI slot and the accent keyword token as CSS variables', () => {
    const mocha = builtinThemes['Catppuccin Mocha'];
    expect(mocha).toBeDefined();
    if (!mocha) return;
    const variables = new Map(paletteCssDeclarations(mocha));
    mocha.ansi.forEach((color, index) => {
      expect(variables.get(`--gt-ansi-${index}`)).toBe(color);
    });
    expect(variables.get('--gt-code-keyword')).toBe(mocha.accent);
  });

  it('derives coordinated search colors that user themes can override', () => {
    const derived = derivePalette({
      background: '#1e1e2e',
      foreground: '#cdd6f4',
      cursor: '#f5e0dc'
    });
    expect(derived.searchMatch).toMatch(/^#[0-9a-f]{6}$/u);
    expect(derived.searchMatchActive).toMatch(/^#[0-9a-f]{6}$/u);
    expect(derived.searchMatch).not.toBe(derived.searchMatchActive);
    const decorations = buildSearchDecorations(derived);
    expect(decorations.matchBackground).toBe(derived.searchMatch);
    expect(decorations.activeMatchBackground).toBe(derived.searchMatchActive);
    const explicit = derivePalette({
      background: '#1e1e2e',
      foreground: '#cdd6f4',
      cursor: '#f5e0dc',
      searchMatch: '#111111',
      searchMatchActive: '#222222'
    });
    expect(explicit.searchMatch).toBe('#111111');
    expect(explicit.searchMatchActive).toBe('#222222');
  });
});
