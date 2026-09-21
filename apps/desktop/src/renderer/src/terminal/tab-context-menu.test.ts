import { describe, expect, it } from 'vitest';
import { defaultKeybindings, resolveKeybindings } from '@geared-term/keybindings';
import { buildTabContextMenu, tabShortcutsFor } from './tab-context-menu';

const labels = {
  rename: 'Rename tab',
  duplicate: 'Duplicate tab',
  newTab: 'New local terminal',
  close: 'Close tab',
  closeOthers: 'Close other tabs'
};
const shortcuts = { newTab: 'Ctrl+T', closeTab: 'Ctrl+Shift+W' };
const actions = {
  rename: () => undefined,
  duplicate: () => undefined,
  newTab: () => undefined,
  close: () => undefined,
  closeOthers: () => undefined
};

describe('tabShortcutsFor', () => {
  it('formats the new/close chords per platform', () => {
    expect(tabShortcutsFor(defaultKeybindings('win32'), 'win32')).toEqual({
      newTab: 'Ctrl+T',
      closeTab: 'Ctrl+Shift+W'
    });
    expect(tabShortcutsFor(defaultKeybindings('darwin'), 'darwin')).toEqual({
      newTab: '⌘T',
      closeTab: '⌘⇧W'
    });
  });

  it('reflects customized bindings', () => {
    const bindings = resolveKeybindings({ 'tab.close': 'ctrl+alt+q' }, 'win32');
    expect(tabShortcutsFor(bindings, 'win32').closeTab).toBe('Ctrl+Alt+Q');
  });
});

describe('buildTabContextMenu', () => {
  it('orders items with separators between the action groups', () => {
    const items = buildTabContextMenu({ tabCount: 2, labels, shortcuts, actions });
    expect(items.map((item) => item.id)).toEqual([
      'tab-menu-rename',
      'tab-menu-duplicate',
      'tab-menu-new-tab',
      'tab-menu-close',
      'tab-menu-close-others'
    ]);
    expect(items.find((item) => item.id === 'tab-menu-new-tab')?.separatorBefore).toBe(true);
    expect(items.find((item) => item.id === 'tab-menu-close-others')?.separatorBefore).toBe(true);
    expect(items.find((item) => item.id === 'tab-menu-rename')?.separatorBefore).toBeUndefined();
  });

  it('disables close-others for a single tab and enables it otherwise', () => {
    const single = buildTabContextMenu({ tabCount: 1, labels, shortcuts, actions });
    expect(single.find((item) => item.id === 'tab-menu-close-others')?.disabled).toBe(true);

    const multiple = buildTabContextMenu({ tabCount: 3, labels, shortcuts, actions });
    expect(multiple.find((item) => item.id === 'tab-menu-close-others')?.disabled).toBe(false);
  });

  it('wires the shortcut hints onto the new/close entries', () => {
    const items = buildTabContextMenu({ tabCount: 2, labels, shortcuts, actions });
    expect(items.find((item) => item.id === 'tab-menu-new-tab')?.shortcut).toBe('Ctrl+T');
    expect(items.find((item) => item.id === 'tab-menu-close')?.shortcut).toBe('Ctrl+Shift+W');
    expect(items.find((item) => item.id === 'tab-menu-rename')?.shortcut).toBeUndefined();
  });
});
