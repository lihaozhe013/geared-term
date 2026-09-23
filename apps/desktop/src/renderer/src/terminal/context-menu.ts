import type { ContextMenuItem } from '../sftp/context-menu';
import { normalizeTerminalLineEndings } from '@geared-term/protocol';
import { formatKeybinding, type KeybindingMap, type Platform } from '@geared-term/keybindings';

export type TerminalMenuLabels = {
  copy: string;
  paste: string;
  selectAll: string;
  search: string;
  clear: string;
  addSelectionToChat: string;
  addScreenToChat: string;
  copyContextForWeb?: string;
  openScreenSnapshotEditor?: string;
};

export type TerminalMenuShortcuts = {
  copy: string;
  paste: string;
  selectAll: string;
  search: string;
};

export type TerminalMenuActions = {
  copy: () => void;
  paste: () => void;
  selectAll: () => void;
  search: () => void;
  clear: () => void;
  addSelectionToChat: () => void;
  addScreenToChat: () => void;
  copyContextForWeb?: () => void;
  openScreenSnapshotEditor?: () => void;
};

/** Hint chords shown in the menu, derived from the resolved keybinding map so
 *  customized bindings are reflected (SPEC 7.4 keeps the default chords). */
export function terminalShortcutsFor(
  bindings: KeybindingMap,
  platform: Platform
): TerminalMenuShortcuts {
  return {
    copy: formatKeybinding(bindings['terminal.copy'], platform),
    paste: formatKeybinding(bindings['terminal.paste'], platform),
    selectAll: formatKeybinding(bindings['terminal.selectAll'], platform),
    search: formatKeybinding(bindings['terminal.search'], platform)
  };
}

/** Shells treat CR as accept-line; pasting LF-terminated text verbatim breaks
 *  multi-line input, so line endings are normalized like mainstream terminals. */
export function toTerminalPasteText(text: string): string {
  return normalizeTerminalLineEndings(text);
}

export function buildTerminalContextMenu(input: {
  hasSelection: boolean;
  labels: TerminalMenuLabels;
  shortcuts: TerminalMenuShortcuts;
  actions: TerminalMenuActions;
}): ContextMenuItem[] {
  const { hasSelection, labels, shortcuts, actions } = input;
  const items: ContextMenuItem[] = [
    {
      id: 'terminal-menu-copy',
      label: labels.copy,
      shortcut: shortcuts.copy,
      disabled: !hasSelection,
      run: actions.copy
    },
    {
      id: 'terminal-menu-paste',
      label: labels.paste,
      shortcut: shortcuts.paste,
      run: actions.paste
    },
    {
      id: 'terminal-menu-select-all',
      label: labels.selectAll,
      shortcut: shortcuts.selectAll,
      run: actions.selectAll
    },
    {
      id: 'terminal-menu-search',
      label: labels.search,
      shortcut: shortcuts.search,
      separatorBefore: true,
      run: actions.search
    },
    {
      id: 'terminal-menu-clear',
      label: labels.clear,
      run: actions.clear
    },
    {
      id: 'terminal-menu-add-selection-to-chat',
      label: labels.addSelectionToChat,
      disabled: !hasSelection,
      separatorBefore: true,
      run: actions.addSelectionToChat
    },
    {
      id: 'terminal-menu-add-screen-to-chat',
      label: labels.addScreenToChat,
      run: actions.addScreenToChat
    }
  ];
  if (labels.copyContextForWeb && actions.copyContextForWeb) {
    items.push({
      id: 'terminal-menu-copy-context-for-web',
      label: labels.copyContextForWeb,
      run: actions.copyContextForWeb
    });
  }
  if (labels.openScreenSnapshotEditor && actions.openScreenSnapshotEditor) {
    items.push({
      id: 'terminal-menu-open-screen-snapshot-editor',
      label: labels.openScreenSnapshotEditor,
      run: actions.openScreenSnapshotEditor
    });
  }
  return items;
}
