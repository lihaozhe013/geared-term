import { useCallback, useEffect, useState } from 'react';
import type {
  LocalTerminalRequest,
  SessionProfileRecord,
  SshProfileTerminalRequest,
  SshTerminalRequest,
  SettingsRecord,
  TerminalPortMessage,
  UiStateRecord,
  WslDistribution
} from '@geared-term/protocol';
import { AssistantPanel } from './AssistantPanel';
import { SettingsPanel } from './SettingsPanel';
import { SftpPanel } from './SftpPanel';
import { TerminalPane } from './TerminalPane';

type AppInfo = Awaited<ReturnType<Window['geared']['getAppInfo']>>;
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
  theme: 'Augur Dark+',
  terminalFontSize: 14,
  terminalLineHeight: 1.2,
  terminalCursor: 'block',
  defaultTerm: 'xterm-256color',
  splitCommandPresentation: false,
  terminalContextPrecedingLines: 100
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

export function App(): React.JSX.Element {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [profiles, setProfiles] = useState<SessionProfileRecord[]>([]);
  const [settings, setSettings] = useState<SettingsRecord>(defaultSettings);
  const [uiState, setUiState] = useState<UiStateRecord>(defaultUiState);
  const [wslDistributions, setWslDistributions] = useState<WslDistribution[]>([]);
  const [wslLoading, setWslLoading] = useState(false);
  const [tabs, setTabs] = useState<TerminalTab[]>(() => [createLocalTab()]);
  const [activeTabId, setActiveTabId] = useState<string | null>(() => tabs[0]?.id ?? null);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

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
      setError('Only local sessions can be saved until vault-backed SSH credentials are wired in.');
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
      rightPanel: uiState.rightPanel === 'assistant' ? null : 'assistant'
    };
    setUiState(next);
    void window.geared.saveUiState(next).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : 'Unable to save UI state');
    });
  }, [uiState]);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];

  const toggleSftp = useCallback((): void => {
    if (!supportsSftp(activeTab?.request)) {
      setError('SFTP is available only for an active SSH session.');
      return;
    }
    const next: UiStateRecord = {
      ...uiState,
      rightPanel: uiState.rightPanel === 'sftp' ? null : 'sftp'
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
        <div className="brand-mark" aria-hidden="true">
          GT
        </div>
        <div>
          <p className="eyebrow">SECURE DESKTOP FOUNDATION</p>
          <h1>Geared Term</h1>
        </div>
        <span className="status-pill">{activeTab ? statusLabel(activeTab.status) : 'Ready'}</span>
      </header>

      <section
        className={`workspace ${uiState.rightPanel === 'assistant' ? 'with-assistant' : ''} ${
          uiState.rightPanel === 'sftp' ? 'with-sftp' : ''
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
            <div className="profile-list" aria-label="Saved sessions">
              {profiles.map((profile) => (
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
                            reason instanceof Error ? reason.message : 'Unable to delete session'
                          )
                        );
                    }}
                    aria-label={`Delete ${profile.name}`}
                  >
                    ×
                  </button>
                </div>
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
              onClick={toggleAssistant}
              aria-pressed={uiState.rightPanel === 'assistant'}
            >
              {uiState.rightPanel === 'assistant' ? 'Hide assistant' : 'Assistant'}
            </button>
            <button
              type="button"
              className="toolbar-button"
              onClick={toggleSftp}
              aria-pressed={uiState.rightPanel === 'sftp'}
              disabled={!supportsSftp(activeTab?.request)}
            >
              {uiState.rightPanel === 'sftp' ? 'Hide SFTP' : 'SFTP'}
            </button>
            <button
              type="button"
              className="toolbar-button"
              onClick={() => setShowSettings(true)}
              aria-haspopup="dialog"
            >
              Settings
            </button>
            <span className="toolbar-chip">Renderer isolated</span>
          </div>
          <div className="terminal-surface">
            {tabs.map((tab) => (
              <TerminalPane
                key={tab.id}
                request={tab.request}
                settings={settings}
                active={tab.id === activeTab?.id}
                onState={(message) => handleState(tab.id, message)}
                onHostKeyPrompt={handleHostKeyPrompt}
              />
            ))}
            {info ? (
              <p className="terminal-line success">
                bridge: {info.name} {info.version} ({info.platform})
              </p>
            ) : null}
            {error ? <p className="terminal-line error">{error}</p> : null}
          </div>
        </section>
        {uiState.rightPanel === 'assistant' ? <AssistantPanel /> : null}
        {uiState.rightPanel === 'sftp' && activeTab && supportsSftp(activeTab.request) ? (
          <SftpPanel sessionId={activeTab.id} onClose={toggleSftp} />
        ) : null}
      </section>

      {showSettings ? (
        <SettingsPanel
          settings={settings}
          onSave={saveSettings}
          onClose={() => setShowSettings(false)}
        />
      ) : null}

      <footer className="statusbar">
        <span>Secure context bridge</span>
        <span>Node integration disabled</span>
        <span>Schema validation enabled</span>
      </footer>
    </main>
  );
}
