import { useCallback, useEffect, useRef, useState } from 'react';
import type { SettingsRecord, UserTheme } from '@geared-term/protocol';
import { ClipboardCopy, Search, WrapText } from 'lucide-react';
import { translate, type MessageKey } from '../i18n';
import { applyPalette, applyTypography, resolvePalette } from '../themes';
import { WindowTitleBar } from '../WindowTitleBar';
import { RemoteCodeEditor, type RemoteCodeEditorHandle } from '../remote-editor/RemoteCodeEditor';

export function TerminalSnapshotDraftWindow(): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);
  const [language, setLanguage] = useState<SettingsRecord['language']>('system');
  const [wrap, setWrap] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editorRef = useRef<RemoteCodeEditorHandle | null>(null);
  const t = useCallback((key: MessageKey): string => translate(language, key), [language]);
  const translateRef = useRef(t);
  translateRef.current = t;

  useEffect(() => {
    void window.geared
      .getTerminalSnapshotDraft()
      .then(({ text }) => {
        setDraft(text);
        setError(null);
      })
      .catch(() => setError(translateRef.current('terminalSnapshotOpenFailed')));
  }, []);

  useEffect(() => {
    const apply = (settings: SettingsRecord, userThemes: UserTheme[]): void => {
      applyPalette(resolvePalette(settings.theme, userThemes));
      applyTypography(settings.uiFontSize, settings.uiFontFamily);
      document.documentElement.style.setProperty(
        '--gt-editor-font',
        settings.terminalFontFamily || 'monospace'
      );
      document.documentElement.style.setProperty(
        '--gt-editor-font-size',
        `${settings.terminalFontSize}px`
      );
      setLanguage(settings.language);
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

  useEffect(() => {
    document.title = `${t('terminalSnapshotDraftTitle')} — Geared Term`;
  }, [t]);

  const addToAssistant = async (): Promise<void> => {
    if (error) return;
    setError(null);
    setStatus(null);
    try {
      const text = editorRef.current?.content() ?? '';
      await window.geared.addTerminalSnapshotToAssistant({ text });
      setStatus(t('terminalSnapshotAddedToAi'));
    } catch {
      setError(t('terminalSnapshotAddFailed'));
    }
  };

  const copyForWeb = async (): Promise<void> => {
    if (error) return;
    setError(null);
    setStatus(null);
    try {
      const text = editorRef.current?.content() ?? '';
      await navigator.clipboard.writeText(text);
      setStatus(t('terminalSnapshotCopied'));
    } catch {
      setError(t('errCopyCommand'));
    }
  };

  return (
    <div className="remote-editor-window-shell">
      <WindowTitleBar
        title={t('terminalSnapshotDraftTitle')}
        platform={window.geared.platform}
        showMenu={false}
      />
      {draft === null ? (
        <div className="remote-editor-loading" aria-busy={!error}>
          {error ?? t('terminalSnapshotDraftTitle')}
        </div>
      ) : (
        <main className="remote-editor-main">
          <div className="remote-editor-toolbar">
            <div className="remote-editor-file">
              <strong>{t('terminalSnapshotDraftTitle')}</strong>
              <span>{t('terminalSnapshotDraftDescription')}</span>
            </div>
            <div className="remote-editor-actions">
              <button
                type="button"
                className="toolbar-button"
                onClick={() => editorRef.current?.openSearch()}
              >
                <Search size={14} aria-hidden="true" />
                {t('sftpEditorFind')}
              </button>
              <button
                type="button"
                className={`toolbar-button ${wrap ? 'active' : ''}`}
                aria-pressed={wrap}
                onClick={() => setWrap((current) => !current)}
              >
                <WrapText size={14} aria-hidden="true" />
                {t('sftpEditorWrap')}
              </button>
              <button
                type="button"
                className="toolbar-button"
                onClick={() => void addToAssistant()}
              >
                {t('terminalSnapshotAddToAi')}
              </button>
              <button type="button" className="toolbar-button" onClick={() => void copyForWeb()}>
                <ClipboardCopy size={14} aria-hidden="true" />
                {t('terminalSnapshotCopyForWeb')}
              </button>
            </div>
          </div>

          {error ? <p className="remote-editor-message error">{error}</p> : null}
          {status ? <p className="remote-editor-message status-ok">{status}</p> : null}

          <div className="remote-editor-surface">
            <RemoteCodeEditor
              ref={editorRef}
              name="snapshot.txt"
              content={draft}
              wrap={wrap}
              disabled={false}
              ariaLabel={t('terminalSnapshotDraftTitle')}
              onChanged={() => {
                setStatus(null);
                setError(null);
              }}
            />
          </div>
          <footer className="remote-editor-status">
            <span>{t('terminalSnapshotDraftDescription')}</span>
            <span className="remote-editor-warning">{t('terminalSnapshotSensitiveHint')}</span>
          </footer>
        </main>
      )}
    </div>
  );
}
