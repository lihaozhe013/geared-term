import { describe, expect, it } from 'vitest';
import { defaultKeybindings, resolveKeybindings } from '@geared-term/keybindings';
import {
  buildTerminalContextMenu,
  toTerminalPasteText,
  terminalShortcutsFor
} from './context-menu';

describe('terminalShortcutsFor', () => {
  it('uses shifted chords on Windows/Linux', () => {
    expect(terminalShortcutsFor(defaultKeybindings('win32'), 'win32')).toEqual({
      copy: 'Ctrl+Shift+C',
      paste: 'Ctrl+Shift+V',
      selectAll: 'Ctrl+Shift+A',
      search: 'Ctrl+F'
    });
  });

  it('uses Cmd chords on macOS', () => {
    expect(terminalShortcutsFor(defaultKeybindings('darwin'), 'darwin')).toEqual({
      copy: '⌘C',
      paste: '⌘V',
      selectAll: '⌘A',
      search: '⌘F'
    });
  });

  it('reflects customized bindings', () => {
    const bindings = resolveKeybindings({ 'terminal.copy': 'ctrl+alt+c' }, 'win32');
    expect(terminalShortcutsFor(bindings, 'win32').copy).toBe('Ctrl+Alt+C');
  });
});

describe('toTerminalPasteText', () => {
  it('normalizes LF and CRLF to CR', () => {
    expect(toTerminalPasteText('a\nb\r\nc')).toBe('a\rb\rc');
  });

  it('keeps lone carriage returns untouched', () => {
    expect(toTerminalPasteText('a\rb')).toBe('a\rb');
  });
});

describe('buildTerminalContextMenu', () => {
  const labels = {
    copy: 'Copy',
    paste: 'Paste',
    selectAll: 'Select all',
    search: 'Search',
    clear: 'Clear',
    addSelectionToChat: 'Add selection to chat',
    addScreenToChat: 'Add screen snapshot to chat'
  };
  const shortcuts = terminalShortcutsFor(defaultKeybindings('win32'), 'win32');
  const actions = {
    copy: () => undefined,
    paste: () => undefined,
    selectAll: () => undefined,
    search: () => undefined,
    clear: () => undefined,
    addSelectionToChat: () => undefined,
    addScreenToChat: () => undefined
  };

  it('enables copy only when a selection exists', () => {
    const withSelection = buildTerminalContextMenu({
      hasSelection: true,
      labels,
      shortcuts,
      actions
    });
    expect(withSelection.find((item) => item.id === 'terminal-menu-copy')?.disabled).toBe(false);

    const withoutSelection = buildTerminalContextMenu({
      hasSelection: false,
      labels,
      shortcuts,
      actions
    });
    expect(withoutSelection.find((item) => item.id === 'terminal-menu-copy')?.disabled).toBe(true);
  });

  it('gates the chat selection item but keeps the screen snapshot item available', () => {
    const withoutSelection = buildTerminalContextMenu({
      hasSelection: false,
      labels,
      shortcuts,
      actions
    });
    expect(
      withoutSelection.find((item) => item.id === 'terminal-menu-add-selection-to-chat')?.disabled
    ).toBe(true);
    expect(
      withoutSelection.find((item) => item.id === 'terminal-menu-add-screen-to-chat')?.disabled
    ).toBeUndefined();

    const withSelection = buildTerminalContextMenu({
      hasSelection: true,
      labels,
      shortcuts,
      actions
    });
    expect(
      withSelection.find((item) => item.id === 'terminal-menu-add-selection-to-chat')?.disabled
    ).toBe(false);
  });

  it('orders actions and separates the utility group', () => {
    const items = buildTerminalContextMenu({ hasSelection: false, labels, shortcuts, actions });
    expect(items.map((item) => item.id)).toEqual([
      'terminal-menu-copy',
      'terminal-menu-paste',
      'terminal-menu-select-all',
      'terminal-menu-search',
      'terminal-menu-clear',
      'terminal-menu-add-selection-to-chat',
      'terminal-menu-add-screen-to-chat'
    ]);
    expect(items.find((item) => item.id === 'terminal-menu-search')?.separatorBefore).toBe(true);
    expect(
      items.find((item) => item.id === 'terminal-menu-add-selection-to-chat')?.separatorBefore
    ).toBe(true);
    expect(
      items.find((item) => item.id === 'terminal-menu-add-screen-to-chat')?.separatorBefore
    ).toBeUndefined();
  });

  it('shows shortcut hints and keeps paste enabled without a selection', () => {
    const items = buildTerminalContextMenu({ hasSelection: false, labels, shortcuts, actions });
    expect(items.find((item) => item.id === 'terminal-menu-copy')?.shortcut).toBe('Ctrl+Shift+C');
    expect(items.find((item) => item.id === 'terminal-menu-paste')?.shortcut).toBe('Ctrl+Shift+V');
    expect(items.find((item) => item.id === 'terminal-menu-paste')?.disabled).toBeUndefined();
    expect(items.find((item) => item.id === 'terminal-menu-clear')?.shortcut).toBeUndefined();
  });
});
