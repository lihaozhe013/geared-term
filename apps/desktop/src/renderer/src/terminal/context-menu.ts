import type { ContextMenuItem } from '../sftp/context-menu';

export type TerminalMenuLabels = {
  copy: string;
  paste: string;
  selectAll: string;
  search: string;
  clear: string;
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
};

/** Hint chords shown in the menu; copy/paste/select-all use the shifted chord
 *  on Windows/Linux (SPEC 7.4) and the Cmd chord on macOS. */
export function terminalShortcutsFor(platform: string): TerminalMenuShortcuts {
  if (platform === 'darwin') {
    return { copy: 'Cmd+C', paste: 'Cmd+V', selectAll: 'Cmd+A', search: 'Cmd+F' };
  }
  return {
    copy: 'Ctrl+Shift+C',
    paste: 'Ctrl+Shift+V',
    selectAll: 'Ctrl+Shift+A',
    search: 'Ctrl+F'
  };
}

/** Shells treat CR as accept-line; pasting LF-terminated text verbatim breaks
 *  multi-line input, so line endings are normalized like mainstream terminals. */
export function toTerminalPasteText(text: string): string {
  return text.replace(/\r?\n/g, '\r');
}

export function buildTerminalContextMenu(input: {
  hasSelection: boolean;
  labels: TerminalMenuLabels;
  shortcuts: TerminalMenuShortcuts;
  actions: TerminalMenuActions;
}): ContextMenuItem[] {
  const { hasSelection, labels, shortcuts, actions } = input;
  return [
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
    }
  ];
}
