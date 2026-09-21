import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  SettingsRecord,
  SftpCdEvent,
  SftpRemoteEntry,
  SftpTransfer
} from '@geared-term/protocol';
import {
  ArrowDownUp,
  ArrowRight,
  ArrowUp,
  Download,
  FolderPlus,
  RefreshCw,
  Upload,
  X
} from 'lucide-react';
import { translate, type MessageKey } from './i18n';
import { ContextMenu, type ContextMenuItem } from './sftp/context-menu';
import { SftpEntryRow, remoteMeta } from './sftp/entry-row';
import { SftpTransferList } from './sftp/transfer-list';
import { LocalFilePane, type UploadChoice } from './LocalFilePane';
import {
  joinRemote,
  posixDirname,
  validateEntryName,
  ZOOM_MAX,
  ZOOM_MIN
} from './sftp/panel-utils';

type SftpPanelProps = {
  sessionId: string;
  language: SettingsRecord['language'];
  remoteFileCommands: string[];
  alternateScreen: boolean;
  probeDirectory: () => Promise<string | null>;
  onClose: () => void;
};

type ContextMenuState = {
  x: number;
  y: number;
  entry: SftpRemoteEntry | null;
};

type PanelMessage = {
  text: string;
  tone: 'error' | 'info';
};

export function SftpPanel({
  sessionId,
  language,
  remoteFileCommands,
  alternateScreen,
  probeDirectory,
  onClose
}: SftpPanelProps): React.JSX.Element {
  const t = useCallback((key: MessageKey) => translate(language, key), [language]);
  const ta = useCallback(
    (key: MessageKey, values: Record<string, string>): string =>
      t(key).replace(/\{(\w+)\}/gu, (_match, name: string) => values[name] ?? ''),
    [t]
  );
  const [remote, setRemote] = useState<{ directory: string; entries: SftpRemoteEntry[] }>({
    directory: '.',
    entries: []
  });
  const [remoteDraft, setRemoteDraft] = useState('.');
  const [remoteSelected, setRemoteSelected] = useState<Set<string>>(new Set());
  const [transfers, setTransfers] = useState<SftpTransfer[]>([]);
  const [message, setMessage] = useState<PanelMessage | null>(null);
  const [detached, setDetached] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [editing, setEditing] = useState<{ mode: 'create' | 'rename'; path: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [zoom, setZoom] = useState(12);
  const [localRefreshSignal, setLocalRefreshSignal] = useState(0);
  const remoteRef = useRef(remote);
  remoteRef.current = remote;
  const syncRef = useRef({ detached, alternateScreen });
  syncRef.current = { detached, alternateScreen };
  const pendingResyncRef = useRef(false);
  const healingRef = useRef<string | null>(null);
  const remoteRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anchorRemote = useRef<string | null>(null);
  const localDirectoryRef = useRef<string | null>(null);
  const handleLocalDirectoryChange = useCallback((directory: string | null): void => {
    localDirectoryRef.current = directory;
  }, []);

  const setError = useCallback((text: string): void => setMessage({ text, tone: 'error' }), []);
  const setNotice = useCallback((text: string): void => setMessage({ text, tone: 'info' }), []);
  const clearMessage = (): void => setMessage(null);

  const refreshRemote = useCallback(
    async (directory: string, reanchor: boolean): Promise<void> => {
      try {
        const result = await window.geared.listSftp({ sessionId, directory, reanchor });
        setRemote({
          directory: result.directory,
          entries: [...result.entries].sort((left, right) => {
            if (left.kind === 'directory' && right.kind !== 'directory') return -1;
            if (right.kind === 'directory' && left.kind !== 'directory') return 1;
            return left.name.localeCompare(right.name, 'en', { numeric: true });
          })
        });
        setRemoteDraft(result.directory);
        setRemoteSelected((current) =>
          current.size === 0
            ? current
            : new Set(
                result.entries.filter((entry) => current.has(entry.path)).map((entry) => entry.path)
              )
        );
        healingRef.current = null;
        setMessage((current) => (current?.tone === 'error' ? null : current));
      } catch (reason) {
        setError(
          reason instanceof Error
            ? ta('sftpOpenFailed', { directory, detail: reason.message })
            : ta('sftpOpenFailed', { directory, detail: '' }).replace(': ', '')
        );
        throw reason;
      }
    },
    [sessionId, setError, ta]
  );

  const probeAndList = useCallback(
    async (announceFailure: boolean): Promise<string | null> => {
      const path = await probeDirectory();
      if (path) {
        try {
          await refreshRemote(path, true);
          return path;
        } catch {
          if (announceFailure) setError(t('sftpResyncFailed'));
          return null;
        }
      }
      if (announceFailure) setError(t('sftpResyncFailed'));
      return null;
    },
    [probeDirectory, refreshRemote, setError, t]
  );

  // Self-heal a failed optimistic `cd` by asking the shell for its authoritative
  // directory instead of leaving the remote pane on a guessed path.
  const healAfterFailure = useCallback(
    async (failedDirectory: string): Promise<void> => {
      if (syncRef.current.detached || syncRef.current.alternateScreen) return;
      if (healingRef.current === failedDirectory) return;
      healingRef.current = failedDirectory;
      const recovered = await probeAndList(false);
      if (!recovered) healingRef.current = null;
    },
    [probeAndList]
  );

  const navigateRemote = useCallback(
    async (directory: string): Promise<void> => {
      const synced = !syncRef.current.detached && !syncRef.current.alternateScreen;
      if (synced) {
        // Panel navigation moves the shell too; detached and paused views only
        // change the remote listing.
        try {
          await window.geared.sftpSendCd({ sessionId, directory });
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : t('sftpSendCdFailed'));
          return;
        }
      }
      await refreshRemote(directory, synced).catch(() => {
        if (synced) void healAfterFailure(directory);
      });
    },
    [healAfterFailure, refreshRemote, sessionId, setError, t]
  );

  const handleCd = useCallback(
    (event: SftpCdEvent): void => {
      if (event.sessionId !== sessionId) return;
      const synced = !syncRef.current.detached && !syncRef.current.alternateScreen;
      if (!synced) return;
      if (event.directory === null) {
        healingRef.current = remoteRef.current.directory;
        void probeAndList(false).then((path) => {
          if (!path) setError(t('sftpSyncLost'));
        });
        return;
      }
      const target = event.directory;
      void refreshRemote(target, true).catch(() => {
        void healAfterFailure(target);
      });
    },
    [healAfterFailure, probeAndList, refreshRemote, sessionId, setError, t]
  );

  const scheduleRemoteRefresh = useCallback((): void => {
    if (remoteRefreshTimer.current) clearTimeout(remoteRefreshTimer.current);
    remoteRefreshTimer.current = setTimeout(() => {
      void refreshRemote(remoteRef.current.directory, false).catch(() => undefined);
    }, 250);
  }, [refreshRemote]);

  const openRemoteEditor = useCallback(
    async (entry: SftpRemoteEntry): Promise<void> => {
      if (entry.kind !== 'file' && entry.kind !== 'symlink') {
        setError(t('sftpEditorNotFile'));
        return;
      }
      try {
        const result = await window.geared.openSftpEditor({
          sessionId,
          remotePath: entry.path
        });
        if (result.status === 'busy') {
          setNotice(ta('sftpEditorBusy', { path: result.activePath }));
        } else {
          setMessage(null);
        }
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : t('sftpEditorOpenFailed'));
      }
    },
    [sessionId, setError, setNotice, t, ta]
  );

  const scheduleLocalRefresh = useCallback((): void => {
    if (localRefreshTimer.current) clearTimeout(localRefreshTimer.current);
    localRefreshTimer.current = setTimeout(() => {
      setLocalRefreshSignal((current) => current + 1);
    }, 250);
  }, []);

  useEffect(() => {
    setRemote({ directory: '.', entries: [] });
    setRemoteDraft('.');
    setRemoteSelected(new Set());
    anchorRemote.current = null;
    setDetached(false);
    setContextMenu(null);
    setEditing(null);
    setMessage(null);
    setLocalRefreshSignal(0);
    localDirectoryRef.current = null;
    healingRef.current = null;
    pendingResyncRef.current = false;
    void (async () => {
      // Open where the shell is, not at home: the main process tracks the
      // authoritative remote directory while the panel is closed.
      const tracked = await window.geared.sftpTrackedDirectory(sessionId).catch(() => null);
      await refreshRemote(tracked ?? '.', tracked !== null).catch(() => undefined);
    })();
    void window.geared.listSftpTransfers(sessionId).then((list) => setTransfers(list.slice(-80)));
    return () => {
      if (remoteRefreshTimer.current) clearTimeout(remoteRefreshTimer.current);
      if (localRefreshTimer.current) clearTimeout(localRefreshTimer.current);
    };
  }, [refreshRemote, sessionId]);

  useEffect(() => {
    const offTransfer = window.geared.onSftpTransferEvent((event) => {
      const transfer = event.transfer;
      if (transfer.sessionId !== sessionId) return;
      setTransfers((current) => {
        const next = current.filter((entry) => entry.id !== transfer.id);
        next.push(transfer);
        return next.slice(-80);
      });
      if (
        event.kind === 'state' &&
        (transfer.status === 'completed' ||
          transfer.status === 'failed' ||
          transfer.status === 'cancelled')
      ) {
        if (transfer.direction === 'upload') scheduleRemoteRefresh();
        else scheduleLocalRefresh();
      }
    });
    const offEditorSaved = window.geared.onSftpEditorSaved((event) => {
      if (event.sessionId === sessionId) scheduleRemoteRefresh();
    });
    const offCd = window.geared.onSftpCd(handleCd);
    return () => {
      offTransfer();
      offEditorSaved();
      offCd();
    };
  }, [handleCd, scheduleLocalRefresh, scheduleRemoteRefresh, sessionId]);

  // A re-sync requested during a full-screen program runs after the primary
  // terminal screen returns.
  useEffect(() => {
    if (alternateScreen || !pendingResyncRef.current) return;
    pendingResyncRef.current = false;
    void probeAndList(true);
  }, [alternateScreen, probeAndList]);

  const activeTransfers = transfers.filter(
    (transfer) => transfer.status === 'active' || transfer.status === 'queued'
  );
  // Keep completed transfer rows visible briefly so the result is observable.
  useEffect(() => {
    if (transfers.length === 0 || activeTransfers.length > 0) return;
    const timer = setTimeout(() => setTransfers([]), 3_000);
    return () => clearTimeout(timer);
  }, [transfers, activeTransfers.length]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = (): void => setContextMenu(null);
    window.addEventListener('blur', close);
    return () => window.removeEventListener('blur', close);
  }, [contextMenu]);

  const selectEntry = (
    path: string,
    event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }
  ): void => {
    const allPaths = remote.entries.map((entry) => entry.path);
    setRemoteSelected((current) => {
      if (event.shiftKey) {
        const from = anchorRemote.current ? allPaths.indexOf(anchorRemote.current) : -1;
        const to = allPaths.indexOf(path);
        if (from >= 0 && to >= 0) {
          const [start, end] = from <= to ? [from, to] : [to, from];
          return new Set(allPaths.slice(start, end + 1));
        }
      }
      const next = new Set(event.ctrlKey || event.metaKey ? current : []);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      anchorRemote.current = path;
      return next;
    });
  };

  const openMenu = (event: React.MouseEvent, entry: SftpRemoteEntry | null): void => {
    event.preventDefault();
    event.stopPropagation();
    if (entry && !remoteSelected.has(entry.path)) {
      setRemoteSelected(new Set([entry.path]));
      anchorRemote.current = entry.path;
    }
    if (!entry) setRemoteSelected(new Set());
    setContextMenu({ x: event.clientX, y: event.clientY, entry });
  };

  const confirmLabel = (paths: string[]): string => {
    const names = paths.map((path) => path.split('/').pop() ?? path);
    if (names.length <= 4) return names.map((name) => `"${name}"`).join(', ');
    return `${names
      .slice(0, 4)
      .map((name) => `"${name}"`)
      .join(', ')} ${ta('sftpAndMore', { count: `${names.length - 4}` })}`;
  };

  const deleteRemote = async (paths: string[]): Promise<void> => {
    const label = confirmLabel(paths);
    if (!window.confirm(ta('sftpDeleteConfirmRemote', { label }))) return;
    try {
      await window.geared.sftpDelete({ sessionId, paths });
      setRemoteSelected(new Set());
      await refreshRemote(remoteRef.current.directory, false);
      clearMessage();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('sftpDeleteRemoteFailed'));
    }
  };

  const startCreateRemote = (): void => {
    setEditing({ mode: 'create', path: remoteRef.current.directory });
    setEditValue('');
  };

  const submitRemoteEdit = async (): Promise<void> => {
    if (!editing) return;
    const value = editValue.trim();
    if (!value) return;
    if (!validateEntryName(value)) {
      setError(t('sftpNameInvalid'));
      return;
    }
    try {
      if (editing.mode === 'create') {
        await window.geared.sftpMkdir({ sessionId, path: joinRemote(editing.path, value) });
      } else {
        await window.geared.sftpRename({
          sessionId,
          source: editing.path,
          destination: joinRemote(posixDirname(editing.path), value)
        });
      }
      await refreshRemote(remoteRef.current.directory, false);
      setEditing(null);
      clearMessage();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('sftpOperationFailed'));
    }
  };

  const uploadLocal = async (paths: string[], choose: UploadChoice = 'both'): Promise<void> => {
    try {
      if (paths.length > 0) {
        const started = await window.geared.uploadPathsSftp({
          sessionId,
          localPaths: paths,
          remoteDirectory: remoteRef.current.directory
        });
        setTransfers((current) => [...current, ...started]);
      } else {
        const result = await window.geared.uploadSftp({
          sessionId,
          remoteDirectory: remoteRef.current.directory,
          choose
        });
        if (result.accepted) scheduleRemoteRefresh();
      }
      clearMessage();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('sftpUploadFailed'));
    }
  };

  const downloadRemote = async (paths: string[]): Promise<void> => {
    if (paths.length === 0) {
      setError(t('sftpSelectToDownload'));
      return;
    }
    try {
      const localDirectory = localDirectoryRef.current;
      if (!localDirectory && paths.length === 1) {
        const single = remoteRef.current.entries.find((entry) => entry.path === paths[0]);
        if (single && single.kind !== 'directory') {
          const result = await window.geared.downloadSftp({
            sessionId,
            remotePath: single.path,
            suggestedName: single.name
          });
          if (result.accepted) scheduleLocalRefresh();
          clearMessage();
          return;
        }
      }
      // With no local folder open, fall back to the system Downloads directory.
      const target = localDirectory ?? (await window.geared.getDownloadsDirectory());
      const started = await window.geared.downloadPathsSftp({
        sessionId,
        remotePaths: paths,
        localDirectory: target
      });
      setTransfers((current) => [...current, ...started]);
      scheduleLocalRefresh();
      if (!localDirectory) setNotice(ta('sftpDownloadedToDownloads', { directory: target }));
      else clearMessage();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('sftpDownloadFailed'));
    }
  };

  const copyPaths = (paths: string[]): void => {
    const text = paths.length > 0 ? paths.join('\n') : remoteRef.current.directory;
    void navigator.clipboard.writeText(text);
  };

  const runRemoteCommand = async (command: string, remotePath: string): Promise<void> => {
    try {
      await window.geared.runRemoteFileCommand({ sessionId, command, remotePath });
      clearMessage();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('sftpCommandFailed'));
    }
  };

  const toggleDetached = (): void => {
    const next = !detached;
    setDetached(next);
    if (!next && !alternateScreen) {
      // Re-attaching re-aligns the remote pane with the shell's tracked path.
      void (async () => {
        const tracked = await window.geared.sftpTrackedDirectory(sessionId).catch(() => null);
        if (tracked) await refreshRemote(tracked, true).catch(() => undefined);
      })();
    }
  };

  const requestResync = (): void => {
    if (alternateScreen) {
      pendingResyncRef.current = true;
      setNotice(t('sftpResyncQueued'));
      return;
    }
    void probeAndList(true);
  };

  const buildMenuItems = (state: ContextMenuState): ContextMenuItem[] => {
    const selectedPaths = [...remoteSelected];
    const single = selectedPaths.length === 1;
    if (!state.entry) {
      return [
        {
          id: 'refresh',
          label: t('refresh'),
          run: () => void refreshRemote(remoteRef.current.directory, false).catch(() => undefined)
        },
        { id: 'copy', label: t('sftpCopyPath'), run: () => copyPaths([]) },
        {
          id: 'mkdir',
          label: t('sftpNewFolder'),
          separatorBefore: true,
          run: startCreateRemote
        },
        {
          id: 'upload-files',
          label: t('sftpUploadFiles'),
          run: () => void uploadLocal([], 'files')
        },
        {
          id: 'upload-folder',
          label: t('sftpUploadFolder'),
          run: () => void uploadLocal([], 'folders')
        }
      ];
    }

    const entry = state.entry;
    return [
      {
        id: 'edit',
        label: t('sftpEdit'),
        disabled: !single || (entry.kind !== 'file' && entry.kind !== 'symlink'),
        run: () => void openRemoteEditor(entry)
      },
      {
        id: 'open',
        label: t('sftpOpen'),
        disabled: entry.kind !== 'directory' || !single,
        run: () => void navigateRemote(entry.path)
      },
      {
        id: 'run',
        label: t('sftpRunInTerminal'),
        disabled: entry.kind === 'directory' || !single,
        submenu: remoteFileCommands.map((command) => ({
          id: `run-${command}`,
          label: command,
          run: () => void runRemoteCommand(command, entry.path)
        }))
      },
      {
        id: 'download',
        label: t('sftpDownload'),
        separatorBefore: true,
        disabled: selectedPaths.length === 0,
        run: () => void downloadRemote(selectedPaths)
      },
      {
        id: 'rename',
        label: t('sftpRename'),
        disabled: !single,
        run: () => {
          setEditing({ mode: 'rename', path: entry.path });
          setEditValue('');
        }
      },
      {
        id: 'delete',
        label: t('sftpDelete'),
        danger: true,
        disabled: selectedPaths.length === 0,
        run: () => void deleteRemote(selectedPaths)
      },
      {
        id: 'copy',
        label: t('sftpCopyPath'),
        separatorBefore: true,
        run: () => copyPaths(selectedPaths)
      },
      {
        id: 'refresh',
        label: t('refresh'),
        run: () => void refreshRemote(remoteRef.current.directory, false).catch(() => undefined)
      }
    ];
  };

  const paneStyle = { fontSize: `${zoom}px` } as const;
  const onPaneWheel = (event: React.WheelEvent): void => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    setZoom((current) =>
      Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, current + (event.deltaY < 0 ? 1 : -1)))
    );
  };
  const remotePaths = remote.entries.map((entry) => entry.path);
  const statusText = detached
    ? t('sftpDetached')
    : alternateScreen
      ? t('sftpPaused')
      : t('sftpFollowing');

  return (
    <aside className="sftp-panel" aria-label={t('filesPanelLabel')}>
      <div className="sftp-header">
        <div>
          <p className="section-label">{t('filesPanelLabel')}</p>
          <h2>{t('sftpFiles')}</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label={t('filesClose')}
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      <div className="sftp-sync" role="status">
        <span className="sftp-sync-state">{statusText}</span>
        <button type="button" className="toolbar-button" onClick={toggleDetached}>
          {detached ? t('sftpResume') : t('sftpDetach')}
        </button>
        <button
          type="button"
          className="toolbar-button"
          onClick={requestResync}
          title={alternateScreen ? t('sftpResyncQueued') : t('sftpResync')}
        >
          {t('sftpResync')}
        </button>
      </div>
      {message ? (
        <p className={message.tone === 'error' ? 'sftp-error' : 'sftp-hint'}>{message.text}</p>
      ) : null}

      {transfers.length > 0 ? (
        <SftpTransferList
          transfers={transfers}
          activeCount={activeTransfers.length}
          t={t}
          onCancel={(transferId) => void window.geared.cancelSftpTransfer(transferId)}
          onClear={() => setTransfers([])}
        />
      ) : null}

      <section className="sftp-pane" aria-label="Remote files">
        <div className="sftp-pane-header">
          <span className="section-label">{t('sftpRemote')}</span>
          <div className="sftp-actions">
            <button
              type="button"
              className="icon-button"
              onClick={() => void refreshRemote(remote.directory, false).catch(() => undefined)}
              title={t('refresh')}
              aria-label={t('refresh')}
            >
              <RefreshCw size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={startCreateRemote}
              title={t('sftpNewFolder')}
              aria-label={t('sftpNewFolder')}
            >
              <FolderPlus size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={() => void uploadLocal([], 'both')}
              title={t('sftpUploadHint')}
              aria-label={t('sftpUpload')}
            >
              <Upload size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={() => void downloadRemote([...remoteSelected])}
              title={t('sftpDownload')}
              aria-label={t('sftpDownload')}
            >
              <Download size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="toolbar-button"
              onClick={() => copyPaths([...remoteSelected])}
            >
              {t('sftpCopyPaths')}
            </button>
          </div>
        </div>
        <form
          className="sftp-path"
          onSubmit={(event) => {
            event.preventDefault();
            void navigateRemote(remoteDraft.trim() || '.');
          }}
        >
          <input
            value={remoteDraft}
            onChange={(event) => setRemoteDraft(event.target.value)}
            aria-label="Remote directory"
            spellCheck={false}
          />
          <button
            type="submit"
            className="icon-button"
            title={t('sftpGo')}
            aria-label={t('sftpGo')}
          >
            <ArrowRight size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="toolbar-button"
            aria-label="Remote parent directory"
            onClick={() => void navigateRemote(posixDirname(remote.directory))}
          >
            <ArrowUp size={14} aria-hidden="true" />
          </button>
        </form>
        {editing ? (
          <div className="sftp-edit">
            <input
              autoFocus
              value={editValue}
              onChange={(event) => setEditValue(event.target.value)}
              placeholder={
                editing.mode === 'create' ? t('sftpNewFolderName') : t('sftpRenamePlaceholder')
              }
              aria-label={editing.mode === 'create' ? 'New remote folder name' : 'New remote name'}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void submitRemoteEdit();
                if (event.key === 'Escape') setEditing(null);
              }}
            />
            <button
              type="button"
              className="toolbar-button"
              onClick={() => void submitRemoteEdit()}
            >
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
          {remote.entries.map((entry) => (
            <SftpEntryRow
              key={entry.path}
              entry={entry}
              side="remote"
              selected={remoteSelected.has(entry.path)}
              title={entry.longName}
              meta={remoteMeta(entry)}
              onClick={(event) => selectEntry(entry.path, event)}
              onDoubleClick={() => {
                if (entry.kind === 'directory') void navigateRemote(entry.path);
                else void openRemoteEditor(entry);
              }}
              onContextMenu={(event) => openMenu(event, entry)}
            />
          ))}
          {remote.entries.length === 0 ? <p className="muted">{t('sftpEmpty')}</p> : null}
        </div>
        <div className="sftp-footer">
          <span>{ta('sftpItemCount', { count: `${remote.entries.length}` })}</span>
          {activeTransfers.length > 0 ? <span>{t('sftpTransferring')}</span> : null}
        </div>
      </section>

      <div className="sftp-divider" role="separator" aria-orientation="horizontal">
        <ArrowDownUp size={12} aria-hidden="true" />
      </div>

      <LocalFilePane
        language={language}
        sectionLabel={t('sftpLocal')}
        initialDirectory={null}
        zoom={zoom}
        onZoomChange={(delta) =>
          setZoom((current) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, current + delta)))
        }
        refreshSignal={localRefreshSignal}
        onDirectoryChange={handleLocalDirectoryChange}
        onUploadSelected={(paths) => void uploadLocal(paths)}
        onUploadPicker={(choose) => void uploadLocal([], choose)}
      />

      {contextMenu ? (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={buildMenuItems(contextMenu)}
          onClose={() => setContextMenu(null)}
        />
      ) : null}
    </aside>
  );
}
