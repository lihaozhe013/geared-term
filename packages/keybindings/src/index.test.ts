import { describe, expect, it } from 'vitest';
import {
  defaultKeybindings,
  findConflicts,
  formatKeybinding,
  isValidKeybindingSpec,
  matchesKeybinding,
  normalizeKeybindingSpec,
  resolveKeybindings,
  specFromEvent,
  toElectronAccelerator
} from './index';

describe('normalizeKeybindingSpec', () => {
  it('canonicalizes case and modifier aliases', () => {
    expect(normalizeKeybindingSpec('Control+Shift+C', 'linux')).toBe('ctrl+shift+c');
    expect(normalizeKeybindingSpec('Command+C', 'darwin')).toBe('cmd+c');
    expect(normalizeKeybindingSpec('Meta+Shift+P', 'darwin')).toBe('cmd+shift+p');
    expect(normalizeKeybindingSpec('CmdOrCtrl+T', 'linux')).toBe('ctrl+t');
    expect(normalizeKeybindingSpec('CmdOrCtrl+T', 'darwin')).toBe('cmd+t');
  });

  it('orders modifiers canonically and normalizes key aliases', () => {
    expect(normalizeKeybindingSpec('Shift+Ctrl+alt+C', 'win32')).toBe('ctrl+alt+shift+c');
    expect(normalizeKeybindingSpec('Ctrl+Equal', 'win32')).toBe('ctrl+=');
    expect(normalizeKeybindingSpec('Ctrl++', 'win32')).toBe(null);
    expect(normalizeKeybindingSpec('Ctrl+Plus', 'win32')).toBe('ctrl+=');
    expect(normalizeKeybindingSpec('Cmd+Comma', 'darwin')).toBe('cmd+,');
    expect(normalizeKeybindingSpec('ctrl+PgDn', 'win32')).toBe('ctrl+pagedown');
  });

  it('rejects malformed specs', () => {
    expect(normalizeKeybindingSpec('c', 'win32')).toBe(null);
    expect(normalizeKeybindingSpec('ctrl+', 'win32')).toBe(null);
    expect(normalizeKeybindingSpec('ctrl+foo', 'win32')).toBe(null);
    expect(normalizeKeybindingSpec('ctrl+shift+', 'win32')).toBe(null);
  });
});

describe('isValidKeybindingSpec', () => {
  it('requires a non-shift modifier or a function key', () => {
    expect(isValidKeybindingSpec('ctrl+c', 'win32')).toBe(true);
    expect(isValidKeybindingSpec('cmd+k', 'darwin')).toBe(true);
    expect(isValidKeybindingSpec('alt+x', 'win32')).toBe(true);
    expect(isValidKeybindingSpec('f6', 'win32')).toBe(true);
    expect(isValidKeybindingSpec('shift+a', 'win32')).toBe(false);
    expect(isValidKeybindingSpec('a', 'win32')).toBe(false);
    expect(isValidKeybindingSpec('ctrl+nope', 'win32')).toBe(false);
  });
});

describe('defaultKeybindings and resolveKeybindings', () => {
  it('uses shifted chords on Windows/Linux and Cmd chords on macOS', () => {
    expect(defaultKeybindings('win32')['terminal.copy']).toBe('ctrl+shift+c');
    expect(defaultKeybindings('darwin')['terminal.copy']).toBe('cmd+c');
    expect(defaultKeybindings('win32')['terminal.zoomIn']).toBe('ctrl+=');
    expect(defaultKeybindings('darwin')['terminal.zoomIn']).toBe('cmd+=');
  });

  it('applies valid overrides and drops unknown or invalid ones', () => {
    const resolved = resolveKeybindings(
      {
        'terminal.copy': 'ctrl+alt+c',
        'not.a.command': 'ctrl+q',
        'terminal.paste': 'x',
        'terminal.search': 'shift+g'
      },
      'linux'
    );
    expect(resolved['terminal.copy']).toBe('ctrl+alt+c');
    expect(resolved['terminal.paste']).toBe('ctrl+shift+v');
    expect(resolved['terminal.search']).toBe('ctrl+f');
  });

  it('returns defaults when overrides are missing', () => {
    expect(resolveKeybindings(undefined, 'darwin')).toEqual(defaultKeybindings('darwin'));
  });
});

describe('matchesKeybinding', () => {
  const press = (
    key: string,
    mods: Partial<{ ctrl: boolean; meta: boolean; alt: boolean; shift: boolean }> = {}
  ) => ({
    key,
    ctrlKey: mods.ctrl ?? false,
    metaKey: mods.meta ?? false,
    altKey: mods.alt ?? false,
    shiftKey: mods.shift ?? false
  });

  it('matches exact modifier combinations', () => {
    expect(
      matchesKeybinding(press('c', { ctrl: true, shift: true }), 'ctrl+shift+c', 'win32')
    ).toBe(true);
    expect(matchesKeybinding(press('c', { ctrl: true }), 'ctrl+shift+c', 'win32')).toBe(false);
    expect(
      matchesKeybinding(press('c', { ctrl: true, shift: true, alt: true }), 'ctrl+shift+c', 'win32')
    ).toBe(false);
    expect(matchesKeybinding(press('c', { meta: true }), 'cmd+c', 'darwin')).toBe(true);
  });

  it('matches punctuation and shifted keys case-insensitively', () => {
    expect(matchesKeybinding(press('=', { ctrl: true }), 'ctrl+=', 'win32')).toBe(true);
    expect(matchesKeybinding(press('+', { ctrl: true, shift: true }), 'ctrl+=', 'win32')).toBe(
      true
    );
    expect(matchesKeybinding(press('T', { ctrl: true }), 'ctrl+t', 'win32')).toBe(true);
    expect(matchesKeybinding(press('-', { ctrl: true }), 'ctrl+-', 'win32')).toBe(true);
  });
});

describe('specFromEvent', () => {
  it('derives specs from key events and rejects modifier-only presses', () => {
    expect(
      specFromEvent({ key: 'c', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true })
    ).toBe('ctrl+shift+c');
    expect(
      specFromEvent({ key: '=', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })
    ).toBe('ctrl+=');
    expect(
      specFromEvent({ key: '+', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true })
    ).toBe('ctrl+shift+=');
    expect(
      specFromEvent({ key: 'Shift', ctrlKey: false, metaKey: false, altKey: false, shiftKey: true })
    ).toBe(null);
    expect(
      specFromEvent({ key: 'Dead', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })
    ).toBe(null);
  });
});

describe('findConflicts', () => {
  it('reports specs bound to multiple commands', () => {
    const resolved = resolveKeybindings({ 'terminal.clear': 'ctrl+shift+k' }, 'win32');
    expect(findConflicts(resolved).size).toBe(0);
    const conflicted = resolveKeybindings({ 'tab.close': 'ctrl+shift+k' }, 'win32');
    const conflicts = findConflicts(conflicted);
    expect(conflicts.get('ctrl+shift+k')).toEqual(['terminal.clear', 'tab.close']);
  });
});

describe('formatKeybinding', () => {
  it('formats for display per platform', () => {
    expect(formatKeybinding('ctrl+shift+c', 'win32')).toBe('Ctrl+Shift+C');
    expect(formatKeybinding('cmd+c', 'darwin')).toBe('⌘C');
    expect(formatKeybinding('cmd+shift+w', 'darwin')).toBe('⌘⇧W');
    expect(formatKeybinding('ctrl+tab', 'linux')).toBe('Ctrl+Tab');
    expect(formatKeybinding('f6', 'win32')).toBe('F6');
    expect(formatKeybinding('ctrl+,', 'win32')).toBe('Ctrl+,');
    expect(formatKeybinding('ctrl+=', 'win32')).toBe('Ctrl+=');
    expect(formatKeybinding('garbage', 'win32')).toBe('garbage');
  });
});

describe('toElectronAccelerator', () => {
  it('converts specs to Electron accelerator strings', () => {
    expect(toElectronAccelerator('ctrl+shift+c', 'win32')).toBe('Ctrl+Shift+C');
    expect(toElectronAccelerator('cmd+shift+w', 'darwin')).toBe('Command+Shift+W');
    expect(toElectronAccelerator('ctrl+tab', 'linux')).toBe('Ctrl+Tab');
    expect(toElectronAccelerator('cmd+,', 'darwin')).toBe('Command+,');
    expect(toElectronAccelerator('ctrl+=', 'win32')).toBe('Ctrl+=');
    expect(toElectronAccelerator('f6', 'win32')).toBe('F6');
    expect(toElectronAccelerator('bogus', 'win32')).toBe(null);
  });
});
