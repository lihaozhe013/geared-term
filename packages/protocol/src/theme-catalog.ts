export const BUILTIN_THEME_GROUPS = [
  { id: 'geared', label: 'Geared', themes: ['Geared Dark', 'Midnight', 'Light'] },
  {
    id: 'catppuccin',
    label: 'Catppuccin',
    themes: ['Catppuccin Mocha', 'Catppuccin Macchiato', 'Catppuccin Frappé', 'Catppuccin Latte']
  },
  { id: 'dracula', label: 'Dracula', themes: ['Dracula'] },
  {
    id: 'tokyo-night',
    label: 'Tokyo Night',
    themes: ['Tokyo Night', 'Tokyo Night Storm', 'Tokyo Night Light']
  },
  { id: 'gruvbox', label: 'Gruvbox', themes: ['Gruvbox Dark', 'Gruvbox Light'] },
  { id: 'nord', label: 'Nord', themes: ['Nord'] },
  { id: 'solarized', label: 'Solarized', themes: ['Solarized Dark', 'Solarized Light'] },
  {
    id: 'rose-pine',
    label: 'Rosé Pine',
    themes: ['Rosé Pine', 'Rosé Pine Moon', 'Rosé Pine Dawn']
  },
  { id: 'ayu', label: 'Ayu', themes: ['Ayu Dark', 'Ayu Mirage', 'Ayu Light'] },
  { id: 'kanagawa', label: 'Kanagawa', themes: ['Kanagawa Wave', 'Kanagawa Lotus'] },
  { id: 'github', label: 'GitHub', themes: ['GitHub Dark Default', 'GitHub Light Default'] },
  { id: 'atom-one', label: 'Atom One', themes: ['Atom One Dark', 'Atom One Light'] },
  { id: 'everforest', label: 'Everforest', themes: ['Everforest Dark', 'Everforest Light'] },
  { id: 'night-owl', label: 'Night Owl', themes: ['Night Owl', 'Light Owl'] }
] as const;

export const BUILTIN_THEME_NAMES = BUILTIN_THEME_GROUPS.flatMap((group) => group.themes);

export type BuiltinThemeGroup = (typeof BUILTIN_THEME_GROUPS)[number];

export type ThemeMenuGroup = {
  id: string;
  label: string;
  themes: string[];
};

export function groupThemeNames(
  themeNames: readonly string[],
  customLabel: string
): ThemeMenuGroup[] {
  const availableNames = new Set(themeNames);
  const builtinNames = new Set<string>();
  const groups: ThemeMenuGroup[] = BUILTIN_THEME_GROUPS.map((group) => {
    const themes = [...group.themes].filter((name) => {
      builtinNames.add(name);
      return availableNames.has(name);
    });
    return { id: group.id, label: group.label, themes };
  }).filter((group) => group.themes.length > 0);
  const custom = themeNames.filter((name) => !builtinNames.has(name));
  if (custom.length > 0) groups.push({ id: 'custom', label: customLabel, themes: custom });
  return groups;
}
