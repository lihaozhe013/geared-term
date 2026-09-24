import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron';
import { groupThemeNames } from '@geared-term/protocol';
import {
  resolveKeybindings,
  toElectronAccelerator,
  type CommandId,
  type KeybindingMap,
  type KeybindingOverrides,
  type Platform
} from '@geared-term/keybindings';
import type { SettingsCategory } from './settings-window';

export type MenuLocale = 'en-US' | 'zh-CN';

export type MenuCommands = {
  onCommand: (command: string) => void;
  onOpenConfigFolder: () => void;
  onOpenSettings: (category?: SettingsCategory) => void;
};

export type MenuState = {
  locale: MenuLocale;
  language: 'system' | 'en-US' | 'zh-CN';
  theme: string;
  themeNames: string[];
  isDevelopment: boolean;
  keybindings: KeybindingOverrides;
};

const menuPlatform: Platform =
  process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux';

/** Resolves the Electron accelerator for a command from the persisted overrides. */
function acceleratorFor(bindings: KeybindingMap, command: CommandId): string | undefined {
  return toElectronAccelerator(bindings[command], menuPlatform) ?? undefined;
}

let activeMenuState: MenuState | undefined;
let activeMenuCommands: MenuCommands | undefined;

/**
 * Edit-role accelerators (Ctrl+C/V/X/Z/A) must not be registered with the
 * system on Windows/Linux: registered accelerators consume the keys before
 * they reach the terminal, breaking Ctrl+C interrupt (SPEC APP-019) and shell
 * control codes (SPEC APP-021). Text fields keep native Chromium editing
 * keys. The property is ignored on macOS, which keeps its native menu bar.
 */
const editRoleAccelerator = { registerAccelerator: process.platform === 'darwin' };

/**
 * Executes the allowlisted actions exposed to the renderer menu. Keeping this
 * mapping in the main process prevents renderer input from becoming an
 * arbitrary Electron command or role.
 */
export function executeApplicationMenuAction(action: string, window: BrowserWindow): void {
  const state = activeMenuState;
  const commands = activeMenuCommands;
  if (!state || !commands) throw new Error('Application menu is unavailable');

  switch (action) {
    case 'new-local':
    case 'quick-ssh':
    case 'toggle-sftp':
    case 'toggle-assistant':
    case 'toggle-environment':
    case 'cycle-panels':
    case 'tab-close':
    case 'tab-next':
    case 'tab-previous':
    case 'zoom-in':
    case 'zoom-out':
    case 'zoom-reset':
    case 'terminal-add-screen-to-chat':
    case 'terminal-open-screen-snapshot':
      commands.onCommand(action);
      return;
    case 'open-settings':
      commands.onOpenSettings();
      return;
    case 'open-config-folder':
      commands.onOpenConfigFolder();
      return;
    case 'quit':
      app.quit();
      return;
    case 'undo':
      window.webContents.undo();
      return;
    case 'redo':
      window.webContents.redo();
      return;
    case 'cut':
      window.webContents.cut();
      return;
    case 'copy':
      window.webContents.copy();
      return;
    case 'paste':
      window.webContents.paste();
      return;
    case 'select-all':
      window.webContents.selectAll();
      return;
    case 'reload':
      window.webContents.reload();
      return;
    case 'toggle-dev-tools':
      if (!state.isDevelopment) throw new Error('Developer tools are unavailable');
      window.webContents.toggleDevTools();
      return;
    case 'toggle-fullscreen':
      window.setFullScreen(!window.isFullScreen());
      return;
    case 'window-minimize':
      window.minimize();
      return;
    case 'window-zoom':
      if (window.isMaximized()) window.unmaximize();
      else window.maximize();
      return;
    case 'window-close':
      window.close();
      return;
    case 'about':
      commands.onOpenSettings('about');
      return;
  }

  if (action.startsWith('theme:')) {
    const name = action.slice('theme:'.length);
    if (!state.themeNames.includes(name)) throw new Error('Unknown theme');
    commands.onCommand(action);
    return;
  }
  if (action.startsWith('language:')) {
    const language = action.slice('language:'.length);
    if (language !== 'system' && language !== 'en-US' && language !== 'zh-CN') {
      throw new Error('Unknown language');
    }
    commands.onCommand(action);
    return;
  }

  throw new Error('Unknown application menu action');
}

const labels = {
  'en-US': {
    file: 'File',
    newLocalTerminal: 'New local terminal',
    nextTab: 'Next tab',
    previousTab: 'Previous tab',
    closeTab: 'Close tab',
    quickConnection: 'Temporary SSH connection…',
    openConfigFolder: 'Open configuration folder',
    settings: 'Settings…',
    quit: 'Quit',
    edit: 'Edit',
    undo: 'Undo',
    redo: 'Redo',
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    selectAll: 'Select all',
    view: 'View',
    terminalSnapshots: 'Terminal snapshots',
    addScreenSnapshotToAssistant: 'Add screen snapshot to AI',
    openScreenSnapshotDraft: 'Open snapshot editor',
    reload: 'Reload',
    toggleDevTools: 'Toggle developer tools',
    resetZoom: 'Reset terminal font size',
    zoomIn: 'Increase terminal font size',
    zoomOut: 'Decrease terminal font size',
    toggleFullscreen: 'Toggle full screen',
    panels: 'Panels',
    sftp: 'Files',
    assistant: 'AI assistant',
    environment: 'Environment context',
    cycleMode: 'Cycle terminal focus',
    theme: 'Theme',
    language: 'Language',
    languageSystem: 'Follow system',
    window: 'Window',
    minimize: 'Minimize',
    close: 'Close window',
    help: 'Help',
    about: 'About Geared Term',
    services: 'Services',
    hide: 'Hide Geared Term',
    hideOthers: 'Hide Others',
    unhide: 'Show All'
  },
  'zh-CN': {
    file: '文件',
    newLocalTerminal: '新建本地终端',
    nextTab: '下一个标签',
    previousTab: '上一个标签',
    closeTab: '关闭标签',
    quickConnection: '临时 SSH 连接…',
    openConfigFolder: '打开配置目录',
    settings: '设置…',
    quit: '退出',
    edit: '编辑',
    undo: '撤销',
    redo: '重做',
    cut: '剪切',
    copy: '复制',
    paste: '粘贴',
    selectAll: '全选',
    view: '视图',
    terminalSnapshots: '终端屏幕快照',
    addScreenSnapshotToAssistant: '将屏幕快照加入 AI',
    openScreenSnapshotDraft: '打开快照编辑器',
    reload: '重新加载',
    toggleDevTools: '切换开发者工具',
    resetZoom: '重置终端字号',
    zoomIn: '增大终端字号',
    zoomOut: '减小终端字号',
    toggleFullscreen: '切换全屏',
    panels: '面板',
    sftp: '文件',
    assistant: 'AI 助手',
    environment: '环境上下文',
    cycleMode: '循环终端焦点',
    theme: '主题',
    language: '语言',
    languageSystem: '跟随系统',
    window: '窗口',
    minimize: '最小化',
    close: '关闭窗口',
    help: '帮助',
    about: '关于 Geared Term',
    services: '服务',
    hide: '隐藏 Geared Term',
    hideOthers: '隐藏其他',
    unhide: '显示全部'
  }
} as const;

export function buildApplicationMenu(state: MenuState, commands: MenuCommands): void {
  activeMenuState = state;
  activeMenuCommands = commands;
  const t = labels[state.locale];
  const bindings = resolveKeybindings(state.keybindings, menuPlatform);
  const applicationMenu: MenuItemConstructorOptions[] =
    process.platform === 'darwin'
      ? [
          {
            label: 'Geared Term',
            submenu: [
              { label: t.about, click: () => commands.onOpenSettings('about') },
              { type: 'separator' },
              { role: 'services', label: t.services },
              { type: 'separator' },
              { role: 'hide', label: t.hide },
              { role: 'hideOthers', label: t.hideOthers },
              { role: 'unhide', label: t.unhide },
              { type: 'separator' },
              { role: 'quit', label: t.quit }
            ]
          }
        ]
      : [];
  const template: MenuItemConstructorOptions[] = [
    ...applicationMenu,
    {
      label: t.file,
      submenu: [
        {
          id: 'new-local',
          label: t.newLocalTerminal,
          accelerator: acceleratorFor(bindings, 'tab.new'),
          click: () => commands.onCommand('new-local')
        },
        {
          id: 'tab-next',
          label: t.nextTab,
          accelerator: acceleratorFor(bindings, 'tab.next'),
          click: () => commands.onCommand('tab-next')
        },
        {
          id: 'tab-previous',
          label: t.previousTab,
          accelerator: acceleratorFor(bindings, 'tab.previous'),
          click: () => commands.onCommand('tab-previous')
        },
        {
          id: 'tab-close',
          label: t.closeTab,
          accelerator: acceleratorFor(bindings, 'tab.close'),
          click: () => commands.onCommand('tab-close')
        },
        { id: 'quick-ssh', label: t.quickConnection, click: () => commands.onCommand('quick-ssh') },
        { type: 'separator' },
        {
          label: t.settings,
          accelerator: acceleratorFor(bindings, 'app.settings'),
          click: () => commands.onOpenSettings()
        },
        { label: t.openConfigFolder, click: commands.onOpenConfigFolder },
        ...(process.platform === 'darwin'
          ? []
          : [{ type: 'separator' as const }, { role: 'quit' as const, label: t.quit }])
      ]
    },
    {
      label: t.edit,
      submenu: [
        { role: 'undo', label: t.undo, ...editRoleAccelerator },
        { role: 'redo', label: t.redo, ...editRoleAccelerator },
        { type: 'separator' },
        { role: 'cut', label: t.cut, ...editRoleAccelerator },
        { role: 'copy', label: t.copy, ...editRoleAccelerator },
        { role: 'paste', label: t.paste, ...editRoleAccelerator },
        { role: 'selectAll', label: t.selectAll, ...editRoleAccelerator }
      ]
    },
    {
      label: t.view,
      submenu: [
        { role: 'reload', label: t.reload },
        ...(state.isDevelopment
          ? [{ role: 'toggleDevTools' as const, label: t.toggleDevTools }]
          : []),
        { type: 'separator' },
        {
          label: t.resetZoom,
          accelerator: acceleratorFor(bindings, 'terminal.zoomReset'),
          click: () => commands.onCommand('zoom-reset')
        },
        {
          label: t.zoomIn,
          accelerator: acceleratorFor(bindings, 'terminal.zoomIn'),
          click: () => commands.onCommand('zoom-in')
        },
        {
          label: t.zoomOut,
          accelerator: acceleratorFor(bindings, 'terminal.zoomOut'),
          click: () => commands.onCommand('zoom-out')
        },
        { type: 'separator' },
        { role: 'togglefullscreen', label: t.toggleFullscreen },
        {
          label: t.terminalSnapshots,
          submenu: [
            {
              label: t.addScreenSnapshotToAssistant,
              click: () => commands.onCommand('terminal-add-screen-to-chat')
            },
            {
              label: t.openScreenSnapshotDraft,
              click: () => commands.onCommand('terminal-open-screen-snapshot')
            }
          ]
        },
        {
          label: t.panels,
          submenu: [
            { label: t.sftp, click: () => commands.onCommand('toggle-sftp') },
            { label: t.assistant, click: () => commands.onCommand('toggle-assistant') },
            { label: t.environment, click: () => commands.onCommand('toggle-environment') },
            { type: 'separator' },
            {
              label: t.cycleMode,
              accelerator: acceleratorFor(bindings, 'panel.cycle'),
              click: () => commands.onCommand('cycle-panels')
            }
          ]
        },
        {
          label: t.theme,
          submenu: groupThemeNames(state.themeNames, 'Custom').map((group) => ({
            label: group.label,
            submenu: group.themes.map((name) => ({
              type: 'radio' as const,
              label: name,
              checked: name === state.theme,
              click: () => commands.onCommand(`theme:${name}`)
            }))
          }))
        },
        {
          label: t.language,
          submenu: [
            {
              type: 'radio' as const,
              label: t.languageSystem,
              checked: state.language === 'system',
              click: () => commands.onCommand('language:system')
            },
            {
              type: 'radio' as const,
              label: 'English',
              checked: state.language === 'en-US',
              click: () => commands.onCommand('language:en-US')
            },
            {
              type: 'radio' as const,
              label: '简体中文',
              checked: state.language === 'zh-CN',
              click: () => commands.onCommand('language:zh-CN')
            }
          ]
        }
      ]
    },
    {
      label: t.window,
      submenu: [
        { role: 'minimize', label: t.minimize },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'close', label: t.close }
      ]
    },
    ...(process.platform === 'darwin'
      ? []
      : [
          {
            label: t.help,
            submenu: [{ label: t.about, click: () => commands.onOpenSettings('about') }]
          }
        ])
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
