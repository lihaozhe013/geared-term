import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { normalizePlatform, resolveKeybindings } from '@geared-term/keybindings';
import { BUILTIN_THEME_NAMES, parseRemoteFileCommands } from '@geared-term/protocol';
import type {
  AppInfo,
  LocalTerminalRequest,
  ProfileOrderRequest,
  SessionProfileRecord,
  SshProfileTerminalRequest,
  SshTerminalRequest,
  SettingsRecord,
  TerminalPortMessage,
  UiStateRecord,
  UserTheme,
  VaultStatus,
  WslDistribution
} from '@geared-term/protocol';
import {
  Bot,
  FolderSync,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  SquareTerminal
} from 'lucide-react';
import { applyPalette, applyTypography, applyTerminalLayout, resolvePalette } from './themes';
import { translate } from './i18n';
import type { MessageKey } from './i18n';
import { AssistantPanel } from './AssistantPanel';
import { EnvironmentPanel } from './EnvironmentPanel';
import { ProfileEditor } from './ProfileEditor';
import { CreateGroupDialog } from './CreateGroupDialog';
import { QuickSshDialog } from './QuickSshDialog';
import { Sidebar } from './Sidebar';
import { SftpPanel } from './SftpPanel';
import {
  TerminalPane,
  type SftpTerminalControl,
  type TerminalSnapshotControl
} from './TerminalPane';
import { TabBar } from './terminal/tab-bar';
import { tabShortcutsFor } from './terminal/tab-context-menu';
import { filePanelMode } from './terminal/file-panel';
import { formatChatInsert } from './terminal/extract';
import {
  insertTabAfter,
  moveTabById,
  nextCopyName,
  tabDisplayLabel
} from './terminal/tab-ordering';
import { LocalFilesPanel } from './LocalFilesPanel';
import { VaultGate } from './VaultGate';
import { WindowTitleBar } from './WindowTitleBar';

type TerminalRequest = LocalTerminalRequest | SshTerminalRequest | SshProfileTerminalRequest;
type TabStatus = 'starting' | 'awaiting-user' | 'running' | 'exited' | 'failed' | 'closed';

type TerminalTab = {
  id: string;
  name: string;
  request: TerminalRequest;
  status: TabStatus;
  manualTitle?: boolean;
  dynamicTitle?: string;
  sourceProfileId?: string;
};

const defaultSettings: SettingsRecord = {
  schemaVersion: 1,
  language: 'system',
  theme: 'Catppuccin Mocha',
  terminalFontSize: 14,
  terminalLineHeight: 1.2,
  terminalPadding: 14,
  fullScreenTerminalPadding: 14,
  terminalCursor: 'bar',
  defaultTerm: 'xterm-256color',
  splitCommandPresentation: true,
  allowRiskyRun: false,
  keepRunningInBackground: false,
  terminalContextPrecedingLines: 100,
  remoteFileCommands: 'cat\nless\nvim',
  uiFontFamily: '',
  uiFontSize: 13,
  terminalFontFamily: 'Cascadia Code',
  terminalFontLigatures: true,
  terminalFontFallbacks: [],
  defaultAiConnectionId: null,
  globalAiInstructions: '',
  keybindings: {}
};

const defaultUiState: UiStateRecord = {
  schemaVersion: 1,
  maximized: false,
  sidebarCollapsed: false,
  rightPanel: null,
  rightPanelCollapsed: false,
  sidebarWidth: 240,
  rightPanelWidth: 360
};

function createLocalTab(term: LocalTerminalRequest['term'], name: string): TerminalTab {
  const id = crypto.randomUUID();
  return {
    id,
    name,
    status: 'starting',
    request: {
      sessionId: id,
      args: [],
      cols: 80,
      rows: 24,
      term
    }
  };
}

function profileToRequest(profile: SessionProfileRecord): TerminalRequest | undefined {
  const sessionId = crypto.randomUUID();
  if (profile.kind === 'local') {
    return {
      sessionId,
      shell: profile.shell,
      args: profile.args ?? [],
      cwd: profile.cwd,
      cols: 80,
      rows: 24,
      term: profile.term
    };
  }
  if (profile.kind === 'wsl' && profile.distribution) {
    const args = ['--distribution', profile.distribution];
    if (profile.user?.trim()) args.push('--user', profile.user.trim());
    args.push('--cd', profile.cwd?.trim() || '~');
    return {
      sessionId,
      shell: 'wsl.exe',
      args,
      cols: 80,
      rows: 24,
      term: profile.term
    };
  }
  if (profile.kind === 'ssh' && profile.host && profile.user && profile.secretRefs) {
    return {
      sessionId,
      profileId: profile.id,
      cols: 80,
      rows: 24
    };
  }
  return undefined;
}

function clampWidth(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function environmentTarget(
  request: TerminalRequest | undefined,
  profiles: SessionProfileRecord[]
):
  | {
      kind: 'local' | 'wsl' | 'ssh';
      targetKey: string;
      distribution?: string;
      shell?: string;
      cwd?: string;
      legacyTargetKeys?: string[];
    }
  | undefined {
  if (!request) return undefined;
  if ('host' in request) {
    return {
      kind: 'ssh',
      targetKey: `${request.username}@${request.host}:${request.port}`
    };
  }
  if ('profileId' in request) {
    const profile = profiles.find((item) => item.id === request.profileId);
    if (!profile?.host || !profile.user) return undefined;
    return {
      kind: 'ssh',
      targetKey: `${profile.user}@${profile.host}:${profile.port ?? 22}`
    };
  }
  if (request.shell?.toLowerCase().endsWith('wsl.exe')) {
    const distribution = request.args.find(
      (arg, index) =>
        request.args[index - 1] === '--distribution' || request.args[index - 1] === '-d'
    );
    if (distribution) {
      return {
        kind: 'wsl',
        targetKey: `wsl:${request.sessionId}`,
        distribution,
        shell: request.shell,
        cwd: request.cwd,
        legacyTargetKeys: [`wsl:${distribution}`]
      };
    }
  }
  return {
    kind: 'local',
    targetKey: `local:${request.sessionId}`,
    shell: request.shell,
    cwd: request.cwd,
    legacyTargetKeys: ['local']
  };
}

export function App(): React.JSX.Element {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [profiles, setProfiles] = useState<SessionProfileRecord[]>([]);
  const [profileGroups, setProfileGroups] = useState<string[]>([]);
  const [settings, setSettings] = useState<SettingsRecord>(defaultSettings);
  const [alternateScreens, setAlternateScreens] = useState<Record<string, boolean>>({});
  const [userThemes, setUserThemes] = useState<UserTheme[]>([]);
  const [uiState, setUiState] = useState<UiStateRecord>(defaultUiState);
  const [wslDistributions, setWslDistributions] = useState<WslDistribution[]>([]);
  const [wslLoading, setWslLoading] = useState(false);
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showProfileEditor, setShowProfileEditor] = useState(false);
  const [editingProfile, setEditingProfile] = useState<SessionProfileRecord | undefined>();
  const [newProfileKind, setNewProfileKind] = useState<SessionProfileRecord['kind']>('local');
  const [showGroupDialog, setShowGroupDialog] = useState(false);
  const [showQuickSsh, setShowQuickSsh] = useState(false);
  const [pendingHistoryId, setPendingHistoryId] = useState<string | null>(null);
  const [pendingChatText, setPendingChatText] = useState<string | null>(null);
  const [vaultStatus, setVaultStatus] = useState<VaultStatus | null>(null);
  const sftpControls = useRef(new Map<string, SftpTerminalControl>());
  const snapshotControls = useRef(new Map<string, TerminalSnapshotControl>());

  const t = useCallback(
    (key: MessageKey): string => translate(settings.language, key),
    [settings.language]
  );
  const ta = useCallback(
    (key: MessageKey, values: Record<string, string>): string =>
      t(key).replace(/\{(\w+)\}/gu, (_match, name: string) => values[name] ?? ''),
    [t]
  );

  const tabMenuShortcuts = useMemo(() => {
    const platform = normalizePlatform(window.geared.platform);
    return tabShortcutsFor(resolveKeybindings(settings.keybindings, platform), platform);
  }, [settings.keybindings]);

  useEffect(() => {
    void Promise.all([
      window.geared.getAppInfo(),
      window.geared.listProfiles(),
      window.geared.listProfileGroups(),
      window.geared.getUiState(),
      window.geared.getSettings()
    ])
      .then(([appInfo, savedProfiles, savedGroups, savedUiState, savedSettings]) => {
        setInfo(appInfo);
        setProfiles(savedProfiles);
        setProfileGroups(savedGroups);
        setUiState(savedUiState);
        setSettings(savedSettings);
      })
      .catch((reason: unknown) =>
        setError(
          reason instanceof Error
            ? reason.message
            : translate(defaultSettings.language, 'errReadState')
        )
      );
  }, []);

  useEffect(() => {
    void window.geared
      .getVaultStatus()
      .then(setVaultStatus)
      .catch(() => undefined);
  }, []);

  useEffect(() => window.geared.onVaultChanged(setVaultStatus), []);

  useEffect(() => {
    void window.geared
      .listUserThemes()
      .then((result) => setUserThemes(result.themes))
      .catch(() => undefined);
  }, []);

  useEffect(() => window.geared.onSettingsChanged(setSettings), []);

  useEffect(
    () =>
      window.geared.onAiHistoryContinue((id) => {
        setPendingHistoryId(id);
        setUiState((current) =>
          current.rightPanel === 'assistant'
            ? current
            : { ...current, rightPanel: 'assistant', rightPanelCollapsed: false }
        );
      }),
    []
  );

  // Same reveal-the-assistant flow as "continue in history": flip the right
  // panel open and let the pending text ride the assistant keep-alive mount.
  const handleAddToChat = useCallback((text: string): void => {
    setPendingChatText(text);
    setUiState((current) =>
      current.rightPanel === 'assistant' && !current.rightPanelCollapsed
        ? current
        : { ...current, rightPanel: 'assistant', rightPanelCollapsed: false }
    );
  }, []);

  useEffect(
    () =>
      window.geared.onTerminalSnapshotAddToAssistant(({ text }) =>
        handleAddToChat(formatChatInsert(text))
      ),
    [handleAddToChat]
  );

  const palette = useMemo(
    () => resolvePalette(settings.theme, userThemes),
    [settings.theme, userThemes]
  );
  const themeNames = useMemo(
    () => [...new Set([...BUILTIN_THEME_NAMES, ...userThemes.map((theme) => theme.name)])],
    [settings.theme, userThemes]
  );

  useEffect(() => {
    applyPalette(palette);
    applyTypography(settings.uiFontSize, settings.uiFontFamily);
    applyTerminalLayout(settings.terminalPadding, settings.fullScreenTerminalPadding);
  }, [
    palette,
    settings.uiFontFamily,
    settings.uiFontSize,
    settings.terminalPadding,
    settings.fullScreenTerminalPadding
  ]);

  const discoverWsl = useCallback(async (): Promise<void> => {
    setWslLoading(true);
    try {
      setWslDistributions(await window.geared.discoverWsl());
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('errDiscoverWsl'));
    } finally {
      setWslLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (info?.platform === 'win32') void discoverWsl();
  }, [discoverWsl, info?.platform]);

  const addLocalTab = useCallback((): void => {
    const tab = createLocalTab(settings.defaultTerm, t('localShell'));
    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.id);
    setError(null);
  }, [settings.defaultTerm, t]);

  const closeTab = useCallback((id: string): void => {
    setTabs((current) => {
      const index = current.findIndex((tab) => tab.id === id);
      const next = current.filter((tab) => tab.id !== id);
      setActiveTabId((active) => {
        if (active !== id) return active;
        return next[Math.max(0, index - 1)]?.id ?? next[0]?.id ?? null;
      });
      return next;
    });
  }, []);

  const renameTab = useCallback((id: string, name: string): void => {
    setTabs((current) =>
      current.map((tab) => (tab.id === id ? { ...tab, name, manualTitle: true } : tab))
    );
  }, []);

  const applyTabTitle = useCallback((id: string, title: string): void => {
    setTabs((current) =>
      current.map((tab) =>
        tab.id === id && tab.dynamicTitle !== title ? { ...tab, dynamicTitle: title } : tab
      )
    );
  }, []);

  const reorderTabs = useCallback(
    (draggedId: string, targetId: string, placeAfter: boolean): void => {
      setTabs((current) => moveTabById(current, draggedId, targetId, placeAfter));
    },
    []
  );

  const duplicateTab = useCallback(
    (id: string): void => {
      setTabs((current) => {
        const source = current.find((tab) => tab.id === id);
        if (!source) return current;
        const sessionId = crypto.randomUUID();
        // The copy needs a fresh sessionId: live sessions are keyed by it in
        // the main process, and reusing one would spawn over the original.
        const copy: TerminalTab = {
          id: sessionId,
          name: nextCopyName(
            current.map((tab) => tabDisplayLabel(tab, profiles)),
            tabDisplayLabel(source, profiles)
          ),
          status: 'starting',
          request: { ...source.request, sessionId }
        };
        setActiveTabId(sessionId);
        return insertTabAfter(current, copy, source.id);
      });
    },
    [profiles]
  );

  const closeOtherTabs = useCallback((id: string): void => {
    setTabs((current) => current.filter((tab) => tab.id === id));
    setActiveTabId(id);
  }, []);

  const closeAllTabs = useCallback((): void => {
    setTabs([]);
    setActiveTabId(null);
  }, []);

  const openProfile = useCallback(
    (profile: SessionProfileRecord): void => {
      const request = profileToRequest(profile);
      if (!request) {
        setError(profile.kind === 'ssh' ? t('profileNoCredential') : t('profileIncomplete'));
        return;
      }
      const tab: TerminalTab = {
        id: request.sessionId,
        name: profile.name,
        sourceProfileId: profile.id,
        request,
        status: 'starting'
      };
      setTabs((current) => [...current, tab]);
      setActiveTabId(tab.id);
      setError(null);
    },
    [t]
  );

  const toggleSidebar = useCallback((): void => {
    const next = { ...uiState, sidebarCollapsed: !uiState.sidebarCollapsed };
    setUiState(next);
    void window.geared.saveUiState(next).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : t('errSaveUiState'));
    });
  }, [uiState, t]);

  const [resizingPanel, setResizingPanel] = useState<'sidebar' | 'right' | null>(null);
  const dragRef = useRef<{ side: 'sidebar' | 'right'; startX: number; startWidth: number } | null>(
    null
  );
  const uiStateRef = useRef(uiState);
  uiStateRef.current = uiState;

  const handleResizeMove = useCallback((event: PointerEvent): void => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.side === 'sidebar') {
      const sidebarWidth = clampWidth(drag.startWidth + event.clientX - drag.startX, 170, 520);
      uiStateRef.current = { ...uiStateRef.current, sidebarWidth };
    } else {
      const rightPanelWidth = clampWidth(drag.startWidth - (event.clientX - drag.startX), 280, 760);
      uiStateRef.current = { ...uiStateRef.current, rightPanelWidth };
    }
    setUiState(uiStateRef.current);
  }, []);

  const handleResizeEnd = useCallback((): void => {
    dragRef.current = null;
    setResizingPanel(null);
    document.body.classList.remove('panel-resizing');
    window.removeEventListener('pointermove', handleResizeMove);
    window.removeEventListener('pointerup', handleResizeEnd);
    void window.geared.saveUiState(uiStateRef.current).catch(() => undefined);
  }, [handleResizeMove]);

  const beginPanelResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>, side: 'sidebar' | 'right'): void => {
      event.preventDefault();
      dragRef.current = {
        side,
        startX: event.clientX,
        startWidth:
          side === 'sidebar' ? (uiState.sidebarWidth ?? 240) : (uiState.rightPanelWidth ?? 360)
      };
      setResizingPanel(side);
      document.body.classList.add('panel-resizing');
      window.addEventListener('pointermove', handleResizeMove);
      window.addEventListener('pointerup', handleResizeEnd);
    },
    [handleResizeEnd, handleResizeMove, uiState.rightPanelWidth, uiState.sidebarWidth]
  );

  const toggleAssistant = useCallback((): void => {
    const next: UiStateRecord = {
      ...uiState,
      rightPanel: 'assistant',
      rightPanelCollapsed: uiState.rightPanel === 'assistant' && !uiState.rightPanelCollapsed
    };
    setUiState(next);
    void window.geared.saveUiState(next).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : t('errSaveUiState'));
    });
  }, [uiState, t]);

  // Once opened, the assistant panel stays mounted (hidden via CSS) so an
  // in-flight conversation and its streaming state survive panel switches.
  const [assistantKeepAlive, setAssistantKeepAlive] = useState(
    uiState.rightPanel === 'assistant' && !uiState.rightPanelCollapsed
  );
  useEffect(() => {
    if (uiState.rightPanel === 'assistant' && !uiState.rightPanelCollapsed) {
      setAssistantKeepAlive(true);
    }
  }, [uiState.rightPanel, uiState.rightPanelCollapsed]);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];

  const openNewProfile = useCallback((kind: SessionProfileRecord['kind']): void => {
    setEditingProfile(undefined);
    setNewProfileKind(kind);
    setShowProfileEditor(true);
    setError(null);
  }, []);

  const openEditProfile = useCallback((profile: SessionProfileRecord): void => {
    setEditingProfile(profile);
    setShowProfileEditor(true);
    setError(null);
  }, []);

  const deleteProfileRecord = useCallback(
    (profile: SessionProfileRecord): void => {
      void window.geared
        .deleteProfile(profile.id)
        .then(async (nextProfiles) => {
          setProfiles(nextProfiles);
          setProfileGroups(await window.geared.listProfileGroups());
        })
        .catch((reason: unknown) =>
          setError(reason instanceof Error ? reason.message : t('errDeleteSession'))
        );
    },
    [t]
  );

  const reorderSavedProfiles = useCallback(
    async (order: ProfileOrderRequest): Promise<void> => {
      try {
        setProfiles(await window.geared.reorderProfiles(order));
        setProfileGroups(await window.geared.listProfileGroups());
        setError(null);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : t('errReorderProfiles'));
      }
    },
    [t]
  );

  const saveProfileGroups = useCallback(async (name: string): Promise<void> => {
    setProfileGroups(await window.geared.createProfileGroup(name));
    setError(null);
  }, []);

  const deleteProfileGroup = useCallback(
    (name: string): void => {
      void window.geared
        .deleteProfileGroup(name)
        .then(setProfileGroups)
        .catch((reason: unknown) =>
          setError(reason instanceof Error ? reason.message : t('errDeleteGroup'))
        );
    },
    [t]
  );

  const handleProfilesSaved = useCallback(
    (nextProfiles: SessionProfileRecord[]): void => {
      setProfiles(nextProfiles);
      void window.geared
        .listProfileGroups()
        .then(setProfileGroups)
        .catch((reason: unknown) =>
          setError(reason instanceof Error ? reason.message : t('errLoadGroups'))
        );
    },
    [t]
  );

  const openWslDistribution = useCallback(
    (name: string): void => {
      if (!window.confirm(ta('confirmOpenWsl', { name }))) return;
      const request: LocalTerminalRequest = {
        sessionId: crypto.randomUUID(),
        shell: 'wsl.exe',
        args: ['--distribution', name, '--cd', '~'],
        cols: 80,
        rows: 24,
        term: settings.defaultTerm
      };
      const tab: TerminalTab = {
        id: request.sessionId,
        name,
        request,
        status: 'starting'
      };
      setTabs((current) => [...current, tab]);
      setActiveTabId(tab.id);
    },
    [settings.defaultTerm, ta]
  );

  const openQuickSsh = useCallback((request: SshTerminalRequest, name: string): void => {
    const tab: TerminalTab = { id: request.sessionId, name, request, status: 'starting' };
    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.id);
    setShowQuickSsh(false);
    setError(null);
  }, []);

  const toggleSftp = useCallback((): void => {
    if (!filePanelMode(activeTab?.request)) {
      setError(t('filesUnavailable'));
      return;
    }
    const next: UiStateRecord = {
      ...uiState,
      rightPanel: 'sftp',
      rightPanelCollapsed: uiState.rightPanel === 'sftp' && !uiState.rightPanelCollapsed
    };
    setUiState(next);
    void window.geared.saveUiState(next).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : t('errSaveUiState'));
    });
  }, [activeTab?.request, uiState, t]);

  const toggleEnvironment = useCallback((): void => {
    const target = environmentTarget(activeTab?.request, profiles);
    if (!target) {
      setError(t('envUnavailable'));
      return;
    }
    const next: UiStateRecord = {
      ...uiState,
      rightPanel: 'environment',
      rightPanelCollapsed: uiState.rightPanel === 'environment' && !uiState.rightPanelCollapsed
    };
    setUiState(next);
    void window.geared.saveUiState(next).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : t('errSaveUiState'));
    });
  }, [activeTab?.request, uiState, t]);

  const saveSettings = useCallback(
    async (nextSettings: SettingsRecord): Promise<void> => {
      try {
        setSettings(await window.geared.saveSettings(nextSettings));
        setError(null);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : t('errSaveSettings'));
        throw reason;
      }
    },
    [t]
  );

  const cycleTab = useCallback((direction: 1 | -1): void => {
    setTabs((current) => {
      if (current.length > 1) {
        setActiveTabId((active) => {
          const index = current.findIndex((tab) => tab.id === active);
          if (index === -1) return active;
          const next = (index + direction + current.length) % current.length;
          return current[next]?.id ?? active;
        });
      }
      return current;
    });
  }, []);

  const zoomFont = useCallback((delta: number | 'reset'): void => {
    const current = menuHandlers.current.settings;
    const next =
      delta === 'reset' ? 14 : Math.min(32, Math.max(8, current.terminalFontSize + delta));
    if (next === current.terminalFontSize) return;
    void menuHandlers.current
      .saveSettings({ ...current, terminalFontSize: next })
      .catch(() => undefined);
  }, []);

  const menuHandlers = useRef({
    addLocalTab,
    closeTab,
    openQuickSshDialog: (): void => setShowQuickSsh(true),
    toggleAssistant,
    toggleSftp,
    toggleEnvironment,
    cycleTab,
    zoomFont,
    tabs,
    activeTabId,
    uiState,
    setUiState,
    settings,
    saveSettings
  });
  menuHandlers.current = {
    addLocalTab,
    closeTab,
    openQuickSshDialog: (): void => setShowQuickSsh(true),
    toggleAssistant,
    toggleSftp,
    toggleEnvironment,
    cycleTab,
    zoomFont,
    tabs,
    activeTabId,
    uiState,
    setUiState,
    settings,
    saveSettings
  };

  useEffect(() => {
    return window.geared.onMenuCommand((command) => {
      const handlers = menuHandlers.current;
      if (command === 'new-local') {
        handlers.addLocalTab();
        return;
      }
      if (command === 'quick-ssh') {
        handlers.openQuickSshDialog();
        return;
      }
      if (command === 'toggle-assistant') {
        handlers.toggleAssistant();
        return;
      }
      if (command === 'toggle-sftp') {
        handlers.toggleSftp();
        return;
      }
      if (command === 'toggle-environment') {
        handlers.toggleEnvironment();
        return;
      }
      if (command === 'cycle-panels') {
        const order = ['assistant', 'sftp', 'environment'] as const;
        const index = order.indexOf(handlers.uiState.rightPanel as (typeof order)[number]);
        const next = order[(index + 1) % order.length] as 'assistant' | 'sftp' | 'environment';
        const nextState: UiStateRecord = {
          ...handlers.uiState,
          rightPanel: next,
          rightPanelCollapsed: false
        };
        handlers.setUiState(nextState);
        void window.geared.saveUiState(nextState).catch(() => undefined);
        return;
      }
      if (
        command === 'terminal-add-screen-to-chat' ||
        command === 'terminal-open-screen-snapshot'
      ) {
        const activeId = handlers.activeTabId ?? handlers.tabs[0]?.id;
        const control = activeId ? snapshotControls.current.get(activeId) : undefined;
        if (command === 'terminal-add-screen-to-chat') control?.addScreenToChat();
        else control?.openScreenSnapshotEditor();
        return;
      }
      if (command === 'tab-close') {
        const activeId = handlers.activeTabId ?? handlers.tabs[0]?.id;
        if (activeId) handlers.closeTab(activeId);
        return;
      }
      if (command === 'tab-next') {
        handlers.cycleTab(1);
        return;
      }
      if (command === 'tab-previous') {
        handlers.cycleTab(-1);
        return;
      }
      if (command === 'zoom-in') {
        handlers.zoomFont(1);
        return;
      }
      if (command === 'zoom-out') {
        handlers.zoomFont(-1);
        return;
      }
      if (command === 'zoom-reset') {
        handlers.zoomFont('reset');
        return;
      }
      if (command.startsWith('theme:')) {
        const name = command.slice(6);
        void handlers.saveSettings({ ...handlers.settings, theme: name }).catch(() => undefined);
        return;
      }
      if (command.startsWith('language:')) {
        const value = command.slice(9) as SettingsRecord['language'];
        void handlers
          .saveSettings({ ...handlers.settings, language: value })
          .catch(() => undefined);
      }
    });
  }, []);

  const handleState = useCallback(
    (tabId: string, message: TerminalPortMessage & { kind: 'state' }): void => {
      setTabs((current) =>
        current.map((tab) =>
          tab.id === tabId ? { ...tab, status: message.state as TabStatus } : tab
        )
      );
      if (message.state === 'exited') closeTab(tabId);
    },
    [closeTab]
  );

  const handleHostKeyPrompt = useCallback(
    (
      message: TerminalPortMessage & { kind: 'prompt' },
      client: Parameters<React.ComponentProps<typeof TerminalPane>['onHostKeyPrompt']>[1]
    ): void => {
      const accepted = window.confirm(
        `${message.host}:${message.port}\n\nSHA-256 fingerprint:\n${message.fingerprint}\n\n${
          message.previousFingerprint
            ? ta('hostKeyChangedFrom', { fingerprint: message.previousFingerprint })
            : t('hostNotTrusted')
        }${t('trustKeyPrompt')}`
      );
      if ('decideHostKey' in client) {
        client.decideHostKey(accepted ? 'approve' : 'reject');
      }
    },
    [t, ta]
  );

  const rightPanelOpen = Boolean(uiState.rightPanel && !uiState.rightPanelCollapsed);
  const sidebarWidth = uiState.sidebarWidth ?? 240;
  const rightPanelWidth = uiState.rightPanelWidth ?? 360;

  const activeLabel = activeTab ? tabDisplayLabel(activeTab, profiles) : undefined;

  useEffect(() => {
    document.title = activeLabel ? `${activeLabel} — Geared Term` : 'Geared Term';
  }, [activeLabel]);

  return (
    <main className="app-shell">
      <WindowTitleBar
        title="Geared Term"
        sessionLabel={activeLabel}
        platform={info?.platform}
        language={settings.language}
        theme={settings.theme}
        themeNames={themeNames}
        isDevelopment={!info?.isPackaged}
        onOpenSettings={() => void window.geared.openSettings()}
        keybindings={settings.keybindings}
      />

      <section
        className={`workspace ${uiState.sidebarCollapsed ? 'sidebar-collapsed' : ''}`}
        style={{
          gridTemplateColumns: `${uiState.sidebarCollapsed ? '40px' : `${sidebarWidth}px`} minmax(0, 1fr) ${
            rightPanelOpen ? `${rightPanelWidth}px` : '40px'
          }`
        }}
        aria-label="Workspace"
      >
        {!uiState.sidebarCollapsed ? (
          <Sidebar
            platform={info?.platform}
            language={settings.language}
            profiles={profiles}
            groupNames={profileGroups}
            wslDistributions={wslDistributions}
            wslLoading={wslLoading}
            onNewProfile={openNewProfile}
            onCreateGroup={() => {
              setError(null);
              setShowGroupDialog(true);
            }}
            onDeleteGroup={deleteProfileGroup}
            onOpenProfile={openProfile}
            onEditProfile={openEditProfile}
            onDeleteProfile={deleteProfileRecord}
            onReorderProfiles={reorderSavedProfiles}
            onOpenWslDistribution={openWslDistribution}
            onRefreshWsl={() => void discoverWsl()}
            onCollapse={toggleSidebar}
          />
        ) : (
          <aside className="sidebar collapsed-sidebar">
            <button
              type="button"
              className="icon-button"
              onClick={toggleSidebar}
              aria-label="Expand sessions sidebar"
              title="Expand sessions sidebar"
            >
              <PanelLeftOpen size={14} aria-hidden="true" />
            </button>
          </aside>
        )}

        <section className="terminal-card" aria-label="Terminal workspace">
          <TabBar
            tabs={tabs.map((tab) => ({
              id: tab.id,
              label: tabDisplayLabel(tab, profiles),
              tooltip: tab.dynamicTitle?.trim() || undefined
            }))}
            activeTabId={activeTabId}
            labels={{
              rename: t('tabRename'),
              duplicate: t('tabDuplicate'),
              newTab: t('shortcutTabNew'),
              close: t('shortcutTabClose'),
              closeOthers: t('tabCloseOthers'),
              closeAll: t('tabCloseAll')
            }}
            shortcuts={tabMenuShortcuts}
            onActivate={setActiveTabId}
            onClose={closeTab}
            onReorder={reorderTabs}
            onRename={renameTab}
            onDuplicate={duplicateTab}
            onNewTab={addLocalTab}
            onCloseOthers={closeOtherTabs}
            onCloseAll={closeAllTabs}
          />
          <div
            className="terminal-surface"
            data-active-status={activeTab?.status ?? 'none'}
            data-alternate-screen={activeTab && alternateScreens[activeTab.id] ? 'true' : 'false'}
          >
            {tabs.map((tab) => (
              <TerminalPane
                key={tab.id}
                request={tab.request}
                settings={settings}
                palette={palette}
                active={tab.id === activeTab?.id}
                onState={(message) => handleState(tab.id, message)}
                onHostKeyPrompt={handleHostKeyPrompt}
                onAlternateScreen={(value) =>
                  setAlternateScreens((current) => ({ ...current, [tab.id]: value }))
                }
                onTitleChange={(title) => applyTabTitle(tab.id, title)}
                registerSftpControl={(control) => {
                  if (control) {
                    sftpControls.current.set(tab.id, control);
                  } else {
                    sftpControls.current.delete(tab.id);
                  }
                }}
                registerSnapshotControl={(control) => {
                  if (control) {
                    snapshotControls.current.set(tab.id, control);
                  } else {
                    snapshotControls.current.delete(tab.id);
                  }
                }}
                onAddToChat={handleAddToChat}
                onError={setError}
              />
            ))}
            {tabs.length === 0 ? (
              <div className="empty-state terminal-empty">
                <svg
                  className="empty-terminal-art"
                  viewBox="0 0 72 52"
                  aria-hidden="true"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="2" y="2" width="68" height="48" rx="9" />
                  <path d="M2 15h68" />
                  <circle
                    className="art-dot"
                    cx="12"
                    cy="8.5"
                    r="1.6"
                    fill="currentColor"
                    stroke="none"
                  />
                  <circle
                    className="art-dot"
                    cx="19"
                    cy="8.5"
                    r="1.6"
                    fill="currentColor"
                    stroke="none"
                  />
                  <circle
                    className="art-dot"
                    cx="26"
                    cy="8.5"
                    r="1.6"
                    fill="currentColor"
                    stroke="none"
                  />
                  <path className="art-prompt" d="M14 23l6 6-6 6" />
                  <path className="art-prompt" d="M25 35h11" />
                  <path className="art-line" d="M14 42h30" />
                </svg>
                <p>{t('noTerminals')}</p>
                <small>{t('emptyTerminalHint')}</small>
                <button type="button" className="empty-state-action" onClick={addLocalTab}>
                  {t('shortcutTabNew')}
                </button>
              </div>
            ) : null}
            {error ? (
              <p className="terminal-line error" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        </section>
        {uiState.rightPanel ? (
          <div className={`right-panel${uiState.rightPanelCollapsed ? ' is-hidden' : ''}`}>
            <div className="right-panel-switcher" role="tablist" aria-label="Right panel">
              <button
                type="button"
                className="right-panel-pill"
                role="tab"
                aria-selected={uiState.rightPanel === 'sftp'}
                disabled={!filePanelMode(activeTab?.request)}
                title={
                  filePanelMode(activeTab?.request) ? t('filesPanelLabel') : t('filesUnavailable')
                }
                onClick={toggleSftp}
              >
                <FolderSync size={13} aria-hidden="true" /> {t('filesPanelLabel')}
              </button>
              <button
                type="button"
                className="right-panel-pill"
                role="tab"
                aria-selected={uiState.rightPanel === 'assistant'}
                onClick={toggleAssistant}
              >
                <Bot size={13} aria-hidden="true" /> {t('panelAssistant')}
              </button>
              <button
                type="button"
                className="right-panel-pill"
                role="tab"
                aria-selected={uiState.rightPanel === 'environment'}
                disabled={!environmentTarget(activeTab?.request, profiles)}
                title={
                  environmentTarget(activeTab?.request, profiles)
                    ? 'Environment context'
                    : 'Environment detection is unavailable for this session'
                }
                onClick={toggleEnvironment}
              >
                <SquareTerminal size={13} aria-hidden="true" /> {t('panelEnvironment')}
              </button>
              <span className="right-panel-spacer" />
              <button
                type="button"
                className="icon-button"
                aria-label="Collapse panel"
                title="Collapse panel"
                onClick={() => {
                  const next: UiStateRecord = { ...uiState, rightPanelCollapsed: true };
                  setUiState(next);
                  void window.geared.saveUiState(next).catch(() => undefined);
                }}
              >
                <PanelRightClose size={14} aria-hidden="true" />
              </button>
            </div>
            {assistantKeepAlive ? (
              <AssistantPanel
                hidden={uiState.rightPanel !== 'assistant'}
                targetSessionId={activeTab?.id}
                sessionLabel={activeLabel}
                language={settings.language}
                environmentTargetKey={environmentTarget(activeTab?.request, profiles)?.targetKey}
                splitCommandPresentation={settings.splitCommandPresentation}
                allowRiskyRun={settings.allowRiskyRun}
                onToggleSplitCommand={() => {
                  void saveSettings({
                    ...settings,
                    splitCommandPresentation: !settings.splitCommandPresentation
                  }).catch(() => undefined);
                }}
                pendingHistoryId={pendingHistoryId}
                onPendingHistoryConsumed={() => setPendingHistoryId(null)}
                pendingChatText={pendingChatText}
                onPendingChatTextConsumed={() => setPendingChatText(null)}
              />
            ) : null}
            {uiState.rightPanel === 'sftp' &&
            activeTab &&
            filePanelMode(activeTab.request) === 'sftp' ? (
              <SftpPanel
                sessionId={activeTab.id}
                language={settings.language}
                remoteFileCommands={parseRemoteFileCommands(settings.remoteFileCommands)}
                alternateScreen={Boolean(alternateScreens[activeTab.id])}
                probeDirectory={async () =>
                  (await sftpControls.current.get(activeTab.id)?.probeWorkingDirectory()) ?? null
                }
                onClose={toggleSftp}
              />
            ) : null}
            {uiState.rightPanel === 'sftp' &&
            activeTab &&
            filePanelMode(activeTab.request) === 'local' ? (
              <LocalFilesPanel
                sessionId={activeTab.id}
                fallbackDirectory={'cwd' in activeTab.request ? activeTab.request.cwd : undefined}
                sessionReady={
                  activeTab.status !== 'starting' && activeTab.status !== 'awaiting-user'
                }
                language={settings.language}
                onClose={toggleSftp}
              />
            ) : null}
            {uiState.rightPanel === 'sftp' && filePanelMode(activeTab?.request) === null ? (
              <div className="panel-unavailable" role="status">
                <p>{t('filesUnavailable')}</p>
              </div>
            ) : null}
            {uiState.rightPanel === 'environment' &&
            activeTab &&
            environmentTarget(activeTab.request, profiles) ? (
              <EnvironmentPanel
                target={environmentTarget(activeTab.request, profiles)!}
                language={settings.language}
                onClose={toggleEnvironment}
              />
            ) : null}
          </div>
        ) : null}
        {!uiState.rightPanel || uiState.rightPanelCollapsed ? (
          <aside className="right-rail">
            <button
              type="button"
              className="icon-button"
              aria-label="Expand panel"
              title="Expand panel"
              onClick={() => {
                const next: UiStateRecord = {
                  ...uiState,
                  rightPanel: uiState.rightPanel ?? 'assistant',
                  rightPanelCollapsed: false
                };
                setUiState(next);
                void window.geared.saveUiState(next).catch(() => undefined);
              }}
            >
              <PanelRightOpen size={14} aria-hidden="true" />
            </button>
          </aside>
        ) : null}
        {!uiState.sidebarCollapsed ? (
          <div
            className={`panel-resizer ${resizingPanel === 'sidebar' ? 'active' : ''}`}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sessions sidebar"
            style={{ left: sidebarWidth - 3 }}
            onPointerDown={(event) => beginPanelResize(event, 'sidebar')}
          />
        ) : null}
        {rightPanelOpen ? (
          <div
            className={`panel-resizer ${resizingPanel === 'right' ? 'active' : ''}`}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize right panel"
            style={{ right: rightPanelWidth - 3 }}
            onPointerDown={(event) => beginPanelResize(event, 'right')}
          />
        ) : null}
      </section>

      {showProfileEditor ? (
        <ProfileEditor
          key={editingProfile?.id ?? `new-profile-${newProfileKind}`}
          profile={editingProfile}
          initialKind={newProfileKind}
          defaultTerm={settings.defaultTerm}
          language={settings.language}
          onSaved={handleProfilesSaved}
          onError={setError}
          onClose={() => setShowProfileEditor(false)}
        />
      ) : null}

      {showGroupDialog ? (
        <CreateGroupDialog
          language={settings.language}
          onCreate={saveProfileGroups}
          onClose={() => setShowGroupDialog(false)}
        />
      ) : null}

      {showQuickSsh ? (
        <QuickSshDialog
          defaultTerm={settings.defaultTerm}
          language={settings.language}
          onConnect={openQuickSsh}
          onClose={() => setShowQuickSsh(false)}
        />
      ) : null}

      {vaultStatus && !vaultStatus.unlocked ? (
        <VaultGate
          status={vaultStatus}
          language={settings.language}
          onStatusChange={setVaultStatus}
        />
      ) : null}
    </main>
  );
}
