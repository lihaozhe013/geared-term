import { Menu, type MenuItemConstructorOptions } from 'electron';

export type MenuLocale = 'en-US' | 'zh-CN';

export type MenuCommands = {
  onCommand: (command: string) => void;
  onOpenConfigFolder: () => void;
  onOpenSettings: () => void;
  onAbout: () => void;
};

export type MenuState = {
  locale: MenuLocale;
  language: 'system' | 'en-US' | 'zh-CN';
  theme: string;
  themeNames: string[];
  isDevelopment: boolean;
};

const labels = {
  'en-US': {
    file: 'File',
    newLocalTerminal: 'New local terminal',
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
    reload: 'Reload',
    toggleDevTools: 'Toggle developer tools',
    resetZoom: 'Actual size',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    toggleFullscreen: 'Toggle full screen',
    panels: 'Panels',
    sftp: 'SFTP files',
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
    about: 'About Geared Term'
  },
  'zh-CN': {
    file: '文件',
    newLocalTerminal: '新建本地终端',
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
    reload: '重新加载',
    toggleDevTools: '切换开发者工具',
    resetZoom: '实际大小',
    zoomIn: '放大',
    zoomOut: '缩小',
    toggleFullscreen: '切换全屏',
    panels: '面板',
    sftp: 'SFTP 文件',
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
    about: '关于 Geared Term'
  }
} as const;

export function buildApplicationMenu(state: MenuState, commands: MenuCommands): void {
  const t = labels[state.locale];
  const template: MenuItemConstructorOptions[] = [
    {
      label: t.file,
      submenu: [
        {
          id: 'new-local',
          label: t.newLocalTerminal,
          accelerator: 'CmdOrCtrl+T',
          click: () => commands.onCommand('new-local')
        },
        { id: 'quick-ssh', label: t.quickConnection, click: () => commands.onCommand('quick-ssh') },
        { type: 'separator' },
        { label: t.settings, accelerator: 'CmdOrCtrl+,', click: commands.onOpenSettings },
        { label: t.openConfigFolder, click: commands.onOpenConfigFolder },
        { type: 'separator' },
        { role: 'quit', label: t.quit }
      ]
    },
    {
      label: t.edit,
      submenu: [
        { role: 'undo', label: t.undo },
        { role: 'redo', label: t.redo },
        { type: 'separator' },
        { role: 'cut', label: t.cut },
        { role: 'copy', label: t.copy },
        { role: 'paste', label: t.paste },
        { role: 'selectAll', label: t.selectAll }
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
        { role: 'resetZoom', label: t.resetZoom },
        { role: 'zoomIn', label: t.zoomIn },
        { role: 'zoomOut', label: t.zoomOut },
        { type: 'separator' },
        { role: 'togglefullscreen', label: t.toggleFullscreen },
        {
          label: t.panels,
          submenu: [
            { label: t.sftp, click: () => commands.onCommand('toggle-sftp') },
            { label: t.assistant, click: () => commands.onCommand('toggle-assistant') },
            { label: t.environment, click: () => commands.onCommand('toggle-environment') },
            { type: 'separator' },
            {
              label: t.cycleMode,
              accelerator: 'F6',
              click: () => commands.onCommand('cycle-panels')
            }
          ]
        },
        {
          label: t.theme,
          submenu: state.themeNames.map((name) => ({
            type: 'radio' as const,
            label: name,
            checked: name === state.theme,
            click: () => commands.onCommand(`theme:${name}`)
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
    {
      label: t.help,
      submenu: [{ label: t.about, click: commands.onAbout }]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
