import type { SettingsRecord } from '@geared-term/protocol';

export type Locale = 'en-US' | 'zh-CN';

const messages = {
  'en-US': {
    settings: 'Settings',
    close: 'Close',
    language: 'Language',
    systemLanguage: 'System default',
    english: 'English',
    chinese: '简体中文',
    theme: 'Terminal theme',
    fontSize: 'Font size',
    lineHeight: 'Line height',
    cursor: 'Cursor style',
    cursorBlock: 'Block',
    cursorUnderline: 'Underline',
    cursorBar: 'Bar',
    defaultTerm: 'Default terminal type',
    splitCommands: 'Show safe command blocks separately',
    contextLines: 'Terminal context lines for commands',
    remoteCommands: 'Remote file commands (one per line)',
    remoteCommandsHint:
      'Used by the SFTP file context menu; names are quoted and control characters rejected.',
    save: 'Save settings',
    cancel: 'Cancel',
    sessions: 'Sessions',
    newLocal: '+ New local terminal',
    saveSession: 'Save session',
    assistant: 'Assistant',
    hideAssistant: 'Hide assistant'
  },
  'zh-CN': {
    settings: '设置',
    close: '关闭',
    language: '语言',
    systemLanguage: '跟随系统',
    english: 'English',
    chinese: '简体中文',
    theme: '终端主题',
    fontSize: '字体大小',
    lineHeight: '行高',
    cursor: '光标样式',
    cursorBlock: '方块',
    cursorUnderline: '下划线',
    cursorBar: '竖线',
    defaultTerm: '默认终端类型',
    splitCommands: '将安全命令块分开展示',
    contextLines: '命令上下文行数',
    remoteCommands: '远程文件命令（每行一条）',
    remoteCommandsHint: '用于 SFTP 文件右键菜单；文件名会被安全引用，控制字符将被拒绝。',
    save: '保存设置',
    cancel: '取消',
    sessions: '会话',
    newLocal: '+ 新建本地终端',
    saveSession: '保存会话',
    assistant: '助手',
    hideAssistant: '隐藏助手'
  }
} as const;

export type MessageKey = keyof (typeof messages)['en-US'];

export function resolveLocale(language: SettingsRecord['language']): Locale {
  if (language === 'zh-CN') return 'zh-CN';
  if (language === 'en-US') return 'en-US';
  return typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh')
    ? 'zh-CN'
    : 'en-US';
}

export function translate(language: SettingsRecord['language'], key: MessageKey): string {
  return messages[resolveLocale(language)][key];
}

export function settingsLocale(language: SettingsRecord['language']): Locale {
  return resolveLocale(language);
}
