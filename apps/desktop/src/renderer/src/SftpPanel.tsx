import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  LocalEntry,
  SettingsRecord,
  SftpCdEvent,
  SftpRemoteEntry,
  SftpTransfer
} from '@geared-term/protocol';
import { ArrowUp, X } from 'lucide-react';
import { translate, type MessageKey } from './i18n';
import { ContextMenu, type ContextMenuItem } from './sftp/context-menu';
import { SftpEntryRow, localMeta, remoteMeta } from './sftp/entry-row';
import { SftpTransferList } from './sftp/transfer-list';
import {
  entrySide,
  joinLocal,
  joinRemote,
  localDirname,
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

type Side = 'remote' | 'local';

type ContextMenuState = {
  x: number;
  y: number;
  side: Side;
  entry: SftpRemoteEntry | LocalEntry | null;
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
  const [localDirectory, setLocalDirectory] = useState<string | null>(null);
  const [localEntries, setLocalEntries] = useState<LocalEntry[]>([]);
  const [remoteSelected, setRemoteSelected] = useState<Set<string>>(new Set());
  const [localSelected, setLocalSelected] = useState<Set<string>>(new Set());
  const [transfers, setTransfers] = useState<SftpTransfer[]>([]);
  const [message, setMessage] = useState<PanelMessage | null>(null);
  const [detached, setDetached] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [editing, setEditing] = useState<{
    side: Side;
    mode: 'create' | 'rename';
    path: string;
  } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [zoom, setZoom] = useState(12);
  const anchorRemote = useRef<string | null>(null);
  const anchorLocal = useRef<string | null>(null);
  const remoteRef = useRef(remote);
  remoteRef.current = remote;
  const localRef = useRef(localDirectory);
  localRef.current = localDirectory;
  const syncRef = useRef({ detached, alternateScreen });
  syncRef.current = { detached, alternateScreen };
  const pendingResyncRef = useRef(false);
  const healingRef = useRef<string | null>(null);
  const remoteRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
            : new Set(result.entries.filter((entry) => current.has(entry.path)).map((e) => e.path))
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

  const refreshLocal = useCallback(
    async (directory: string | null): Promise<void> => {
      try {
        const entries = await window.geared.listLocalFiles(directory);
        setLocalEntries(entries);
        setLocalDirectory(directory);
        setLocalSelected((current) =>
          current.size === 0
            ? current
            : new Set(entries.filter((entry) => current.has(entry.path)).map((e) => e.path))
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
    [setError, ta, t]
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

  // Self-heal a failed optimistic `cd` (SFTP-010): learn the shell's real
  // directory with the quiet probe and list it instead of chasing the guess.
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
        // Panel navigation moves the shell too (bidirectional sync); when the
        // panel browses on its own (detached/paused) only the listing moves.
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
    [sessionId, refreshRemote, healAfterFailure, setError, t]
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
    [sessionId, refreshRemote, probeAndList, healAfterFailure, setError, t]
  );

  const scheduleRemoteRefresh = useCallback((): void => {
    if (remoteRefreshTimer.current) clearTimeout(remoteRefreshTimer.current);
    remoteRefreshTimer.current = setTimeout(() => {
      void refreshRemote(remoteRef.current.directory, false).catch(() => undefined);
    }, 250);
  }, [refreshRemote]);

  const scheduleLocalRefresh = useCallback((): void => {
    if (localRefreshTimer.current) clearTimeout(localRefreshTimer.current);
    localRefreshTimer.current = setTimeout(() => {
      void refreshLocal(localRef.current);
    }, 250);
  }, [refreshLocal]);

  useEffect(() => {
    setRemote({ directory: '.', entries: [] });
    setRemoteDraft('.');
    setRemoteSelected(new Set());
    setLocalSelected(new Set());
    setDetached(false);
    setContextMenu(null);
    setEditing(null);
    setMessage(null);
    healingRef.current = null;
    pendingResyncRef.current = false;
    void (async () => {
      // Open where the shell is, not at home: the main process keeps tracking
      // `cd` even while the panel is closed.
      const tracked = await window.geared.sftpTrackedDirectory(sessionId).catch(() => null);
      await refreshRemote(tracked ?? '.', tracked !== null).catch(() => undefined);
    })();
    void refreshLocal(localRef.current);
    void window.geared.listSftpTransfers(sessionId).then((list) => setTransfers(list.slice(-80)));
  }, [sessionId, refreshRemote, refreshLocal]);

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
    const offCd = window.geared.onSftpCd(handleCd);
    return () => {
      offTransfer();
      offCd();
    };
  }, [sessionId, handleCd, scheduleRemoteRefresh, scheduleLocalRefresh]);

  // A re-sync requested while a full-screen program owns the terminal runs as
  // soon as the primary screen returns.
  useEffect(() => {
    if (alternateScreen || !pendingResyncRef.current) return;
    pendingResyncRef.current = false;
    void probeAndList(true);
  }, [alternateScreen, probeAndList]);

  // Collapse and clear finished transfers a few seconds after the last one,
  // mirroring the automatic progress window dismissal.
  const activeTransfers = transfers.filter(
    (transfer) => transfer.status === 'active' || transfer.status === 'queued'
  );
  useEffect(() => {
    if (transfers.length === 0 || activeTransfers.length > 0) return;
    const timer = setTimeout(() => setTransfers([]), 3_000);
    return () => clearTimeout(timer);
  }, [transfers, activeTransfers.length]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = (): void => setContextMenu(null);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('blur', close);
    };
  }, [contextMenu]);

  const selectEntry = (
    side: Side,
    path: string,
    event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean },
    allPaths: string[]
  ): void => {
    const setSelected = side === 'remote' ? setRemoteSelected : setLocalSelected;
    const anchorRef = side === 'remote' ? anchorRemote : anchorLocal;
    setSelected((current) => {
      if (event.shiftKey && anchorRef.current) {
        const from = allPaths.indexOf(anchorRef.current);
        const to = allPaths.indexOf(path);
        if (from >= 0 && to >= 0) {
          const [start, end] = from <= to ? [from, to] : [to, from];
          return new Set(allPaths.slice(start, end + 1));
        }
      }
      const next = new Set(event.ctrlKey || event.metaKey ? current : []);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      anchorRef.current = path;
      return next;
    });
  };

  // Right-clicking an entry outside the selection re-anchors the selection to
  // it, so menu actions always operate on the intended selection (augur rule).
  const openMenu = (
    event: React.MouseEvent,
    side: Side,
    entry: SftpRemoteEntry | LocalEntry | null
  ): void => {
    event.preventDefault();
    event.stopPropagation();
    if (entry) {
      const setSelected = side === 'remote' ? setRemoteSelected : setLocalSelected;
      const current = side === 'remote' ? remoteSelected : localSelected;
      if (!current.has(entry.path)) {
        setSelected(new Set([entry.path]));
        (side === 'remote' ? anchorRemote : anchorLocal).current = entry.path;
      }
    } else {
      (side === 'remote' ? setRemoteSelected : setLocalSelected)(new Set());
    }
    setContextMenu({ x: event.clientX, y: event.clientY, side, entry });
  };

  const selectionOf = (side: Side): string[] => [
    ...(side === 'remote' ? remoteSelected : localSelected)
  ];

  const confirmLabel = (paths: string[]): string => {
    const names = paths.map((path) => path.split(/[\\/]/u).pop() ?? path);
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

  const startCreate = (side: Side): void => {
    const parent = side === 'remote' ? remoteRef.current.directory : localRef.current;
    if (side === 'local' && !parent) {
      setError(t('sftpOpenLocalFolderFirst'));
      return;
    }
    setEditing({ side, mode: 'create', path: parent as string });
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
        if (editing.side === 'remote') {
          await window.geared.sftpMkdir({ sessionId, path: joinRemote(editing.path, value) });
          await refreshRemote(remoteRef.current.directory, false);
        } else {
          await window.geared.makeLocalDirectory({ parent: editing.path, name: value });
          await refreshLocal(localRef.current);
        }
      } else {
        const parent =
          editing.side === 'remote'
            ? posixDirname(editing.path)
            : (localDirname(editing.path) ?? editing.path);
        const destination =
          editing.side === 'remote' ? joinRemote(parent, value) : joinLocal(parent, value);
        if (editing.side === 'remote') {
          await window.geared.sftpRename({ sessionId, source: editing.path, destination });
          await refreshRemote(remoteRef.current.directory, false);
        } else {
          await window.geared.renameLocalPath({ source: editing.path, destination });
          await refreshLocal(localRef.current);
        }
      }
      setEditing(null);
      clearMessage();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('sftpOperationFailed'));
    }
  };

  const uploadLocal = async (
    paths: string[],
    choose: 'files' | 'folders' | 'both' = 'both'
  ): Promise<void> => {
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
      if (!localRef.current && paths.length === 1) {
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
      const target = localRef.current ?? (await window.geared.getDownloadsDirectory());
      const started = await window.geared.downloadPathsSftp({
        sessionId,
        remotePaths: paths,
        localDirectory: target
      });
      setTransfers((current) => [...current, ...started]);
      scheduleLocalRefresh();
      if (!localRef.current) setNotice(ta('sftpDownloadedToDownloads', { directory: target }));
      else clearMessage();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('sftpDownloadFailed'));
    }
  };

  const copyPaths = (side: Side, paths: string[]): void => {
    const text =
      paths.length > 0
        ? paths.join('\n')
        : side === 'remote'
          ? remoteRef.current.directory
          : (localRef.current ?? '');
    if (!text) return;
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

  const openLocalEntry = async (entry: LocalEntry): Promise<void> => {
    if (entry.kind === 'directory' || entry.kind === 'drive') {
      await refreshLocal(entry.path);
      return;
    }
    try {
      await window.geared.openLocalPath(entry.path);
      clearMessage();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('sftpOpenLocalFailed'));
    }
  };

  const toggleDetached = (): void => {
    const next = !detached;
    setDetached(next);
    if (!next && !alternateScreen) {
      // Re-attaching re-aligns the panel with the shell's tracked directory.
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
    const selectedPaths = selectionOf(state.side);
    const single = selectedPaths.length === 1;
    if (!state.entry) {
      return state.side === 'remote'
        ? [
            {
              id: 'refresh',
              label: t('refresh'),
              run: () =>
                void refreshRemote(remoteRef.current.directory, false).catch(() => undefined)
            },
            { id: 'copy', label: t('sftpCopyPath'), run: () => copyPaths('remote', []) },
            {
              id: 'mkdir',
              label: t('sftpNewFolder'),
              separatorBefore: true,
              run: () => startCreate('remote')
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
          ]
        : [
            { id: 'refresh', label: t('refresh'), run: () => void refreshLocal(localRef.current) },
            {
              id: 'copy',
              label: t('sftpCopyPath'),
              disabled: !localRef.current,
              run: () => copyPaths('local', [])
            },
            {
              id: 'mkdir',
              label: t('sftpNewFolder'),
              separatorBefore: true,
              run: () => startCreate('local')
            },
            {
              id: 'open-location',
              label: t('sftpOpenLocation'),
              disabled: !localRef.current,
              run: () => {
                if (localRef.current) void window.geared.openLocalPath(localRef.current);
              }
            }
          ];
    }
    const entry = entrySide(state.entry);
    const guarded = 'guarded' in state.entry && state.entry.guarded;
    if (state.side === 'remote') {
      return [
        {
          id: 'open',
          label: t('sftpOpen'),
          disabled: !entry.isDirectory || !single,
          run: () => void navigateRemote(entry.path)
        },
        {
          id: 'run',
          label: t('sftpRunInTerminal'),
          disabled: entry.isDirectory || !single,
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
            setEditing({ side: 'remote', mode: 'rename', path: entry.path });
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
          run: () => copyPaths('remote', selectedPaths)
        },
        {
          id: 'refresh',
          label: t('refresh'),
          run: () => void refreshRemote(remoteRef.current.directory, false).catch(() => undefined)
        }
      ];
    }
    return [
      {
        id: 'open',
        label: t('sftpOpen'),
        disabled: !single,
        run: () => void openLocalEntry(state.entry as LocalEntry)
      },
      {
        id: 'upload',
        label: t('sftpUpload'),
        disabled: guarded || selectedPaths.length === 0,
        run: () => void uploadLocal(selectedPaths)
      },
      {
        id: 'rename',
        label: t('sftpRename'),
        separatorBefore: true,
        disabled: guarded || !single,
        run: () => {
          setEditing({ side: 'local', mode: 'rename', path: entry.path });
          setEditValue('');
        }
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
        run: () => copyPaths('local', selectedPaths)
      },
      { id: 'refresh', label: t('refresh'), run: () => void refreshLocal(localRef.current) },
      {
        id: 'open-location',
        label: t('sftpOpenLocation'),
        disabled: guarded,
        run: () => void window.geared.revealLocalPath(entry.path)
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
  const localPaths = localEntries.map((entry) => entry.path);
  const statusText = detached
    ? t('sftpDetached')
    : alternateScreen
      ? t('sftpPaused')
      : t('sftpFollowing');

  return (
    <aside className="sftp-panel" aria-label="SFTP browser">
      <div className="sftp-header">
        <div>
          <p className="section-label">SFTP</p>
          <h2>{t('sftpFiles')}</h2>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label={t('sftpClose')}>
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
              className="toolbar-button"
              onClick={() => void refreshRemote(remote.directory, false).catch(() => undefined)}
            >
              {t('refresh')}
            </button>
            <button type="button" className="toolbar-button" onClick={() => startCreate('remote')}>
              {t('sftpNewFolder')}
            </button>
            <button
              type="button"
              className="toolbar-button"
              onClick={() => void uploadLocal([])}
              title={t('sftpUploadHint')}
            >
              {t('sftpUpload')}
            </button>
            <button
              type="button"
              className="toolbar-button"
              onClick={() => void downloadRemote([...remoteSelected])}
            >
              {t('sftpDownload')}
            </button>
            <button
              type="button"
              className="toolbar-button"
              onClick={() => copyPaths('remote', [...remoteSelected])}
            >
              {t('sftpCopyPaths')}
            </button>
          </div>
        </div>
        <form
          className="sftp-path"
          onSubmit={(event) => {
            event.preventDefault();
            const target = remoteDraft.trim() || '.';
            void navigateRemote(target).catch(() => undefined);
          }}
        >
          <input
            value={remoteDraft}
            onChange={(event) => setRemoteDraft(event.target.value)}
            aria-label="Remote directory"
            spellCheck={false}
          />
          <button type="submit" className="toolbar-button">
            {t('sftpGo')}
          </button>
          <button
            type="button"
            className="toolbar-button"
            aria-label="Remote parent directory"
            onClick={() =>
              void navigateRemote(posixDirname(remote.directory)).catch(() => undefined)
            }
          >
            <ArrowUp size={14} aria-hidden="true" />
          </button>
        </form>
        {editing?.side === 'remote' ? (
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
          onContextMenu={(event) => openMenu(event, 'remote', null)}
        >
          {remote.entries.map((entry) => (
            <SftpEntryRow
              key={entry.path}
              entry={entry}
              side="remote"
              selected={remoteSelected.has(entry.path)}
              title={entry.longName}
              meta={remoteMeta(entry)}
              onClick={(event) => selectEntry('remote', entry.path, event, remotePaths)}
              onDoubleClick={() => {
                if (entry.kind === 'directory')
                  void navigateRemote(entry.path).catch(() => undefined);
              }}
              onContextMenu={(event) => openMenu(event, 'remote', entry)}
            />
          ))}
          {remote.entries.length === 0 ? <p className="muted">{t('sftpEmpty')}</p> : null}
        </div>
        <div className="sftp-footer">
          <span>{ta('sftpItemCount', { count: `${remote.entries.length}` })}</span>
          {activeTransfers.length > 0 ? <span>{t('sftpTransferring')}</span> : null}
        </div>
      </section>

      <section className="sftp-pane" aria-label="Local files">
        <div className="sftp-pane-header">
          <span className="section-label">{t('sftpLocal')}</span>
          <div className="sftp-actions">
            <button
              type="button"
              className="toolbar-button"
              onClick={() => void refreshLocal(localDirectory)}
            >
              {t('refresh')}
            </button>
            <button type="button" className="toolbar-button" onClick={() => startCreate('local')}>
              {t('sftpNewFolder')}
            </button>
            <button
              type="button"
              className="toolbar-button"
              onClick={() => void uploadLocal([...localSelected])}
              disabled={localSelected.size === 0}
            >
              {t('sftpUpload')}
            </button>
            <button
              type="button"
              className="toolbar-button"
              onClick={() =>
                void refreshLocal(localDirectory ? localDirname(localDirectory) : null)
              }
              disabled={!localDirectory}
              title={localDirectory ? t('sftpParent') : t('sftpOpenFolderFirst')}
            >
              {t('sftpParent')}
            </button>
            <button
              type="button"
              className="toolbar-button"
              onClick={() => copyPaths('local', [...localSelected])}
            >
              {t('sftpCopyPaths')}
            </button>
          </div>
        </div>
        <p className="sftp-path-display">{localDirectory ?? t('sftpThisPc')}</p>
        {editing?.side === 'local' ? (
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
          onContextMenu={(event) => openMenu(event, 'local', null)}
        >
          {localEntries.map((entry) => (
            <SftpEntryRow
              key={entry.path}
              entry={entry}
              side="local"
              selected={localSelected.has(entry.path)}
              title={`${entry.path} · ${entry.permissions}`}
              meta={localMeta(entry)}
              onClick={(event) => selectEntry('local', entry.path, event, localPaths)}
              onDoubleClick={() => void openLocalEntry(entry)}
              onContextMenu={(event) => openMenu(event, 'local', entry)}
            />
          ))}
          {localEntries.length === 0 ? <p className="muted">{t('sftpNoLocalItems')}</p> : null}
        </div>
        <div className="sftp-footer">
          <span>{ta('sftpItemCount', { count: `${localEntries.length}` })}</span>
        </div>
      </section>

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
