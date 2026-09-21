import type { ContextMenuItem } from '../sftp/context-menu';
import { formatKeybinding, type KeybindingMap, type Platform } from '@geared-term/keybindings';

export type TabMenuLabels = {
  rename: string;
  duplicate: string;
  newTab: string;
  close: string;
  closeOthers: string;
  closeAll: string;
};

export type TabMenuShortcuts = {
  newTab: string;
  closeTab: string;
};

export type TabMenuActions = {
  rename: () => void;
  duplicate: () => void;
  newTab: () => void;
  close: () => void;
  closeOthers: () => void;
  closeAll: () => void;
};

/** Hint chords shown in the menu, derived from the resolved keybinding map
 *  so customized bindings are reflected (same pattern as terminalShortcutsFor). */
export function tabShortcutsFor(bindings: KeybindingMap, platform: Platform): TabMenuShortcuts {
  return {
    newTab: formatKeybinding(bindings['tab.new'], platform),
    closeTab: formatKeybinding(bindings['tab.close'], platform)
  };
}

export function buildTabContextMenu(input: {
  tabCount: number;
  labels: TabMenuLabels;
  shortcuts: TabMenuShortcuts;
  actions: TabMenuActions;
}): ContextMenuItem[] {
  const { tabCount, labels, shortcuts, actions } = input;
  return [
    { id: 'tab-menu-rename', label: labels.rename, run: actions.rename },
    { id: 'tab-menu-duplicate', label: labels.duplicate, run: actions.duplicate },
    {
      id: 'tab-menu-new-tab',
      label: labels.newTab,
      shortcut: shortcuts.newTab,
      separatorBefore: true,
      run: actions.newTab
    },
    { id: 'tab-menu-close', label: labels.close, shortcut: shortcuts.closeTab, run: actions.close },
    {
      id: 'tab-menu-close-others',
      label: labels.closeOthers,
      disabled: tabCount < 2,
      separatorBefore: true,
      run: actions.closeOthers
    },
    {
      id: 'tab-menu-close-all',
      label: labels.closeAll,
      run: actions.closeAll
    }
  ];
}
