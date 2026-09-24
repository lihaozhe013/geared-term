import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronRight } from 'lucide-react';
import { groupThemeNames, type SettingsRecord } from '@geared-term/protocol';
import {
  formatKeybinding,
  normalizePlatform,
  resolveKeybindings,
  type KeybindingMap,
  type KeybindingOverrides
} from '@geared-term/keybindings';

type MenuAction = string;

type MenuItem =
  | { kind: 'separator'; id: string }
  | {
      kind: 'action';
      id: string;
      label: string;
      action: MenuAction;
      shortcut?: string;
      checked?: boolean;
      disabled?: boolean;
    }
  | { kind: 'submenu'; id: string; label: string; items: MenuItem[] };

type MenuDefinition = { id: string; label: string; items: MenuItem[] };

type DesktopMenuBarProps = {
  language: SettingsRecord['language'];
  theme: string;
  themeNames: string[];
  isDevelopment: boolean;
  keybindings?: KeybindingOverrides;
};

type MenuLabels = {
  file: string;
  newLocal: string;
  quickConnection: string;
  openConfigFolder: string;
  settings: string;
  quit: string;
  edit: string;
  undo: string;
  redo: string;
  cut: string;
  copy: string;
  paste: string;
  selectAll: string;
  view: string;
  terminalSnapshots: string;
  addScreenSnapshotToAssistant: string;
  openScreenSnapshotDraft: string;
  reload: string;
  devTools: string;
  actualSize: string;
  zoomIn: string;
  zoomOut: string;
  fullScreen: string;
  panels: string;
  sftp: string;
  assistant: string;
  environment: string;
  cyclePanels: string;
  theme: string;
  customThemes: string;
  language: string;
  system: string;
  window: string;
  minimize: string;
  maximize: string;
  close: string;
  help: string;
  about: string;
};

const labels: Record<'en-US' | 'zh-CN', MenuLabels> = {
  'en-US': {
    file: 'File',
    newLocal: 'New local terminal',
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
    devTools: 'Toggle developer tools',
    actualSize: 'Reset terminal font size',
    zoomIn: 'Increase terminal font size',
    zoomOut: 'Decrease terminal font size',
    fullScreen: 'Toggle full screen',
    panels: 'Panels',
    sftp: 'Files',
    assistant: 'AI assistant',
    environment: 'Environment context',
    cyclePanels: 'Cycle terminal focus',
    theme: 'Theme',
    customThemes: 'Custom',
    language: 'Language',
    system: 'Follow system',
    window: 'Window',
    minimize: 'Minimize',
    maximize: 'Maximize / restore',
    close: 'Close window',
    help: 'Help',
    about: 'About Geared Term'
  },
  'zh-CN': {
    file: '文件',
    newLocal: '新建本地终端',
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
    devTools: '切换开发者工具',
    actualSize: '重置终端字号',
    zoomIn: '增大终端字号',
    zoomOut: '减小终端字号',
    fullScreen: '切换全屏',
    panels: '面板',
    sftp: '文件',
    assistant: 'AI 助手',
    environment: '环境上下文',
    cyclePanels: '循环终端焦点',
    theme: '主题',
    customThemes: 'Custom',
    language: '语言',
    system: '跟随系统',
    window: '窗口',
    minimize: '最小化',
    maximize: '最大化 / 还原',
    close: '关闭窗口',
    help: '帮助',
    about: '关于 Geared Term'
  }
};

function resolveLocale(language: SettingsRecord['language']): 'en-US' | 'zh-CN' {
  if (language !== 'system') return language;
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
}

function action(
  id: string,
  label: string,
  menuAction: string,
  options: Pick<MenuItem & { kind: 'action' }, 'shortcut' | 'checked' | 'disabled'> = {}
): MenuItem {
  return { kind: 'action', id, label, action: menuAction, ...options };
}

function separator(id: string): MenuItem {
  return { kind: 'separator', id };
}

function submenu(id: string, label: string, items: MenuItem[]): MenuItem {
  return { kind: 'submenu', id, label, items };
}

function createMenus(
  language: SettingsRecord['language'],
  theme: string,
  themeNames: string[],
  isDevelopment: boolean,
  bindings: KeybindingMap
): MenuDefinition[] {
  const t = labels[resolveLocale(language)];
  const themeGroups = groupThemeNames(themeNames, t.customThemes);
  const hint = (command: keyof KeybindingMap): string =>
    formatKeybinding(bindings[command], normalizePlatform(window.geared.platform));
  return [
    {
      id: 'file',
      label: t.file,
      items: [
        action('new-local', t.newLocal, 'new-local', { shortcut: hint('tab.new') }),
        action('quick-ssh', t.quickConnection, 'quick-ssh'),
        separator('file-divider-1'),
        action('settings', t.settings, 'open-settings', { shortcut: hint('app.settings') }),
        action('config-folder', t.openConfigFolder, 'open-config-folder'),
        separator('file-divider-2'),
        action('quit', t.quit, 'quit')
      ]
    },
    {
      id: 'edit',
      label: t.edit,
      items: [
        action('undo', t.undo, 'undo', { shortcut: 'Ctrl+Z' }),
        action('redo', t.redo, 'redo', { shortcut: 'Ctrl+Shift+Z' }),
        separator('edit-divider'),
        action('cut', t.cut, 'cut', { shortcut: 'Ctrl+X' }),
        action('copy', t.copy, 'copy', { shortcut: 'Ctrl+C' }),
        action('paste', t.paste, 'paste', { shortcut: 'Ctrl+V' }),
        action('select-all', t.selectAll, 'select-all', { shortcut: 'Ctrl+A' })
      ]
    },
    {
      id: 'view',
      label: t.view,
      items: [
        action('reload', t.reload, 'reload'),
        ...(isDevelopment ? [action('devtools', t.devTools, 'toggle-dev-tools')] : []),
        separator('view-divider-1'),
        action('actual-size', t.actualSize, 'zoom-reset', { shortcut: hint('terminal.zoomReset') }),
        action('zoom-in', t.zoomIn, 'zoom-in', { shortcut: hint('terminal.zoomIn') }),
        action('zoom-out', t.zoomOut, 'zoom-out', { shortcut: hint('terminal.zoomOut') }),
        separator('view-divider-2'),
        action('fullscreen', t.fullScreen, 'toggle-fullscreen'),
        submenu('terminal-snapshots', t.terminalSnapshots, [
          action(
            'terminal-snapshot-to-assistant',
            t.addScreenSnapshotToAssistant,
            'terminal-add-screen-to-chat'
          ),
          action(
            'terminal-snapshot-to-draft',
            t.openScreenSnapshotDraft,
            'terminal-open-screen-snapshot'
          )
        ]),
        submenu('panels', t.panels, [
          action('sftp', t.sftp, 'toggle-sftp'),
          action('assistant', t.assistant, 'toggle-assistant'),
          action('environment', t.environment, 'toggle-environment'),
          separator('panels-divider'),
          action('cycle-panels', t.cyclePanels, 'cycle-panels', { shortcut: hint('panel.cycle') })
        ]),
        submenu(
          'themes',
          t.theme,
          themeGroups.map((group) =>
            submenu(
              `theme-family-${group.id}`,
              group.label,
              group.themes.map((name) =>
                action(`theme-${name}`, name, `theme:${name}`, { checked: name === theme })
              )
            )
          )
        ),
        submenu('languages', t.language, [
          action('language-system', t.system, 'language:system', {
            checked: language === 'system'
          }),
          action('language-en', 'English', 'language:en-US', { checked: language === 'en-US' }),
          action('language-zh', '简体中文', 'language:zh-CN', { checked: language === 'zh-CN' })
        ])
      ]
    },
    {
      id: 'window',
      label: t.window,
      items: [
        action('minimize', t.minimize, 'window-minimize'),
        action('maximize', t.maximize, 'window-zoom'),
        separator('window-divider'),
        action('close', t.close, 'window-close')
      ]
    },
    {
      id: 'help',
      label: t.help,
      items: [action('about', t.about, 'about')]
    }
  ];
}

function MenuEntry({
  item,
  onAction
}: {
  item: MenuItem;
  onAction: (action: string) => void;
}): React.JSX.Element {
  const [submenuOpen, setSubmenuOpen] = useState(false);
  const [submenuFlipped, setSubmenuFlipped] = useState(false);
  const nestedPopoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!submenuOpen || !nestedPopoverRef.current) return;
    const frame = requestAnimationFrame(() => {
      const bounds = nestedPopoverRef.current?.getBoundingClientRect();
      setSubmenuFlipped(Boolean(bounds && bounds.right > window.innerWidth));
    });
    return () => cancelAnimationFrame(frame);
  }, [submenuOpen]);

  if (item.kind === 'separator') {
    return <div className="desktop-menu-separator" role="separator" />;
  }

  if (item.kind === 'submenu') {
    return (
      <div
        className="desktop-menu-submenu"
        onMouseEnter={() => setSubmenuOpen(true)}
        onMouseLeave={() => setSubmenuOpen(false)}
      >
        <button
          type="button"
          className="desktop-menu-entry"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={submenuOpen}
          onClick={() => setSubmenuOpen((current) => !current)}
        >
          <span className="desktop-menu-entry-check" />
          <span className="desktop-menu-entry-label">{item.label}</span>
          <ChevronRight size={14} aria-hidden="true" />
        </button>
        {submenuOpen ? (
          <div
            ref={nestedPopoverRef}
            className={`desktop-menu-popover desktop-menu-popover-nested${submenuFlipped ? ' desktop-menu-popover-flipped' : ''}`}
            role="menu"
          >
            {item.items.map((child) => (
              <MenuEntry key={child.id} item={child} onAction={onAction} />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <button
      type="button"
      className="desktop-menu-entry"
      role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
      aria-checked={item.checked}
      disabled={item.disabled}
      onClick={() => onAction(item.action)}
    >
      <span className="desktop-menu-entry-check">
        {item.checked ? <Check size={13} aria-hidden="true" /> : null}
      </span>
      <span className="desktop-menu-entry-label">{item.label}</span>
      {item.shortcut ? <kbd>{item.shortcut}</kbd> : null}
    </button>
  );
}

export function DesktopMenuBar({
  language,
  theme,
  themeNames,
  isDevelopment,
  keybindings
}: DesktopMenuBarProps): React.JSX.Element {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const bindings = useMemo(
    () => resolveKeybindings(keybindings, normalizePlatform(window.geared.platform)),
    [keybindings]
  );
  const menus = createMenus(language, theme, themeNames, isDevelopment, bindings);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpenMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpenMenu(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const runAction = (actionName: string): void => {
    setOpenMenu(null);
    void window.geared.executeMenuAction(actionName).catch((error: unknown) => {
      console.error('Unable to execute application menu action', error);
    });
  };

  return (
    <div className="desktop-menu" ref={rootRef} role="menubar" aria-label="Application menu">
      {menus.map((menu) => {
        const isOpen = openMenu === menu.id;
        return (
          <div className="desktop-menu-root" key={menu.id}>
            <button
              type="button"
              className={`desktop-menu-button ${isOpen ? 'active' : ''}`}
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={isOpen}
              onClick={() => setOpenMenu(isOpen ? null : menu.id)}
              onMouseEnter={() => {
                if (openMenu) setOpenMenu(menu.id);
              }}
            >
              {menu.label}
            </button>
            {isOpen ? (
              <div className="desktop-menu-popover" role="menu">
                {menu.items.map((item) => (
                  <MenuEntry key={item.id} item={item} onAction={runAction} />
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
