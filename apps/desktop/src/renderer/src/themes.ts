import type { ThemeColors, UserTheme } from '@geared-term/protocol';

export type Palette = {
  background: string;
  foreground: string;
  cursor: string;
  selection: string;
  accent: string;
  bright: string;
  danger: string;
  shell: string;
  panel: string;
  panelAlt: string;
  divider: string;
  border: string;
  borderStrong: string;
  inputBackground: string;
  hover: string;
  text: string;
  textDim: string;
  textMuted: string;
  ansi: string[];
};

const GEARED_DARK: Palette = {
  background: '#0d1117',
  foreground: '#d7deea',
  cursor: '#9fe6d5',
  selection: '#2d4a56',
  accent: '#5c8ea5',
  bright: '#9fe6d5',
  danger: '#f4a5a5',
  shell: '#0e1014',
  panel: '#12151c',
  panelAlt: '#151c28',
  divider: '#202a39',
  border: '#2a3140',
  borderStrong: '#344157',
  inputBackground: '#0f141c',
  hover: '#202b3c',
  text: '#e4eaf3',
  textDim: '#d8e0ee',
  textMuted: '#71809a',
  ansi: [
    '#2a3140',
    '#e06c75',
    '#98c379',
    '#e5c07b',
    '#61afef',
    '#c678dd',
    '#56b6c2',
    '#d7deea',
    '#4b5568',
    '#f07178',
    '#c3e88d',
    '#ffd580',
    '#74a8ee',
    '#b783e0',
    '#6cd1e0',
    '#ffffff'
  ]
};

const MIDNIGHT: Palette = {
  ...GEARED_DARK,
  background: '#070b12',
  foreground: '#dce7f7',
  shell: '#04070c',
  panel: '#0a0f18',
  panelAlt: '#0d1420',
  divider: '#182338',
  border: '#20304a',
  borderStrong: '#2c405f',
  inputBackground: '#060a11',
  hover: '#131f31',
  selection: '#25425c',
  accent: '#6ea3c0',
  text: '#e7eefb',
  textDim: '#c9d6ea',
  textMuted: '#67788f'
};

const LIGHT: Palette = {
  ...GEARED_DARK,
  background: '#f6f8fb',
  foreground: '#1d2633',
  cursor: '#245c69',
  selection: '#c9ddf5',
  accent: '#245c69',
  bright: '#1a7f6a',
  danger: '#b3323f',
  shell: '#e7ebf2',
  panel: '#f8fafc',
  panelAlt: '#eef1f6',
  divider: '#dbe1ea',
  border: '#c4cddb',
  borderStrong: '#aab6c8',
  inputBackground: '#ffffff',
  hover: '#e4eaf3',
  text: '#1d2633',
  textDim: '#33404f',
  textMuted: '#64748b',
  ansi: [
    '#4c4f69',
    '#d20f39',
    '#40a02b',
    '#df8e1d',
    '#1e66f5',
    '#ea76cb',
    '#179299',
    '#acb0be',
    '#6c6f85',
    '#d20f39',
    '#40a02b',
    '#df8e1d',
    '#1e66f5',
    '#ea76cb',
    '#179299',
    '#7c7f93'
  ]
};

const CATPPUCCIN_MOCHA: Palette = {
  ...GEARED_DARK,
  background: '#1e1e2e',
  foreground: '#cdd6f4',
  cursor: '#f5e0dc',
  selection: '#585b70',
  accent: '#89b4fa',
  bright: '#94e2d5',
  danger: '#f38ba8',
  shell: '#11111b',
  panel: '#181825',
  panelAlt: '#1e1e2e',
  divider: '#313244',
  border: '#45475a',
  borderStrong: '#585b70',
  inputBackground: '#11111b',
  hover: '#313244',
  text: '#cdd6f4',
  textDim: '#bac2de',
  textMuted: '#a6adc8',
  ansi: [
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
  ]
};

const CATPPUCCIN_MACCHIATO: Palette = {
  ...CATPPUCCIN_MOCHA,
  background: '#24273a',
  foreground: '#cad3f5',
  cursor: '#f4dbd6',
  selection: '#5b6078',
  accent: '#8aadf4',
  bright: '#8bd5ca',
  danger: '#ed8796',
  shell: '#181926',
  panel: '#1e2030',
  panelAlt: '#24273a',
  divider: '#363a4f',
  border: '#494d64',
  borderStrong: '#5b6078',
  inputBackground: '#181926',
  hover: '#363a4f',
  text: '#cad3f5',
  textDim: '#b8c2e0',
  textMuted: '#a5adcb',
  ansi: [
    '#494d64',
    '#ed8796',
    '#a6da95',
    '#eed49f',
    '#8aadf4',
    '#f5bde6',
    '#8bd5ca',
    '#b8c0e0',
    '#5b6078',
    '#ed8796',
    '#a6da95',
    '#eed49f',
    '#8aadf4',
    '#f5bde6',
    '#8bd5ca',
    '#a5adcb'
  ]
};

const CATPPUCCIN_FRAPPE: Palette = {
  ...CATPPUCCIN_MOCHA,
  background: '#303446',
  foreground: '#c6d0f5',
  cursor: '#f2d5cf',
  selection: '#626880',
  accent: '#8caaee',
  bright: '#81c8be',
  danger: '#e78284',
  shell: '#232634',
  panel: '#292c3c',
  panelAlt: '#303446',
  divider: '#414559',
  border: '#51576d',
  borderStrong: '#626880',
  inputBackground: '#232634',
  hover: '#414559',
  text: '#c6d0f5',
  textDim: '#b5bfe2',
  textMuted: '#a5adce',
  ansi: [
    '#51576d',
    '#e78284',
    '#a6d189',
    '#e5c890',
    '#8caaee',
    '#f4b8e4',
    '#81c8be',
    '#b5bfe2',
    '#626880',
    '#e78284',
    '#a6d189',
    '#e5c890',
    '#8caaee',
    '#f4b8e4',
    '#81c8be',
    '#a5adce'
  ]
};

const CATPPUCCIN_LATTE: Palette = {
  ...LIGHT,
  background: '#eff1f5',
  foreground: '#4c4f69',
  cursor: '#dc8a78',
  selection: '#bcc0cc',
  accent: '#1e66f5',
  bright: '#179299',
  danger: '#d20f39',
  shell: '#dce0e8',
  panel: '#e6e9ef',
  panelAlt: '#eff1f5',
  divider: '#ccd0da',
  border: '#bcc0cc',
  borderStrong: '#9ca0b0',
  inputBackground: '#ffffff',
  hover: '#dce0e8',
  text: '#4c4f69',
  textDim: '#5c5f77',
  textMuted: '#6c6f85',
  ansi: [
    '#5c5f77',
    '#d20f39',
    '#40a02b',
    '#df8e1d',
    '#1e66f5',
    '#ea76cb',
    '#179299',
    '#acb0be',
    '#6c6f85',
    '#d20f39',
    '#40a02b',
    '#df8e1d',
    '#1e66f5',
    '#ea76cb',
    '#179299',
    '#7c7f93'
  ]
};

export const builtinThemes: Record<string, Palette> = {
  'Geared Dark': GEARED_DARK,
  Midnight: MIDNIGHT,
  Light: LIGHT,
  'Catppuccin Mocha': CATPPUCCIN_MOCHA,
  'Catppuccin Macchiato': CATPPUCCIN_MACCHIATO,
  'Catppuccin Frappé': CATPPUCCIN_FRAPPE,
  'Catppuccin Latte': CATPPUCCIN_LATTE
};

export const builtinThemeNames = Object.keys(builtinThemes);

function hexToRgb(value: string): [number, number, number] {
  const hex = value.slice(1);
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16)
  ];
}

function rgbToHex(rgb: [number, number, number]): string {
  return `#${rgb
    .map((channel) =>
      Math.round(Math.min(255, Math.max(0, channel)))
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`;
}

function mix(from: string, toward: string, weight: number): string {
  const a = hexToRgb(from);
  const b = hexToRgb(toward);
  return rgbToHex([
    a[0] + (b[0] - a[0]) * weight,
    a[1] + (b[1] - a[1]) * weight,
    a[2] + (b[2] - a[2]) * weight
  ]);
}

function isDark(color: string): boolean {
  const [red, green, blue] = hexToRgb(color);
  return (red * 299 + green * 587 + blue * 114) / 1000 < 128;
}

/**
 * Fills every palette slot from a user theme's declared colors, deriving the
 * undeclared UI slots from background/foreground/accent so partial JSON files
 * still produce a coordinated theme.
 */
export function derivePalette(colors: ThemeColors): Palette {
  const dark = isDark(colors.background);
  const accent = colors.accent ?? colors.bright ?? (dark ? '#89b4fa' : '#1e66f5');
  const bright = colors.bright ?? accent;
  const neutral = dark ? '#000000' : '#ffffff';
  return {
    background: colors.background,
    foreground: colors.foreground,
    cursor: colors.cursor,
    selection: colors.selection ?? mix(colors.background, accent, dark ? 0.28 : 0.35),
    accent,
    bright,
    danger: colors.danger ?? (dark ? '#f38ba8' : '#d20f39'),
    shell: colors.shell ?? mix(colors.background, neutral, dark ? 0.45 : 0.06),
    panel: colors.panel ?? mix(colors.background, colors.foreground, 0.03),
    panelAlt: colors.panelAlt ?? mix(colors.panel ?? colors.background, colors.foreground, 0.05),
    divider: colors.divider ?? mix(colors.background, colors.foreground, dark ? 0.1 : 0.12),
    border: colors.border ?? mix(colors.background, colors.foreground, 0.16),
    borderStrong: colors.borderStrong ?? mix(colors.background, colors.foreground, 0.26),
    inputBackground: colors.inputBackground ?? mix(colors.background, neutral, dark ? 0.35 : 0),
    hover: colors.hover ?? mix(colors.background, colors.foreground, 0.1),
    text: colors.text ?? colors.foreground,
    textDim: colors.textDim ?? mix(colors.foreground, colors.background, 0.12),
    textMuted: colors.textMuted ?? mix(colors.foreground, colors.background, 0.4),
    ansi: colors.ansi ?? []
  };
}

export function resolvePalette(name: string, userThemes: UserTheme[]): Palette {
  const base = builtinThemes[name];
  const user = userThemes.find((theme) => theme.name === name);
  if (user) return derivePalette({ ...(base ? { ...base } : {}), ...user.colors } as ThemeColors);
  return base ?? (builtinThemes['Geared Dark'] as Palette);
}

const paletteCssVariables: Record<keyof Palette, string> = {
  background: '--gt-background',
  foreground: '--gt-foreground',
  cursor: '--gt-cursor',
  selection: '--gt-selection',
  accent: '--gt-accent',
  bright: '--gt-bright',
  danger: '--gt-danger',
  shell: '--gt-shell',
  panel: '--gt-panel',
  panelAlt: '--gt-panel-alt',
  divider: '--gt-divider',
  border: '--gt-border',
  borderStrong: '--gt-border-strong',
  inputBackground: '--gt-input-bg',
  hover: '--gt-hover',
  text: '--gt-text',
  textDim: '--gt-text-dim',
  textMuted: '--gt-text-muted',
  ansi: '--gt-ansi'
};

export function applyPalette(palette: Palette): void {
  const style = document.documentElement.style;
  for (const key of Object.keys(paletteCssVariables) as (keyof Palette)[]) {
    if (key === 'ansi') continue;
    style.setProperty(paletteCssVariables[key], palette[key]);
  }
  if (palette.ansi.length === 16) {
    style.setProperty('--gt-ansi-0', palette.ansi[0] as string);
  }
}

export function buildXtermTheme(palette: Palette): Record<string, unknown> {
  const theme: Record<string, unknown> = {
    background: palette.background,
    foreground: palette.foreground,
    cursor: palette.cursor,
    selectionBackground: palette.selection,
    selectionForeground: palette.foreground
  };
  if (palette.ansi.length === 16) theme.ansi = palette.ansi;
  return theme;
}
