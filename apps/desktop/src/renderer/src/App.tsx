import { useEffect, useState } from 'react';
import { TerminalPane } from './TerminalPane';

type AppInfo = Awaited<ReturnType<Window['geared']['getAppInfo']>>;

export function App(): React.JSX.Element {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.geared
      .getAppInfo()
      .then(setInfo)
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : 'Unable to read app state')
      );
  }, []);

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
        <span className="status-pill">Phase 1</span>
      </header>

      <section className="workspace" aria-label="Workspace">
        <aside className="sidebar">
          <p className="section-label">Sessions</p>
          <div className="empty-state">
            <span className="empty-icon" aria-hidden="true">
              +
            </span>
            <p>No sessions yet</p>
            <small>
              Local, WSL, and SSH session management arrives in the next vertical slice.
            </small>
          </div>
        </aside>

        <section className="terminal-card" aria-label="Terminal foundation status">
          <div className="terminal-toolbar">
            <span>Foundation status</span>
            <span className="toolbar-chip">Renderer isolated</span>
          </div>
          <div className="terminal-surface">
            <TerminalPane />
            {info ? (
              <p className="terminal-line success">
                app bridge: {info.name} {info.version} ({info.platform})
              </p>
            ) : null}
            {error ? <p className="terminal-line error">bridge error: {error}</p> : null}
          </div>
        </section>
      </section>

      <footer className="statusbar">
        <span>Secure context bridge</span>
        <span>Node integration disabled</span>
        <span>Schema validation enabled</span>
      </footer>
    </main>
  );
}
