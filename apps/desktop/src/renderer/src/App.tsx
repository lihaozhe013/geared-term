import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseRemoteFileCommands } from '@geared-term/protocol';
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
  PanelRightClose,
  PanelRightOpen,
  SquareTerminal
} from 'lucide-react';
import { applyPalette, resolvePalette } from './themes';
import { AssistantPanel } from './AssistantPanel';
import { EnvironmentPanel } from './EnvironmentPanel';
import { ProfileEditor } from './ProfileEditor';
import { QuickSshDialog } from './QuickSshDialog';
import { SftpPanel } from './SftpPanel';
import { TerminalPane, type SnapshotExtractor } from './TerminalPane';
import { VaultGate } from './VaultGate';

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
  theme: 'Geared Dark',
  terminalFontSize: 14,
  terminalLineHeight: 1.2,
  terminalCursor: 'block',
  defaultTerm: 'xterm-256color',
  splitCommandPresentation: false,
  terminalContextPrecedingLines: 100,
  remoteFileCommands: 'cat\nless\nvim',
  uiFontFamily: '',
  uiFontSize: 13,
  terminalFontFamily: 'Cascadia Code',
  terminalFontFallbacks: [],
  globalAiInstructions: ''
};

const defaultUiState: UiStateRecord = {
  schemaVersion: 1,
  maximized: false,
  sidebarCollapsed: false,
  rightPanel: null,
  rightPanelCollapsed: false,
  splitRatio: 0.7
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

function supportsSftp(request: TerminalRequest | undefined): boolean {
  return Boolean(request && ('host' in request || 'profileId' in request));
}

function environmentTarget(
  request: TerminalRequest | undefined
): { kind: 'local' | 'wsl'; targetKey: string; distribution?: string } | undefined {
  if (!request || 'host' in request || 'profileId' in request) return undefined;
  if (request.shell?.toLowerCase().endsWith('wsl.exe')) {
    const distribution = request.args.find(
      (arg, index) => request.args[index - 1] === '--distribution'
    );
    if (distribution) return { kind: 'wsl', targetKey: `wsl:${distribution}`, distribution };
  }
  return { kind: 'local', targetKey: 'local' };
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
  const [pendingHistoryId, setPendingHistoryId] = useState<string | null>(null);
  const [vaultStatus, setVaultStatus] = useState<VaultStatus | null>(null);
  const snapshotExtractors = useRef(new Map<string, SnapshotExtractor>());

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

  useEffect(() => {
    applyPalette(palette);
    const style = document.documentElement.style;
    style.setProperty('--gt-ui-font-size', `${settings.uiFontSize}px`);
    if (settings.uiFontFamily.trim()) {
      style.setProperty('--gt-ui-font-family', settings.uiFontFamily.trim());
    } else {
      style.removeProperty('--gt-ui-font-family');
    }
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

  const closeTab = useCallback((id: string): void => {
    setTabs((current) => {
      if (current.length <= 1) return current;
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

  const saveActiveProfile = useCallback(async (): Promise<void> => {
    const active = tabs.find((tab) => tab.id === activeTabId);
    if (!active || 'host' in active.request || 'profileId' in active.request) {
      setError('Use the profile editor to save SSH or WSL session settings.');
      return;
    }
    const request = active.request;
    const profile: SessionProfileRecord = {
      id: active.id,
      kind: 'local',
      name: active.name,
      term: request.term,
      shell: request.shell,
      args: request.args,
      cwd: request.cwd
    };
    try {
      setProfiles(await window.geared.saveProfile(profile));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save session');
    }
  }, [activeTabId, tabs]);

  const toggleSidebar = useCallback((): void => {
    const next = { ...uiState, sidebarCollapsed: !uiState.sidebarCollapsed };
    setUiState(next);
    void window.geared.saveUiState(next).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : 'Unable to save UI state');
    });
  }, [uiState]);

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
    const target = environmentTarget(activeTab?.request);
    if (!target) {
      setError('Environment detection is available for local and WSL sessions.');
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
    },
    []
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

  return (
    <main className="app-shell">
      <header className="titlebar">
        <span className="titlebar-app">Geared Term</span>
        <span className="titlebar-session">{activeTab?.name ?? ''}</span>
        <span className="status-pill">{activeTab ? statusLabel(activeTab.status) : 'Ready'}</span>
      </header>

      <section
        className={`workspace ${uiState.sidebarCollapsed ? 'sidebar-collapsed' : ''} ${
          uiState.rightPanel && !uiState.rightPanelCollapsed ? 'with-panel' : ''
        }`}
        aria-label="Workspace"
      >
        {!uiState.sidebarCollapsed ? (
          <aside className="sidebar">
            <div className="sidebar-heading">
              <p className="section-label">Sessions</p>
              <button
                type="button"
                className="icon-button"
                onClick={toggleSidebar}
                aria-label="Collapse sessions sidebar"
              >
                ‹
              </button>
            </div>
            <button type="button" className="primary-button" onClick={addLocalTab}>
              + New local terminal
            </button>
            <button type="button" className="secondary-button" onClick={openNewProfile}>
              + New saved profile
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setShowQuickSsh(true)}
            >
              + Temporary SSH connection
            </button>
            <div className="profile-list" aria-label="Saved sessions">
              {profileGroups.map(([groupName, groupProfiles]) => (
                <section className="profile-group" key={groupName} aria-label={groupName}>
                  <p className="section-label">{groupName}</p>
                  {groupProfiles.map((profile) => (
                    <div className="profile-row" key={profile.id}>
                      <button
                        type="button"
                        className="profile-button"
                        onClick={() => openProfile(profile)}
                      >
                        <span>{profile.name}</span>
                        <small>{profile.kind}</small>
                      </button>
                      <button
                        type="button"
                        className="icon-button danger"
                        onClick={() => {
                          void window.geared
                            .deleteProfile(profile.id)
                            .then(setProfiles)
                            .catch((reason: unknown) =>
                              setError(
                                reason instanceof Error
                                  ? reason.message
                                  : 'Unable to delete session'
                              )
                            );
                        }}
                        aria-label={`Delete ${profile.name}`}
                      >
                        ×
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => openEditProfile(profile)}
                        aria-label={`Edit ${profile.name}`}
                      >
                        ✎
                      </button>
                    </div>
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
                <small>Use “Save session” above the terminal to keep a local profile.</small>
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
            >
              ›
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
                  <small>{statusLabel(tab.status)}</small>
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
          <div className="terminal-toolbar">
            <span>{activeTab?.name ?? 'Terminal'}</span>
            <button
              type="button"
              className="toolbar-button"
              onClick={() => void saveActiveProfile()}
            >
              Save session
            </button>
            <button
              type="button"
              className="toolbar-button"
              onClick={() => void window.geared.openSettings()}
            >
              Settings
            </button>
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
                disabled={!environmentTarget(activeTab?.request)}
                title={
                  environmentTarget(activeTab?.request)
                    ? 'Environment context'
                    : 'Environment detection requires a local or WSL session'
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
                environmentTargetKey={environmentTarget(activeTab?.request)?.targetKey}
                splitCommandPresentation={settings.splitCommandPresentation}
                onToggleSplitCommand={() => {
                  void saveSettings({
                    ...settings,
                    splitCommandPresentation: !settings.splitCommandPresentation
                  }).catch(() => undefined);
                }}
                globalInstructions={settings.globalAiInstructions}
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
                remoteFileCommands={parseRemoteFileCommands(settings.remoteFileCommands)}
                alternateScreen={Boolean(alternateScreens[activeTab.id])}
                onClose={toggleSftp}
              />
            ) : null}
            {uiState.rightPanel === 'environment' &&
            activeTab &&
            environmentTarget(activeTab.request) ? (
              <EnvironmentPanel
                target={environmentTarget(activeTab.request)!}
                onClose={toggleEnvironment}
              />
            ) : null}
          </div>
        ) : null}
        {uiState.rightPanel && uiState.rightPanelCollapsed ? (
          <div className="right-panel-expand">
            <button
              type="button"
              className="right-panel-expand-button"
              aria-label="Expand panel"
              title="Expand panel"
              onClick={() => {
                const next: UiStateRecord = { ...uiState, rightPanelCollapsed: false };
                setUiState(next);
                void window.geared.saveUiState(next).catch(() => undefined);
              }}
            >
              <PanelRightOpen size={16} aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </section>

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
