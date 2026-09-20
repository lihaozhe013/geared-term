import { useEffect, useState } from 'react';
import type {
  AiHistoryLoadResult,
  AiHistorySummary,
  SettingsRecord,
  UserTheme
} from '@geared-term/protocol';
import { FolderOpen, RefreshCw, Send, Trash2, X } from 'lucide-react';
import { MarkdownView } from '../assistant/MarkdownView';
import { applyPalette, applyTypography, resolvePalette } from '../themes';
import { WindowTitleBar } from '../WindowTitleBar';

function previewMarkdown(record: AiHistoryLoadResult): string {
  const lines: string[] = [`# ${record.title}`];
  if (record.model) lines.push('', `Model: ${record.model}`);
  for (const message of record.messages) {
    const role =
      message.role === 'user' ? 'User' : message.role === 'assistant' ? 'Assistant' : 'System';
    lines.push('', `## ${role}`, '', message.content);
  }
  return lines.join('\n');
}

export function HistoryWindow(): React.JSX.Element {
  const [entries, setEntries] = useState<AiHistorySummary[]>([]);
  const [selected, setSelected] = useState<AiHistoryLoadResult | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = (): void => {
    void window.geared
      .listAiHistory()
      .then((result) => {
        setEntries(result.entries);
        setError(null);
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : 'Unable to load chat history')
      );
  };

  useEffect(refresh, []);

  useEffect(() => {
    const apply = (settings: SettingsRecord, userThemes: UserTheme[]): void => {
      const palette = resolvePalette(settings.theme, userThemes);
      applyPalette(palette);
      applyTypography(settings.uiFontSize, settings.uiFontFamily);
      void window.geared
        .setTitleBarOverlay({ color: palette.background, symbolColor: palette.text })
        .catch(() => undefined);
    };
    let themes: UserTheme[] = [];
    void Promise.all([window.geared.getSettings(), window.geared.listUserThemes()])
      .then(([settings, userThemes]) => {
        themes = userThemes.themes;
        apply(settings, themes);
      })
      .catch(() => undefined);
    return window.geared.onSettingsChanged((settings) => apply(settings, themes));
  }, []);

  const openEntry = (id: string): void => {
    void window.geared
      .loadAiHistory({ id })
      .then((record) => {
        setSelected(record);
        setError(null);
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : 'Unable to load conversation')
      );
  };

  const remove = async (id: string): Promise<void> => {
    try {
      await window.geared.deleteAiHistory(id);
      setConfirmingDelete(null);
      if (selected?.id === id) setSelected(null);
      refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to delete conversation');
    }
  };

  const continueInAssistant = async (): Promise<void> => {
    if (!selected) return;
    try {
      await window.geared.continueAiHistory(selected.id);
      setStatus('Loaded into the assistant.');
      window.close();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to continue conversation');
    }
  };

  return (
    <div className="history-window-shell">
      <WindowTitleBar title="Chat History" platform={window.geared.platform} showMenu={false} />
      <div className="history-window">
        <aside className="history-list" aria-label="Chat history">
          <div className="history-list-toolbar">
            <div>
              <p className="history-title">Chat History</p>
              <p className="history-count">{entries.length} conversations</p>
            </div>
            <div className="history-toolbar-actions">
              <button
                type="button"
                className="icon-button"
                aria-label="Open folder"
                onClick={() => void window.geared.openAiHistoryDirectory()}
              >
                <FolderOpen size={14} aria-hidden="true" />
              </button>
              <button type="button" className="icon-button" aria-label="Refresh" onClick={refresh}>
                <RefreshCw size={14} aria-hidden="true" />
              </button>
            </div>
          </div>
          <div className="history-entries">
            {entries.length === 0 ? (
              <p className="settings-hint">No saved conversations yet.</p>
            ) : null}
            {entries.map((entry) => (
              <div className="history-entry" key={entry.id}>
                {confirmingDelete === entry.id ? (
                  <>
                    <button
                      type="button"
                      className="history-entry-danger"
                      onClick={() => void remove(entry.id)}
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Cancel delete"
                      onClick={() => setConfirmingDelete(null)}
                    >
                      <X size={13} aria-hidden="true" />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className={`history-entry-button ${selected?.id === entry.id ? 'active' : ''}`}
                      onClick={() => openEntry(entry.id)}
                    >
                      <span>{entry.title}</span>
                      <small>
                        {new Date(entry.updatedAt).toLocaleString()} · {entry.messageCount} messages
                      </small>
                    </button>
                    <button
                      type="button"
                      className="icon-button danger"
                      aria-label={`Delete ${entry.title}`}
                      onClick={() => setConfirmingDelete(entry.id)}
                    >
                      <Trash2 size={13} aria-hidden="true" />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        </aside>
        <section className="history-preview">
          {selected ? (
            <>
              <div className="history-preview-body">
                <MarkdownView source={previewMarkdown(selected)} />
              </div>
              <div className="history-footer">
                <span className="history-footer-status">{error ?? status ?? ''}</span>
                <button
                  type="button"
                  className="primary-button settings-apply"
                  onClick={() => void continueInAssistant()}
                >
                  <Send size={13} aria-hidden="true" /> Continue in assistant
                </button>
              </div>
            </>
          ) : (
            <div className="history-preview-empty">
              <p className="muted">Select a conversation to preview it.</p>
              {error ? <p className="settings-status status-error">{error}</p> : null}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
