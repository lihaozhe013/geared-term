import { useCallback, useEffect, useRef, useState } from 'react';
import {
  SFTP_EDITOR_MAX_BYTES,
  type SettingsRecord,
  type SftpEditorDocument,
  type SftpEditorSaveResult,
  type UserTheme
} from '@geared-term/protocol';
import { RefreshCw, Save, Search, WrapText, X } from 'lucide-react';
import { translate, type MessageKey } from '../i18n';
import { applyPalette, applyTypography, resolvePalette } from '../themes';
import { WindowTitleBar } from '../WindowTitleBar';
import { RemoteCodeEditor, type RemoteCodeEditorHandle } from './RemoteCodeEditor';
import { remoteEditorLanguage } from './language';
import { remoteEditorByteLength, savedLineEnding } from './model';

type Conflict = Extract<SftpEditorSaveResult, { status: 'conflict' }>;

export function RemoteEditorWindow(): React.JSX.Element {
  const [documentRecord, setDocumentRecord] = useState<SftpEditorDocument | null>(null);
  const [language, setLanguage] = useState<SettingsRecord['language']>('system');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [byteLength, setByteLength] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const editorRef = useRef<RemoteCodeEditorHandle | null>(null);
  const dirtyRef = useRef(false);
  const byteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const t = useCallback((key: MessageKey): string => translate(language, key), [language]);

  const updateDirty = useCallback((next: boolean): void => {
    dirtyRef.current = next;
    setDirty(next);
    void window.geared.setSftpEditorDirty(next).catch(() => undefined);
  }, []);

  useEffect(() => {
    void window.geared
      .getSftpEditorDocument()
      .then((loaded) => {
        setDocumentRecord(loaded);
        setByteLength(loaded.byteLength);
        setError(null);
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : t('sftpEditorOpenFailed'))
      );
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
    if (!dirty) return;
    const preventUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', preventUnload);
    return () => window.removeEventListener('beforeunload', preventUnload);
  }, [dirty]);

  useEffect(
    () => () => {
      if (byteTimerRef.current) clearTimeout(byteTimerRef.current);
    },
    []
  );

  useEffect(() => {
    if (!documentRecord) return;
    document.title = `${dirty ? '* ' : ''}${documentRecord.name} — Geared Term`;
  }, [dirty, documentRecord]);

  const updateByteLength = useCallback((): void => {
    if (!documentRecord) return;
    if (byteTimerRef.current) clearTimeout(byteTimerRef.current);
    byteTimerRef.current = setTimeout(() => {
      const content = editorRef.current?.content() ?? '';
      setByteLength(
        remoteEditorByteLength(content, documentRecord.lineEnding, documentRecord.hasBom)
      );
    }, 120);
  }, [documentRecord]);

  const handleChanged = useCallback((): void => {
    if (!dirtyRef.current) updateDirty(true);
    setStatus(null);
    setConflict(null);
    updateByteLength();
  }, [updateByteLength, updateDirty]);

  const applyLoadedDocument = useCallback(
    (loaded: SftpEditorDocument): void => {
      editorRef.current?.replaceContent(loaded.content);
      setDocumentRecord(loaded);
      setByteLength(loaded.byteLength);
      setConflict(null);
      setError(null);
      updateDirty(false);
    },
    [updateDirty]
  );

  const reload = useCallback(
    async (skipConfirmation = false): Promise<void> => {
      if (reloading || saving) return;
      if (dirtyRef.current && !skipConfirmation && !window.confirm(t('sftpEditorReloadConfirm'))) {
        return;
      }
      setReloading(true);
      setError(null);
      try {
        const loaded = await window.geared.reloadSftpEditor();
        applyLoadedDocument(loaded);
        setStatus(t('sftpEditorReloaded'));
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : t('sftpEditorReloadFailed'));
      } finally {
        setReloading(false);
      }
    },
    [applyLoadedDocument, reloading, saving, t]
  );

  const save = useCallback(
    async (overwriteConflict = false): Promise<void> => {
      if (!documentRecord || saving || reloading) return;
      const content = editorRef.current?.content() ?? '';
      const nextByteLength = remoteEditorByteLength(
        content,
        documentRecord.lineEnding,
        documentRecord.hasBom
      );
      setByteLength(nextByteLength);
      if (nextByteLength > SFTP_EDITOR_MAX_BYTES) {
        setError(t('sftpEditorTooLarge'));
        return;
      }
      setSaving(true);
      setError(null);
      setStatus(null);
      try {
        const result = await window.geared.saveSftpEditor({ content, overwriteConflict });
        if (result.status === 'conflict') {
          setConflict(result);
          return;
        }
        const nextLineEnding = savedLineEnding(documentRecord.lineEnding);
        const contentIsStillCurrent = editorRef.current?.content() === content;
        setDocumentRecord((current) =>
          current
            ? {
                ...current,
                content,
                byteLength: result.byteLength,
                modifiedAt: result.modifiedAt,
                lineEnding: nextLineEnding
              }
            : current
        );
        setByteLength(result.byteLength);
        setConflict(null);
        updateDirty(!contentIsStillCurrent);
        setStatus(t('sftpEditorSaved'));
      } catch (reason) {
        const detail = reason instanceof Error ? reason.message : t('sftpEditorSaveFailed');
        setError(`${detail} ${t('sftpEditorPartialWarning')}`);
      } finally {
        setSaving(false);
      }
    },
    [documentRecord, reloading, saving, t, updateDirty]
  );

  const conflictMessage = conflict
    ? conflict.reason === 'modified'
      ? t('sftpEditorConflictModified')
      : conflict.reason === 'missing'
        ? t('sftpEditorConflictMissing')
        : t('sftpEditorConflictNotFile')
    : null;
  const lineEndingLabel =
    documentRecord?.lineEnding === 'mixed'
      ? t('sftpEditorMixedLineEndings')
      : documentRecord?.lineEnding.toUpperCase();

  return (
    <div className="remote-editor-window-shell">
      <WindowTitleBar
        title={t('sftpEditorWindowTitle')}
        sessionLabel={documentRecord ? `${documentRecord.name}${dirty ? ' *' : ''}` : undefined}
        platform={window.geared.platform}
        showMenu={false}
      />
      {!documentRecord ? (
        <div className="remote-editor-loading" aria-busy={!error}>
          {error ?? t('sftpEditorLoading')}
        </div>
      ) : (
        <main className="remote-editor-main">
          <div className="remote-editor-toolbar">
            <div className="remote-editor-file">
              <strong>{documentRecord.name}</strong>
              <span title={documentRecord.remotePath}>{documentRecord.remotePath}</span>
            </div>
            <div className="remote-editor-actions">
              <button
                type="button"
                className="toolbar-button"
                disabled={saving || reloading}
                onClick={() => void save(false)}
              >
                <Save size={14} aria-hidden="true" />
                {saving ? t('sftpEditorSaving') : t('sftpEditorSave')}
              </button>
              <button
                type="button"
                className="toolbar-button"
                disabled={saving || reloading}
                onClick={() => void reload()}
              >
                <RefreshCw size={14} aria-hidden="true" />
                {reloading ? t('sftpEditorReloading') : t('sftpEditorReload')}
              </button>
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
            </div>
          </div>

          {conflict ? (
            <section className="remote-editor-conflict" role="alert">
              <div>
                <strong>{t('sftpEditorConflictTitle')}</strong>
                <p>{conflictMessage}</p>
              </div>
              <div className="remote-editor-conflict-actions">
                {conflict.reason === 'modified' ? (
                  <>
                    <button
                      type="button"
                      className="toolbar-button"
                      onClick={() => void reload(true)}
                    >
                      {t('sftpEditorReloadRemote')}
                    </button>
                    <button type="button" className="danger-button" onClick={() => void save(true)}>
                      {t('sftpEditorOverwrite')}
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t('sftpEditorKeepEditing')}
                  onClick={() => setConflict(null)}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
            </section>
          ) : null}

          {error ? <p className="remote-editor-message error">{error}</p> : null}
          {status ? <p className="remote-editor-message status-ok">{status}</p> : null}

          <div className="remote-editor-surface">
            <RemoteCodeEditor
              ref={editorRef}
              name={documentRecord.name}
              content={documentRecord.content}
              wrap={wrap}
              disabled={saving || reloading}
              onChanged={handleChanged}
              onSave={() => void save(false)}
            />
          </div>
          <footer className="remote-editor-status">
            <span>{dirty ? t('sftpEditorModified') : t('sftpEditorUnmodified')}</span>
            <span>{remoteEditorLanguage(documentRecord.name).toUpperCase()}</span>
            <span>UTF-8{documentRecord.hasBom ? ' BOM' : ''}</span>
            <span>{lineEndingLabel}</span>
            <span className={byteLength > SFTP_EDITOR_MAX_BYTES ? 'error' : ''}>
              {byteLength.toLocaleString()} / {SFTP_EDITOR_MAX_BYTES.toLocaleString()} B
            </span>
          </footer>
        </main>
      )}
    </div>
  );
}
