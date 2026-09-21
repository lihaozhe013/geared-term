/**
 * Shared keybinding model for Geared Term.
 *
 * A keybinding spec is a normalized lowercase string of modifier tokens in
 * fixed order (ctrl, cmd, alt, shift) followed by the main key, joined with
 * `+`, e.g. `ctrl+shift+c`. Only user overrides are persisted; defaults are
 * resolved per platform at runtime so older configs stay valid.
 */

export const KEYBINDING_COMMAND_IDS = [
  'terminal.copy',
  'terminal.paste',
  'terminal.selectAll',
  'terminal.search',
  'terminal.clear',
  'tab.new',
  'tab.close',
  'tab.next',
  'tab.previous',
  'terminal.zoomIn',
  'terminal.zoomOut',
  'terminal.zoomReset',
  'panel.cycle',
  'app.settings'
] as const;

export type CommandId = (typeof KEYBINDING_COMMAND_IDS)[number];

export type Platform = 'darwin' | 'win32' | 'linux';

/** Narrows Node/Electron `process.platform` (or arbitrary strings) to the
 *  platforms with distinct bindings; anything unrecognized behaves as Linux. */
export function normalizePlatform(value: string): Platform {
  if (value === 'darwin' || value === 'win32') return value;
  return 'linux';
}

export type KeybindingMap = Record<CommandId, string>;

/** Settings store arbitrary string keys; unknown ids and invalid specs are
 *  dropped during resolution so stale or hand-edited configs stay loadable. */
export type KeybindingOverrides = Record<string, string>;

/** Settings groups rendered in the Shortcuts preferences section. */
export const KEYBINDING_GROUPS = [
  {
    id: 'terminal',
    commands: [
      'terminal.copy',
      'terminal.paste',
      'terminal.selectAll',
      'terminal.search',
      'terminal.clear'
    ]
  },
  { id: 'tabs', commands: ['tab.new', 'tab.close', 'tab.next', 'tab.previous'] },
  {
    id: 'view',
    commands: ['terminal.zoomIn', 'terminal.zoomOut', 'terminal.zoomReset']
  },
  { id: 'app', commands: ['panel.cycle', 'app.settings'] }
] as const satisfies ReadonlyArray<{ id: string; commands: readonly CommandId[] }>;

export type KeybindingGroup = (typeof KEYBINDING_GROUPS)[number];

/** Minimal key event shape shared by DOM KeyboardEvent and test doubles. */
export type KeybindingKeyEvent = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

const MODIFIER_ORDER = ['ctrl', 'cmd', 'alt', 'shift'] as const;
type Modifier = (typeof MODIFIER_ORDER)[number];

const MODIFIER_ALIASES: Record<string, Modifier> = {
  ctrl: 'ctrl',
  control: 'ctrl',
  cmd: 'cmd',
  command: 'cmd',
  meta: 'cmd',
  cmdorctrl: 'ctrl',
  alt: 'alt',
  option: 'alt',
  opt: 'alt',
  shift: 'shift'
};

const KEY_ALIASES: Record<string, string> = {
  ' ': 'space',
  spacebar: 'space',
  esc: 'escape',
  return: 'enter',
  del: 'delete',
  pgup: 'pageup',
  pgdn: 'pagedown',
  pageup: 'pageup',
  pagedown: 'pagedown',
  arrowup: 'up',
  arrowdown: 'down',
  arrowleft: 'left',
  arrowright: 'right',
  up: 'up',
  down: 'down',
  left: 'left',
  right: 'right',
  home: 'home',
  end: 'end',
  backspace: 'backspace',
  tab: 'tab',
  enter: 'enter',
  escape: 'escape',
  insert: 'insert',
  plus: '=',
  minus: '-',
  equal: '=',
  equals: '=',
  comma: ',',
  period: '.',
  dot: '.',
  slash: '/',
  backquote: '`',
  backtick: '`',
  grave: '`',
  bracketleft: '[',
  bracketright: ']',
  semicolon: ';',
  quote: "'",
  backslash: '\\'
};

const NAMED_KEY_LABELS: Record<string, string> = {
  space: 'Space',
  escape: 'Esc',
  enter: 'Enter',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Del',
  insert: 'Ins',
  pageup: 'PgUp',
  pagedown: 'PgDn',
  home: 'Home',
  end: 'End',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→'
};

const FUNCTION_KEY_PATTERN = /^f([1-9]|1\d|2[0-4])$/;
const SINGLE_CHAR_PATTERN = /^[a-z0-9`=,./;'\-[\]\\]$/;

type ParsedSpec = { modifiers: Set<Modifier>; key: string };

function parseKeyToken(token: string): string | null {
  const lower = token.toLowerCase();
  if (FUNCTION_KEY_PATTERN.test(lower)) return lower;
  if (lower.length === 1 && SINGLE_CHAR_PATTERN.test(lower)) {
    return KEY_ALIASES[lower] ?? lower;
  }
  return KEY_ALIASES[lower] ?? null;
}

function parseSpec(spec: string, platform: Platform): ParsedSpec | null {
  const tokens = spec.split('+').map((token) => token.trim().toLowerCase());
  if (tokens.some((token) => token.length === 0)) return null;
  // Bare function keys (f6) are valid modifier-free bindings; anything else
  // must carry at least one modifier token before the key.
  if (tokens.length === 1) {
    const key = parseKeyToken(tokens[0] ?? '');
    if (!key || !FUNCTION_KEY_PATTERN.test(key)) return null;
    return { modifiers: new Set(), key };
  }
  const modifiers = new Set<Modifier>();
  const keyToken = tokens[tokens.length - 1] ?? '';
  for (const token of tokens.slice(0, -1)) {
    let modifier = MODIFIER_ALIASES[token];
    if (!modifier) return null;
    if (modifier === 'ctrl' && token === 'cmdorctrl')
      modifier = platform === 'darwin' ? 'cmd' : 'ctrl';
    modifiers.add(modifier);
  }
  const key = parseKeyToken(keyToken);
  if (!key) return null;
  return { modifiers, key };
}

/** Structural + sanity validation used to filter persisted overrides: the
 *  binding must carry at least one non-shift modifier or be a function key,
 *  otherwise a single-letter binding would swallow terminal typing. */
export function isValidKeybindingSpec(spec: string, platform: Platform): boolean {
  const parsed = parseSpec(spec, platform);
  if (!parsed) return false;
  if (FUNCTION_KEY_PATTERN.test(parsed.key)) return true;
  return parsed.modifiers.has('ctrl') || parsed.modifiers.has('cmd') || parsed.modifiers.has('alt');
}

/** Tolerant normalization of author input ("Control+Shift+C", "CmdOrCtrl+T",
 *  "Esc") into canonical spec form, resolved for the given platform. */
export function normalizeKeybindingSpec(spec: string, platform: Platform): string | null {
  const parsed = parseSpec(spec, platform);
  if (!parsed) return null;
  const modifiers = MODIFIER_ORDER.filter((modifier) => parsed.modifiers.has(modifier));
  return [...modifiers, parsed.key].join('+');
}

/** Normalizes a DOM-style key value ('=', 'Tab', '+', ' ') to spec key form. */
export function normalizeEventKey(key: string): string | null {
  if (key.length === 1) {
    const lower = key.toLowerCase();
    if (lower === '+') return '=';
    return KEY_ALIASES[lower] ?? (SINGLE_CHAR_PATTERN.test(lower) ? lower : null);
  }
  return KEY_ALIASES[key.toLowerCase()] ?? null;
}

export function defaultKeybindings(platform: Platform): KeybindingMap {
  const mod = platform === 'darwin' ? 'cmd' : 'ctrl';
  return {
    'terminal.copy': platform === 'darwin' ? 'cmd+c' : 'ctrl+shift+c',
    'terminal.paste': platform === 'darwin' ? 'cmd+v' : 'ctrl+shift+v',
    'terminal.selectAll': platform === 'darwin' ? 'cmd+a' : 'ctrl+shift+a',
    'terminal.search': `${mod}+f`,
    'terminal.clear': platform === 'darwin' ? 'cmd+k' : 'ctrl+shift+k',
    'tab.new': `${mod}+t`,
    'tab.close': `${mod}+shift+w`,
    'tab.next': 'ctrl+tab',
    'tab.previous': 'ctrl+shift+tab',
    'terminal.zoomIn': `${mod}+=`,
    'terminal.zoomOut': `${mod}+-`,
    'terminal.zoomReset': `${mod}+0`,
    'panel.cycle': 'f6',
    'app.settings': `${mod}+,`
  };
}

/** Merges persisted overrides over platform defaults, dropping unknown
 *  command ids and specs that fail validation. */
export function resolveKeybindings(
  overrides: KeybindingOverrides | undefined | null,
  platform: Platform
): KeybindingMap {
  const resolved = defaultKeybindings(platform);
  if (!overrides) return resolved;
  for (const [commandId, spec] of Object.entries(overrides)) {
    const isKnown = (KEYBINDING_COMMAND_IDS as readonly string[]).includes(commandId);
    if (!isKnown) continue;
    const normalized = normalizeKeybindingSpec(spec, platform);
    if (!normalized || !isValidKeybindingSpec(normalized, platform)) continue;
    resolved[commandId as CommandId] = normalized;
  }
  return resolved;
}

/** Exact-match comparison: a spec fires only when its modifiers and key are
 *  all pressed (extra modifiers pressed by the user invalidate the match).
 *  The one exception is the physical `+` key (Shift+= on most layouts), which
 *  still fires `=`-bindings so Ctrl+= zoom works as Ctrl+Plus too. */
export function matchesKeybinding(
  event: KeybindingKeyEvent,
  spec: string,
  platform: Platform
): boolean {
  const parsed = parseSpec(spec, platform);
  if (!parsed) return false;
  if (normalizeEventKey(event.key) !== parsed.key) return false;
  const ignoreShift = event.key === '+';
  return (
    event.ctrlKey === parsed.modifiers.has('ctrl') &&
    event.metaKey === parsed.modifiers.has('cmd') &&
    event.altKey === parsed.modifiers.has('alt') &&
    (ignoreShift || event.shiftKey === parsed.modifiers.has('shift'))
  );
}

/** Returns specs bound to more than one command after resolution. */
export function findConflicts(resolved: KeybindingMap): Map<string, CommandId[]> {
  const bySpec = new Map<string, CommandId[]>();
  for (const [commandId, spec] of Object.entries(resolved) as Array<[CommandId, string]>) {
    const commands = bySpec.get(spec);
    if (commands) commands.push(commandId);
    else bySpec.set(spec, [commandId]);
  }
  const conflicts = new Map<string, CommandId[]>();
  for (const [spec, commands] of bySpec) {
    if (commands.length > 1) conflicts.set(spec, commands);
  }
  return conflicts;
}

export function formatKeybinding(spec: string, platform: Platform): string {
  const parsed = parseSpec(spec, platform);
  if (!parsed) return spec;
  const { modifiers, key } = parsed;
  const keyLabel = FUNCTION_KEY_PATTERN.test(key)
    ? key.toUpperCase()
    : (NAMED_KEY_LABELS[key] ?? (key.length === 1 ? key.toUpperCase() : key));
  if (platform === 'darwin') {
    const symbols = { cmd: '⌘', ctrl: '⌃', alt: '⌥', shift: '⇧' } as const;
    const prefix = MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)).map(
      (modifier) => symbols[modifier]
    );
    return `${prefix.join('')}${keyLabel}`;
  }
  const names = { cmd: 'Cmd', ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift' } as const;
  const parts = MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)).map(
    (modifier) => names[modifier]
  );
  return [...parts, keyLabel].join('+');
}

/** Converts a spec to an Electron accelerator string for menu registration. */
export function toElectronAccelerator(spec: string, platform: Platform): string | null {
  const parsed = parseSpec(spec, platform);
  if (!parsed) return null;
  const names: Record<Modifier, string> = {
    cmd: 'Command',
    ctrl: 'Ctrl',
    alt: 'Alt',
    shift: 'Shift'
  };
  const modifiers = MODIFIER_ORDER.filter((modifier) => parsed.modifiers.has(modifier)).map(
    (modifier) => names[modifier]
  );
  const key = FUNCTION_KEY_PATTERN.test(parsed.key)
    ? parsed.key.toUpperCase()
    : (NAMED_KEY_LABELS[parsed.key] ?? parsed.key.toUpperCase());
  return [...modifiers, key].join('+');
}

/** Derives a spec from a key event, for the Shortcuts capture field. Returns
 *  null for modifier-only presses, dead keys, and unsupported keys. */
export function specFromEvent(event: KeybindingKeyEvent): string | null {
  const key = normalizeEventKey(event.key);
  if (!key) return null;
  const pressed: Modifier[] = [];
  if (event.ctrlKey) pressed.push('ctrl');
  if (event.metaKey) pressed.push('cmd');
  if (event.altKey) pressed.push('alt');
  if (event.shiftKey) pressed.push('shift');
  const modifiers = MODIFIER_ORDER.filter((modifier) => pressed.includes(modifier));
  return [...modifiers, key].join('+');
}
