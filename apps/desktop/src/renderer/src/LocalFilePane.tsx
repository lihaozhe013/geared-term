import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LocalEntry, SettingsRecord } from '@geared-term/protocol';
import { ArrowRight, ArrowUp, ExternalLink, FolderPlus, RefreshCw, Upload } from 'lucide-react';
import { translate, type MessageKey } from './i18n';
import { ContextMenu, type ContextMenuItem } from './sftp/context-menu';
import { SftpEntryRow, localMeta } from './sftp/entry-row';
import { searchFileEntries, visibleSelectedPaths } from './sftp/file-search';
import { FileSearchInput } from './sftp/file-search-input';
import { joinLocal, localDirname, validateEntryName, ZOOM_MAX, ZOOM_MIN } from './sftp/panel-utils';

type UploadChoice = 'files' | 'folders' | 'both';

export type LocalFilePaneProps = {
  language: SettingsRecord['language'];
  sectionLabel?: string;
  initialDirectory: string | null;
  zoom: number;
  onZoomChange: (delta: number) => void;
  refreshSignal?: number;
  onDirectoryChange?: (directory: string | null) => void;
  onUploadSelected?: (paths: string[]) => void;
  onUploadPicker?: (choose: UploadChoice) => void;
};

type ContextMenuState = {
  x: number;
  y: number;
  entry: LocalEntry | null;
};

type PanelMessage = {
  text: string;
  tone: 'error' | 'info';
};

export function LocalFilePane({
  language,
  sectionLabel,
  initialDirectory,
  zoom,
  onZoomChange,
  refreshSignal,
  onDirectoryChange,
  onUploadSelected,
  onUploadPicker
}: LocalFilePaneProps): React.JSX.Element {
  const t = useCallback((key: MessageKey) => translate(language, key), [language]);
  const ta = useCallback(
    (key: MessageKey, values: Record<string, string>): string =>
      t(key).replace(/\{(\w+)\}/gu, (_match, name: string) => values[name] ?? ''),
    [t]
  );
  const [localDirectory, setLocalDirectory] = useState<string | null>(initialDirectory);
  const [directoryDraft, setDirectoryDraft] = useState(initialDirectory ?? '');
  const [localQuery, setLocalQuery] = useState('');
  const [localEntries, setLocalEntries] = useState<LocalEntry[]>([]);
  const [localSelected, setLocalSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<PanelMessage | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [editing, setEditing] = useState<{
    mode: 'create' | 'rename';
    path: string;
  } | null>(null);
  const [editValue, setEditValue] = useState('');
  const anchorLocal = useRef<string | null>(null);
  const localRef = useRef(localDirectory);
  localRef.current = localDirectory;
  const refreshSignalRef = useRef(refreshSignal);

  const setError = useCallback((text: string): void => setMessage({ text, tone: 'error' }), []);
  const clearMessage = (): void => setMessage(null);

  const refreshLocal = useCallback(
    async (directory: string | null): Promise<void> => {
      try {
        const entries = await window.geared.listLocalFiles(directory);
        if (localRef.current !== directory) setLocalQuery('');
        setLocalEntries(entries);
        setLocalDirectory(directory);
        setDirectoryDraft(directory ?? '');
        onDirectoryChange?.(directory);
        setLocalSelected((current) =>
          current.size === 0
            ? current
            : new Set(entries.filter((entry) => current.has(entry.path)).map((entry) => entry.path))
        );
        setMessage((current) => (current?.tone === 'error' ? null : current));
      } catch (reason) {
        setError(
          reason instanceof Error
            ? ta('sftpLocalUnavailable', { detail: reason.message })
            : t('sftpLocalUnavailablePlain')
        );
      }
    },
    [onDirectoryChange, setError, ta, t]
  );

  useEffect(() => {
    setLocalDirectory(initialDirectory);
    setDirectoryDraft(initialDirectory ?? '');
    setLocalQuery('');
    setLocalEntries([]);
    setLocalSelected(new Set());
    setContextMenu(null);
    setEditing(null);
    setMessage(null);
    anchorLocal.current = null;
    void refreshLocal(initialDirectory);
  }, [initialDirectory, refreshLocal]);

  useEffect(() => {
    if (refreshSignal === undefined || refreshSignalRef.current === refreshSignal) return;
    refreshSignalRef.current = refreshSignal;
    void refreshLocal(localRef.current);
  }, [refreshLocal, refreshSignal]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = (): void => setContextMenu(null);
    window.addEventListener('blur', close);
    return () => window.removeEventListener('blur', close);
  }, [contextMenu]);

  const visibleLocalEntries = useMemo(
    () => searchFileEntries(localEntries, localQuery),
    [localEntries, localQuery]
  );
  const visibleLocalPaths = visibleLocalEntries.map((entry) => entry.path);
  const selectedLocalPaths = visibleSelectedPaths(visibleLocalEntries, localSelected);

  useEffect(() => {
    const visible = new Set(visibleLocalPaths);
    setLocalSelected((current) => {
      if ([...current].every((path) => visible.has(path))) return current;
      return new Set([...current].filter((path) => visible.has(path)));
    });
    if (anchorLocal.current && !visible.has(anchorLocal.current)) anchorLocal.current = null;
  }, [visibleLocalEntries]);

  const selectEntry = (
    path: string,
    event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }
  ): void => {
    const allPaths = visibleLocalPaths;
    setLocalSelected((current) => {
      if (event.shiftKey && anchorLocal.current) {
        const from = allPaths.indexOf(anchorLocal.current);
        const to = allPaths.indexOf(path);
        if (from >= 0 && to >= 0) {
          const [start, end] = from <= to ? [from, to] : [to, from];
          return new Set(allPaths.slice(start, end + 1));
        }
      }
      const next = new Set(event.ctrlKey || event.metaKey ? current : []);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      anchorLocal.current = path;
      return next;
    });
  };

  const openMenu = (event: React.MouseEvent, entry: LocalEntry | null): void => {
    event.preventDefault();
    event.stopPropagation();
    if (entry) {
      if (!localSelected.has(entry.path)) {
        setLocalSelected(new Set([entry.path]));
        anchorLocal.current = entry.path;
      }
    } else {
      setLocalSelected(new Set());
    }
    setContextMenu({ x: event.clientX, y: event.clientY, entry });
  };

  const selectionOf = (): string[] => selectedLocalPaths;

  const confirmLabel = (paths: string[]): string => {
    const names = paths.map((path) => path.split(/[\\/]/u).pop() ?? path);
    if (names.length <= 4) return names.map((name) => `"${name}"`).join(', ');
    return `${names
      .slice(0, 4)
      .map((name) => `"${name}"`)
      .join(', ')} ${ta('sftpAndMore', { count: `${names.length - 4}` })}`;
  };

  const deleteLocal = async (paths: string[]): Promise<void> => {
    const label =
      paths.length === 1 ? (paths[0] ?? '') : ta('sftpItemCount', { count: `${paths.length}` });
    if (!window.confirm(ta('sftpDeleteConfirmLocal', { label }))) return;
    try {
      await window.geared.deleteLocalPaths(paths);
      setLocalSelected(new Set());
      await refreshLocal(localRef.current);
      clearMessage();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('sftpDeleteLocalFailed'));
    }
  };

  const startCreate = (): void => {
    if (!localRef.current) {
      setError(t('filesOpenFolderFirst'));
      return;
    }
    setEditing({ mode: 'create', path: localRef.current });
    setEditValue('');
  };

  const startRename = (path: string): void => {
    setEditing({ mode: 'rename', path });
    setEditValue('');
  };

  const submitEdit = async (): Promise<void> => {
    if (!editing) return;
    const value = editValue.trim();
    if (!value) return;
    if (!validateEntryName(value)) {
      setError(t('sftpNameInvalid'));
      return;
    }
    try {
      if (editing.mode === 'create') {
        await window.geared.makeLocalDirectory({ parent: editing.path, name: value });
      } else {
        const parent = localDirname(editing.path) ?? editing.path;
        await window.geared.renameLocalPath({
          source: editing.path,
          destination: joinLocal(parent, value)
        });
      }
      await refreshLocal(localRef.current);
      setEditing(null);
      clearMessage();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('sftpOperationFailed'));
    }
  };

  const navigate = async (directory: string | null): Promise<void> => {
    await refreshLocal(directory);
  };

  const openLocalEntry = async (entry: LocalEntry): Promise<void> => {
    if (entry.kind === 'directory' || entry.kind === 'drive') {
      await navigate(entry.path);
      return;
    }
    try {
      await window.geared.openLocalPath(entry.path);
      clearMessage();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('sftpOpenLocalFailed'));
    }
  };

  const openCurrentDirectory = async (): Promise<void> => {
    if (!localRef.current) {
      setError(t('filesOpenFolderFirst'));
      return;
    }
    try {
      await window.geared.openLocalPath(localRef.current);
      clearMessage();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('sftpOpenLocalFailed'));
    }
  };

  const copyPaths = (paths: string[]): void => {
    const text = paths.length > 0 ? paths.join('\n') : (localRef.current ?? '');
    if (text) void navigator.clipboard.writeText(text);
  };

  const paneStyle = { fontSize: `${zoom}px` } as const;
  const onPaneWheel = (event: React.WheelEvent): void => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    onZoomChange(event.deltaY < 0 ? 1 : -1);
  };

  const buildMenuItems = (state: ContextMenuState): ContextMenuItem[] => {
    const selectedPaths = selectionOf();
    const single = selectedPaths.length === 1;
    if (!state.entry) {
      const items: ContextMenuItem[] = [
        { id: 'refresh', label: t('refresh'), run: () => void refreshLocal(localRef.current) },
        {
          id: 'copy',
          label: t('sftpCopyPath'),
          disabled: !localRef.current,
          run: () => copyPaths([])
        },
        {
          id: 'mkdir',
          label: t('sftpNewFolder'),
          separatorBefore: true,
          run: startCreate
        },
        {
          id: 'open-location',
          label: t('filesOpenInFileManager'),
          disabled: !localRef.current,
          run: () => void openCurrentDirectory()
        }
      ];
      if (onUploadPicker) {
        items.push(
          {
            id: 'upload-files',
            label: t('sftpUploadFiles'),
            separatorBefore: true,
            run: () => onUploadPicker('files')
          },
          {
            id: 'upload-folder',
            label: t('sftpUploadFolder'),
            run: () => onUploadPicker('folders')
          }
        );
      }
      return items;
    }

    const entry = state.entry;
    const guarded = entry.guarded;
    const items: ContextMenuItem[] = [
      {
        id: 'open',
        label: t('sftpOpen'),
        disabled: !single,
        run: () => void openLocalEntry(entry)
      }
    ];
    if (onUploadSelected) {
      items.push({
        id: 'upload',
        label: t('sftpUpload'),
        disabled: guarded || selectedPaths.length === 0,
        run: () => onUploadSelected(selectedPaths)
      });
    }
    items.push(
      {
        id: 'rename',
        label: t('sftpRename'),
        separatorBefore: true,
        disabled: guarded || !single,
        run: () => startRename(entry.path)
      },
      {
        id: 'delete',
        label: t('sftpDelete'),
        danger: true,
        disabled: guarded || selectedPaths.length === 0,
        run: () => void deleteLocal(selectedPaths)
      },
      {
        id: 'copy',
        label: t('sftpCopyPath'),
        separatorBefore: true,
        run: () => copyPaths(selectedPaths)
      },
      { id: 'refresh', label: t('refresh'), run: () => void refreshLocal(localRef.current) },
      {
        id: 'open-location',
        label: t('filesShowInFileManager'),
        disabled: guarded,
        run: () => void window.geared.revealLocalPath(entry.path)
      }
    );
    return items;
  };

  return (
    <section className="sftp-pane local-file-pane" aria-label={sectionLabel ?? t('sftpLocal')}>
      <div className="sftp-pane-header">
        <span className="section-label">{sectionLabel ?? t('sftpLocal')}</span>
        <div className="sftp-actions">
          <button
            type="button"
            className="icon-button"
            onClick={() => void refreshLocal(localDirectory)}
            title={t('refresh')}
            aria-label={t('refresh')}
          >
            <RefreshCw size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={startCreate}
            title={t('sftpNewFolder')}
            aria-label={t('sftpNewFolder')}
          >
            <FolderPlus size={14} aria-hidden="true" />
          </button>
          {onUploadSelected ? (
            <button
              type="button"
              className="icon-button"
              onClick={() => onUploadSelected(selectionOf())}
              disabled={selectedLocalPaths.length === 0}
              title={t('sftpUpload')}
              aria-label={t('sftpUpload')}
            >
              <Upload size={14} aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            className="icon-button"
            onClick={() => void navigate(localDirectory ? localDirname(localDirectory) : null)}
            disabled={!localDirectory}
            title={localDirectory ? t('sftpParent') : t('sftpOpenFolderFirst')}
            aria-label={localDirectory ? t('sftpParent') : t('sftpOpenFolderFirst')}
          >
            <ArrowUp size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => void openCurrentDirectory()}
            disabled={!localDirectory}
            title={t('filesOpenInFileManager')}
            aria-label={t('filesOpenInFileManager')}
          >
            <ExternalLink size={14} aria-hidden="true" />
          </button>
          <button type="button" className="toolbar-button" onClick={() => copyPaths(selectionOf())}>
            {t('sftpCopyPaths')}
          </button>
        </div>
      </div>
      <form
        className="sftp-path"
        onSubmit={(event) => {
          event.preventDefault();
          void navigate(directoryDraft.trim() || null);
        }}
      >
        <input
          value={directoryDraft}
          onChange={(event) => setDirectoryDraft(event.target.value)}
          placeholder={t('sftpThisPc')}
          aria-label={t('filesLocalDirectory')}
          spellCheck={false}
        />
        <button type="submit" className="icon-button" title={t('sftpGo')} aria-label={t('sftpGo')}>
          <ArrowRight size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="toolbar-button"
          aria-label={localDirectory ? t('sftpParent') : t('sftpOpenFolderFirst')}
          onClick={() => void navigate(localDirectory ? localDirname(localDirectory) : null)}
          disabled={!localDirectory}
        >
          <ArrowUp size={14} aria-hidden="true" />
        </button>
      </form>
      <FileSearchInput
        label={t('filesSearchLocal')}
        query={localQuery}
        onQueryChange={(query) => {
          setLocalQuery(query);
          setContextMenu(null);
        }}
      />
      {message ? (
        <p className={message.tone === 'error' ? 'sftp-error' : 'sftp-hint'}>{message.text}</p>
      ) : null}
      {editing ? (
        <div className="sftp-edit">
          <input
            autoFocus
            value={editValue}
            onChange={(event) => setEditValue(event.target.value)}
            placeholder={
              editing.mode === 'create' ? t('sftpNewFolderName') : t('sftpRenamePlaceholder')
            }
            aria-label={editing.mode === 'create' ? 'New local folder name' : 'New local name'}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submitEdit();
              if (event.key === 'Escape') setEditing(null);
            }}
          />
          <button type="button" className="toolbar-button" onClick={() => void submitEdit()}>
            {editing.mode === 'create' ? t('sftpCreate') : t('sftpRename')}
          </button>
          <button type="button" className="toolbar-button" onClick={() => setEditing(null)}>
            {t('cancel')}
          </button>
        </div>
      ) : null}
      <div
        className="sftp-list"
        role="list"
        style={paneStyle}
        onWheel={onPaneWheel}
        onContextMenu={(event) => openMenu(event, null)}
      >
        {visibleLocalEntries.map((entry) => (
          <SftpEntryRow
            key={entry.path}
            entry={entry}
            side="local"
            selected={localSelected.has(entry.path)}
            title={`${entry.path} · ${entry.permissions}`}
            meta={localMeta(entry)}
            onClick={(event) => selectEntry(entry.path, event)}
            onDoubleClick={() => void openLocalEntry(entry)}
            onContextMenu={(event) => openMenu(event, entry)}
          />
        ))}
        {visibleLocalEntries.length === 0 ? (
          <p className="muted">{localQuery.trim() ? t('filesNoMatches') : t('sftpNoLocalItems')}</p>
        ) : null}
      </div>
      <div className="sftp-footer">
        <span role="status" aria-live="polite">
          {localQuery.trim()
            ? ta('filesSearchCount', {
                shown: `${visibleLocalEntries.length}`,
                count: `${localEntries.length}`
              })
            : ta('sftpItemCount', { count: `${localEntries.length}` })}
        </span>
      </div>
      {contextMenu ? (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={buildMenuItems(contextMenu)}
          onClose={() => setContextMenu(null)}
        />
      ) : null}
    </section>
  );
}

export type { UploadChoice };
