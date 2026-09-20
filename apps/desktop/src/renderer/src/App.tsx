import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BUILTIN_THEME_NAMES, parseRemoteFileCommands } from '@geared-term/protocol';
import type {
  AppInfo,
  LocalTerminalRequest,
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
  Lock,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  SquareTerminal
} from 'lucide-react';
import { applyPalette, applyTypography, resolvePalette } from './themes';
import { AssistantPanel } from './AssistantPanel';
import { EnvironmentPanel } from './EnvironmentPanel';
import { ProfileEditor } from './ProfileEditor';
import { QuickSshDialog } from './QuickSshDialog';
import { SftpPanel } from './SftpPanel';
import { TerminalPane, type SnapshotExtractor, type SftpTerminalControl } from './TerminalPane';
import { VaultGate } from './VaultGate';
import { WindowTitleBar } from './WindowTitleBar';

type TerminalRequest = LocalTerminalRequest | SshTerminalRequest | SshProfileTerminalRequest;
type TabStatus = 'starting' | 'awaiting-user' | 'running' | 'exited' | 'failed' | 'closed';

type TerminalTab = {
  id: string;
  name: string;
  request: TerminalRequest;
  status: TabStatus;
};

const defaultSettings: SettingsRecord = {
  schemaVersion: 1,
  language: 'system',
  theme: 'Catppuccin Mocha',
  terminalFontSize: 14,
  terminalLineHeight: 1.2,
  terminalCursor: 'bar',
  defaultTerm: 'xterm-256color',
  splitCommandPresentation: true,
  allowRiskyRun: false,
  terminalContextPrecedingLines: 100,
  remoteFileCommands: 'cat\nless\nvim',
  uiFontFamily: '',
  uiFontSize: 13,
  terminalFontFamily: 'Cascadia Code',
  terminalFontLigatures: true,
  terminalFontFallbacks: [],
  globalAiInstructions: ''
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

function createLocalTab(
  term: LocalTerminalRequest['term'] = defaultSettings.defaultTerm
): TerminalTab {
  const id = crypto.randomUUID();
  return {
    id,
    name: 'Local Shell',
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

function statusLabel(status: TabStatus): string {
  switch (status) {
    case 'awaiting-user':
      return 'Needs approval';
    case 'running':
      return 'Running';
    case 'exited':
      return 'Exited';
    case 'failed':
      return 'Failed';
    case 'closed':
      return 'Closed';
    default:
      return 'Starting';
  }
}

function clampWidth(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function supportsSftp(request: TerminalRequest | undefined): boolean {
  return Boolean(request && ('host' in request || 'profileId' in request));
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
  const [settings, setSettings] = useState<SettingsRecord>(defaultSettings);
  const [alternateScreens, setAlternateScreens] = useState<Record<string, boolean>>({});
  const [userThemes, setUserThemes] = useState<UserTheme[]>([]);
  const [uiState, setUiState] = useState<UiStateRecord>(defaultUiState);
  const [wslDistributions, setWslDistributions] = useState<WslDistribution[]>([]);
  const [wslLoading, setWslLoading] = useState(false);
  const [tabs, setTabs] = useState<TerminalTab[]>(() => [createLocalTab()]);
  const [activeTabId, setActiveTabId] = useState<string | null>(() => tabs[0]?.id ?? null);
  const [error, setError] = useState<string | null>(null);
  const [showProfileEditor, setShowProfileEditor] = useState(false);
  const [editingProfile, setEditingProfile] = useState<SessionProfileRecord | undefined>();
  const [showQuickSsh, setShowQuickSsh] = useState(false);
  const [profileMenu, setProfileMenu] = useState<{
    x: number;
    y: number;
    profile: SessionProfileRecord;
  } | null>(null);
  const [pendingHistoryId, setPendingHistoryId] = useState<string | null>(null);
  const [vaultStatus, setVaultStatus] = useState<VaultStatus | null>(null);
  const snapshotExtractors = useRef(new Map<string, SnapshotExtractor>());
  const sftpControls = useRef(new Map<string, SftpTerminalControl>());

  useEffect(() => {
    void Promise.all([
      window.geared.getAppInfo(),
      window.geared.listProfiles(),
      window.geared.getUiState(),
      window.geared.getSettings()
    ])
      .then(([appInfo, savedProfiles, savedUiState, savedSettings]) => {
        setInfo(appInfo);
        setProfiles(savedProfiles);
        setUiState(savedUiState);
        setSettings(savedSettings);
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : 'Unable to read application state')
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
    void window.geared
      .setTitleBarOverlay({ color: palette.background, symbolColor: palette.text })
      .catch(() => undefined);
    applyTypography(settings.uiFontSize, settings.uiFontFamily);
  }, [palette, settings.uiFontFamily, settings.uiFontSize]);

  const discoverWsl = useCallback(async (): Promise<void> => {
    setWslLoading(true);
    try {
      setWslDistributions(await window.geared.discoverWsl());
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to discover WSL distributions');
    } finally {
      setWslLoading(false);
    }
  }, []);

  useEffect(() => {
    if (info?.platform === 'win32') void discoverWsl();
  }, [discoverWsl, info?.platform]);

  const addLocalTab = useCallback((): void => {
    const tab = createLocalTab(settings.defaultTerm);
    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.id);
    setError(null);
  }, [settings.defaultTerm]);

  const closeTab = useCallback((id: string, options?: { force?: boolean }): void => {
    setTabs((current) => {
      if (current.length <= 1 && !options?.force) return current;
      const index = current.findIndex((tab) => tab.id === id);
      const next = current.filter((tab) => tab.id !== id);
      setActiveTabId((active) => {
        if (active !== id) return active;
        return next[Math.max(0, index - 1)]?.id ?? next[0]?.id ?? null;
      });
      return next;
    });
  }, []);

  const openProfile = useCallback((profile: SessionProfileRecord): void => {
    const request = profileToRequest(profile);
    if (!request) {
      setError(
        profile.kind === 'ssh'
          ? 'This saved SSH profile has no in-memory credential. Unlock the vault before connecting.'
          : 'This saved profile is incomplete and cannot be opened.'
      );
      return;
    }
    const tab: TerminalTab = {
      id: request.sessionId,
      name: profile.name,
      request,
      status: 'starting'
    };
    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.id);
    setError(null);
  }, []);

  const toggleSidebar = useCallback((): void => {
    const next = { ...uiState, sidebarCollapsed: !uiState.sidebarCollapsed };
    setUiState(next);
    void window.geared.saveUiState(next).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : 'Unable to save UI state');
    });
  }, [uiState]);

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
      setError(reason instanceof Error ? reason.message : 'Unable to save UI state');
    });
  }, [uiState]);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const profileGroups = Array.from(
    profiles.reduce((groups, profile) => {
      const key = profile.group?.trim() || 'Ungrouped';
      const group = groups.get(key) ?? [];
      group.push(profile);
      groups.set(key, group);
      return groups;
    }, new Map<string, SessionProfileRecord[]>())
  );

  const openNewProfile = useCallback((): void => {
    setEditingProfile(undefined);
    setShowProfileEditor(true);
    setError(null);
  }, []);

  const openEditProfile = useCallback((profile: SessionProfileRecord): void => {
    setEditingProfile(profile);
    setShowProfileEditor(true);
    setError(null);
  }, []);

  useEffect(() => {
    if (!profileMenu) return;
    const close = (): void => setProfileMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('keydown', close);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', close);
      window.removeEventListener('resize', close);
    };
  }, [profileMenu]);

  const openQuickSsh = useCallback((request: SshTerminalRequest, name: string): void => {
    const tab: TerminalTab = { id: request.sessionId, name, request, status: 'starting' };
    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.id);
    setShowQuickSsh(false);
    setError(null);
  }, []);

  const toggleSftp = useCallback((): void => {
    if (!supportsSftp(activeTab?.request)) {
      setError('SFTP is available only for an active SSH session.');
      return;
    }
    const next: UiStateRecord = {
      ...uiState,
      rightPanel: 'sftp',
      rightPanelCollapsed: uiState.rightPanel === 'sftp' && !uiState.rightPanelCollapsed
    };
    setUiState(next);
    void window.geared.saveUiState(next).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : 'Unable to save UI state');
    });
  }, [activeTab?.request, uiState]);

  const toggleEnvironment = useCallback((): void => {
    const target = environmentTarget(activeTab?.request, profiles);
    if (!target) {
      setError('Environment detection is unavailable for this session.');
      return;
    }
    const next: UiStateRecord = {
      ...uiState,
      rightPanel: 'environment',
      rightPanelCollapsed: uiState.rightPanel === 'environment' && !uiState.rightPanelCollapsed
    };
    setUiState(next);
    void window.geared.saveUiState(next).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : 'Unable to save UI state');
    });
  }, [activeTab?.request, uiState]);

  const saveSettings = useCallback(async (nextSettings: SettingsRecord): Promise<void> => {
    try {
      setSettings(await window.geared.saveSettings(nextSettings));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save settings');
      throw reason;
    }
  }, []);

  const menuHandlers = useRef({
    addLocalTab,
    openQuickSshDialog: (): void => setShowQuickSsh(true),
    toggleAssistant,
    toggleSftp,
    toggleEnvironment,
    uiState,
    setUiState,
    settings,
    saveSettings
  });
  menuHandlers.current = {
    addLocalTab,
    openQuickSshDialog: (): void => setShowQuickSsh(true),
    toggleAssistant,
    toggleSftp,
    toggleEnvironment,
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
      if (message.state === 'exited') closeTab(tabId, { force: true });
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
            ? `The host key changed from ${message.previousFingerprint}. `
            : 'This host is not trusted yet. '
        }Trust this key for this connection?`
      );
      if ('decideHostKey' in client) {
        client.decideHostKey(accepted ? 'approve' : 'reject');
      }
    },
    []
  );

  const rightPanelOpen = Boolean(uiState.rightPanel && !uiState.rightPanelCollapsed);
  const sidebarWidth = uiState.sidebarWidth ?? 240;
  const rightPanelWidth = uiState.rightPanelWidth ?? 360;

  return (
    <main className="app-shell">
      <WindowTitleBar
        title="Geared Term"
        sessionLabel={activeTab?.name}
        platform={info?.platform}
        language={settings.language}
        theme={settings.theme}
        themeNames={themeNames}
        isDevelopment={!info?.isPackaged}
        onOpenSettings={() => void window.geared.openSettings()}
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
          <aside className="sidebar">
            <div className="sidebar-heading">
              <p className="section-label">Sessions</p>
              <div className="sidebar-tools">
                <button
                  type="button"
                  className="icon-button"
                  onClick={openNewProfile}
                  aria-label="New session profile"
                >
                  +
                </button>
                <button
                  type="button"
                  className="icon-button"
                  onClick={toggleSidebar}
                  aria-label="Collapse sessions sidebar"
                  title="Collapse sessions sidebar"
                >
                  <PanelLeftClose size={14} aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="profile-list" aria-label="Saved sessions">
              {profileGroups.map(([groupName, groupProfiles]) => (
                <section className="profile-group" key={groupName} aria-label={groupName}>
                  <p className="section-label">{groupName}</p>
                  {groupProfiles.map((profile) => (
                    <button
                      type="button"
                      className="profile-button"
                      key={profile.id}
                      onClick={() => openProfile(profile)}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        setProfileMenu({
                          x: event.clientX,
                          y: event.clientY,
                          profile
                        });
                      }}
                    >
                      <small className="profile-kind">{profile.kind}</small>
                      <span>{profile.name}</span>
                    </button>
                  ))}
                </section>
              ))}
            </div>
            {info?.platform === 'win32' ? (
              <section className="wsl-section" aria-label="WSL distributions">
                <div className="sidebar-heading wsl-heading">
                  <p className="section-label">WSL distributions</p>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => void discoverWsl()}
                    aria-label="Refresh WSL distributions"
                  >
                    {wslLoading ? '…' : '↻'}
                  </button>
                </div>
                {wslDistributions.map((distribution) => (
                  <button
                    type="button"
                    className="profile-button wsl-button"
                    key={distribution.name}
                    onDoubleClick={() => {
                      if (
                        !window.confirm(
                          `Open the WSL distribution "${distribution.name}" in a new terminal?`
                        )
                      ) {
                        return;
                      }
                      const request: LocalTerminalRequest = {
                        sessionId: crypto.randomUUID(),
                        shell: 'wsl.exe',
                        args: ['--distribution', distribution.name, '--cd', '~'],
                        cols: 80,
                        rows: 24,
                        term: settings.defaultTerm
                      };
                      const tab: TerminalTab = {
                        id: request.sessionId,
                        name: distribution.name,
                        request,
                        status: 'starting'
                      };
                      setTabs((current) => [...current, tab]);
                      setActiveTabId(tab.id);
                    }}
                  >
                    <span>
                      {distribution.isDefault ? '★ ' : ''}
                      {distribution.name}
                    </span>
                    <small>
                      {distribution.state} · WSL {distribution.version ?? '?'}
                    </small>
                  </button>
                ))}
                {wslDistributions.length === 0 && !wslLoading ? (
                  <small className="muted">No distributions discovered.</small>
                ) : null}
              </section>
            ) : null}
            {profiles.length === 0 ? (
              <div className="empty-state">
                <span className="empty-icon" aria-hidden="true">
                  +
                </span>
                <p>No saved sessions</p>
                <small>Use the + button in the sidebar to keep a session profile.</small>
              </div>
            ) : null}
          </aside>
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
          <div className="tab-bar" role="tablist" aria-label="Terminal tabs">
            {tabs.map((tab) => (
              <div
                className={`terminal-tab ${tab.id === activeTab?.id ? 'active' : ''}`}
                key={tab.id}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab.id === activeTab?.id}
                  onClick={() => setActiveTabId(tab.id)}
                >
                  <span>{tab.name}</span>
                </button>
                {tabs.length > 1 ? (
                  <button
                    type="button"
                    className="tab-close"
                    onClick={() => closeTab(tab.id)}
                    aria-label={`Close ${tab.name}`}
                  >
                    ×
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          <div className="terminal-surface">
            {tabs.map((tab) => (
              <TerminalPane
                key={tab.id}
                request={tab.request}
                settings={settings}
                palette={palette}
                active={tab.id === activeTab?.id}
                onState={(message) => handleState(tab.id, message)}
                onHostKeyPrompt={handleHostKeyPrompt}
                registerSnapshot={(extractor) => {
                  if (extractor) {
                    snapshotExtractors.current.set(tab.id, extractor);
                  } else {
                    snapshotExtractors.current.delete(tab.id);
                  }
                }}
                onAlternateScreen={(value) =>
                  setAlternateScreens((current) => ({ ...current, [tab.id]: value }))
                }
                registerSftpControl={(control) => {
                  if (control) {
                    sftpControls.current.set(tab.id, control);
                  } else {
                    sftpControls.current.delete(tab.id);
                  }
                }}
              />
            ))}
            {info ? (
              <p className="terminal-line success">
                bridge: {info.name} {info.version} ({info.platform})
              </p>
            ) : null}
            {error ? (
              <p className="terminal-line error" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        </section>
        {uiState.rightPanel && !uiState.rightPanelCollapsed ? (
          <div className="right-panel">
            <div className="right-panel-switcher" role="tablist" aria-label="Right panel">
              <button
                type="button"
                className="right-panel-pill"
                role="tab"
                aria-selected={uiState.rightPanel === 'sftp'}
                disabled={!supportsSftp(activeTab?.request)}
                title={
                  supportsSftp(activeTab?.request) ? 'SFTP files' : 'SFTP requires an SSH session'
                }
                onClick={toggleSftp}
              >
                <FolderSync size={13} aria-hidden="true" /> SFTP
              </button>
              <button
                type="button"
                className="right-panel-pill"
                role="tab"
                aria-selected={uiState.rightPanel === 'assistant'}
                onClick={toggleAssistant}
              >
                <Bot size={13} aria-hidden="true" /> AI Assistant
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
                <SquareTerminal size={13} aria-hidden="true" /> Environment
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
            {uiState.rightPanel === 'assistant' ? (
              <AssistantPanel
                targetSessionId={activeTab?.id}
                sessionLabel={activeTab?.name}
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
                getSnapshot={() => {
                  const extractor = activeTab ? snapshotExtractors.current.get(activeTab.id) : null;
                  return extractor ? extractor() : null;
                }}
              />
            ) : null}
            {uiState.rightPanel === 'sftp' && activeTab && supportsSftp(activeTab.request) ? (
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
            {uiState.rightPanel === 'environment' &&
            activeTab &&
            environmentTarget(activeTab.request, profiles) ? (
              <EnvironmentPanel
                target={environmentTarget(activeTab.request, profiles)!}
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

      {profileMenu ? (
        <div
          className="sidebar-context-menu"
          role="menu"
          style={{ left: profileMenu.x, top: profileMenu.y }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              openEditProfile(profileMenu.profile);
              setProfileMenu(null);
            }}
          >
            Edit
          </button>
          <button
            type="button"
            role="menuitem"
            className="danger"
            onClick={() => {
              void window.geared
                .deleteProfile(profileMenu.profile.id)
                .then(setProfiles)
                .catch((reason: unknown) =>
                  setError(reason instanceof Error ? reason.message : 'Unable to delete session')
                );
              setProfileMenu(null);
            }}
          >
            Delete
          </button>
        </div>
      ) : null}
      {showProfileEditor ? (
        <ProfileEditor
          key={editingProfile?.id ?? 'new-profile'}
          profile={editingProfile}
          defaultTerm={settings.defaultTerm}
          onSaved={setProfiles}
          onError={setError}
          onClose={() => setShowProfileEditor(false)}
        />
      ) : null}

      {showQuickSsh ? (
        <QuickSshDialog
          defaultTerm={settings.defaultTerm}
          onConnect={openQuickSsh}
          onClose={() => setShowQuickSsh(false)}
        />
      ) : null}

      <footer className="statusbar">
        <span className="statusbar-left">
          {vaultStatus && !vaultStatus.unlocked ? <Lock size={11} aria-hidden="true" /> : null}
          {vaultStatus
            ? vaultStatus.unlocked
              ? 'Geared Term · Vault unlocked'
              : 'Geared Term · Vault locked'
            : 'Geared Term'}
        </span>
        <span className={`statusbar-state state-${activeTab?.status ?? 'closed'}`}>
          {activeTab ? statusLabel(activeTab.status) : 'Not connected'}
        </span>
      </footer>

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
