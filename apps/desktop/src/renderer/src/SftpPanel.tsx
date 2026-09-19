import { useCallback, useEffect, useRef, useState } from 'react';
import type { LocalEntry, SftpCdEvent, SftpRemoteEntry, SftpTransfer } from '@geared-term/protocol';

type SftpPanelProps = {
  sessionId: string;
  remoteFileCommands: string[];
  alternateScreen: boolean;
  onClose: () => void;
};

type Side = 'remote' | 'local';

type ContextMenu = {
  x: number;
  y: number;
  side: Side;
  entry: SftpRemoteEntry | LocalEntry;
};

const ZOOM_MIN = 10;
const ZOOM_MAX = 18;

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function posixDirname(path: string): string {
  const trimmed = path.replace(/\/+$/u, '');
  const index = trimmed.lastIndexOf('/');
  if (index <= 0) return '/';
  return trimmed.slice(0, index);
}

function localDirname(path: string): string | null {
  if (/^[A-Za-z]:\\$/u.test(path)) return null;
  const trimmed = path.replace(/[\\/]+$/u, '');
  const index = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'));
  if (index <= 0) return trimmed === '/' ? null : '/';
  return trimmed.slice(0, index);
}

function kindGlyph(kind: string): string {
  if (kind === 'directory') return '⌷';
  if (kind === 'drive') return '💾';
  if (kind === 'symlink') return '→';
  return '·';
}

export function SftpPanel({
  sessionId,
  remoteFileCommands,
  alternateScreen,
  onClose
}: SftpPanelProps): React.JSX.Element {
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
  const [error, setError] = useState<string | null>(null);
  const [detached, setDetached] = useState(false);
  const [pendingDirectory, setPendingDirectory] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
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

  const refreshRemote = useCallback(
    async (directory: string): Promise<void> => {
      try {
        const result = await window.geared.listSftp({ sessionId, directory });
        setRemote({
          directory: result.directory,
          entries: [...result.entries].sort((left, right) => {
            if (left.kind === 'directory' && right.kind !== 'directory') return -1;
            if (right.kind === 'directory' && left.kind !== 'directory') return 1;
            return left.name.localeCompare(right.name, 'en', { numeric: true });
          })
        });
        setRemoteDraft(result.directory);
        setPendingDirectory(null);
        setError(null);
      } catch (reason) {
        setError(
          reason instanceof Error
            ? `Unable to open ${directory}: ${reason.message}`
            : `Unable to open ${directory}`
        );
      }
    },
    [sessionId]
  );

  const refreshLocal = useCallback(async (directory: string | null): Promise<void> => {
    try {
      setLocalEntries(await window.geared.listLocalFiles(directory));
      setError(null);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? `Local folder unavailable: ${reason.message}`
          : 'Local folder unavailable'
      );
    }
  }, []);

  useEffect(() => {
    setRemote({ directory: '.', entries: [] });
    setRemoteDraft('.');
    setRemoteSelected(new Set());
    setLocalSelected(new Set());
    setDetached(false);
    setPendingDirectory(null);
    void refreshRemote('.');
    void refreshLocal(localRef.current);
    void window.geared.listSftpTransfers(sessionId).then((list) => setTransfers(list.slice(-80)));
  }, [sessionId, refreshRemote, refreshLocal]);

  const handleCd = useCallback(
    (event: SftpCdEvent): void => {
      if (event.sessionId !== sessionId) return;
      if (event.directory === null) {
        setPendingDirectory(null);
        setError('Directory sync lost: a cd command could not be tracked. Use Re-sync or Refresh.');
        return;
      }
      if (syncRef.current.detached || syncRef.current.alternateScreen) {
        setPendingDirectory(event.directory);
        return;
      }
      void refreshRemote(event.directory);
    },
    [sessionId, refreshRemote]
  );

  useEffect(() => {
    const offTransfer = window.geared.onSftpTransferEvent((event) => {
      const transfer = event.transfer;
      setTransfers((current) => {
        const next = current.filter((entry) => entry.id !== transfer.id);
        next.push(transfer);
        return next.slice(-80);
      });
      if (
        event.kind === 'state' &&
        (transfer.status === 'completed' || transfer.status === 'failed') &&
        transfer.sessionId === sessionId
      ) {
        if (transfer.direction === 'upload') void refreshRemote(posixDirname(transfer.remotePath));
        else void refreshLocal(localRef.current);
      }
    });
    const offCd = window.geared.onSftpCd(handleCd);
    return () => {
      offTransfer();
      offCd();
    };
  }, [sessionId, handleCd, refreshRemote, refreshLocal]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = (): void => setContextMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', close);
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

  const deleteRemote = async (paths: string[]): Promise<void> => {
    const label = paths.length === 1 ? paths[0] : `${paths.length} items`;
    if (!window.confirm(`Delete ${label} on the remote server? This cannot be undone.`)) return;
    try {
      await window.geared.sftpDelete({ sessionId, paths });
      setRemoteSelected(new Set());
      await refreshRemote(remoteRef.current.directory);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to delete remote entries');
    }
  };

  const deleteLocal = async (paths: string[]): Promise<void> => {
    const label = paths.length === 1 ? paths[0] : `${paths.length} items`;
    if (!window.confirm(`Delete ${label} on this computer? This cannot be undone.`)) return;
    try {
      await window.geared.deleteLocalPaths(paths);
      setLocalSelected(new Set());
      await refreshLocal(localRef.current);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to delete local entries');
    }
  };

  const uploadSelected = async (): Promise<void> => {
    const paths = [...localSelected];
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
          remoteDirectory: remoteRef.current.directory
        });
        if (result.accepted) await refreshRemote(remoteRef.current.directory);
      }
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to start upload');
    }
  };

  const downloadSelected = async (): Promise<void> => {
    const paths = [...remoteSelected];
    if (paths.length === 0) {
      setError('Select remote files to download');
      return;
    }
    try {
      if (localRef.current) {
        const started = await window.geared.downloadPathsSftp({
          sessionId,
          remotePaths: paths,
          localDirectory: localRef.current
        });
        setTransfers((current) => [...current, ...started]);
        await refreshLocal(localRef.current);
      } else if (paths.length === 1) {
        const single = remoteRef.current.entries.find((entry) => entry.path === paths[0]);
        if (!single || single.kind === 'directory') {
          setError('Open a local folder first to download folders');
          return;
        }
        const result = await window.geared.downloadSftp({
          sessionId,
          remotePath: single.path,
          suggestedName: single.name
        });
        if (result.accepted) await refreshLocal(localRef.current);
      } else {
        setError('Open a local folder first to download multiple items');
      }
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to start download');
    }
  };

  const copyPaths = (side: Side): void => {
    const paths = [...(side === 'remote' ? remoteSelected : localSelected)];
    if (paths.length === 0) return;
    void navigator.clipboard.writeText(paths.join('\n'));
  };

  const startCreate = (side: Side): void => {
    const parent = side === 'remote' ? remoteRef.current.directory : localRef.current;
    if (side === 'local' && !parent) {
      setError('Open a local folder first to create a folder there.');
      return;
    }
    setEditing({ side, mode: 'create', path: parent as string });
    setEditValue('');
  };

  const submitEdit = async (): Promise<void> => {
    if (!editing) return;
    const value = editValue.trim();
    if (!value) return;
    try {
      if (editing.mode === 'create') {
        if (editing.side === 'remote') {
          await window.geared.sftpMkdir({ sessionId, path: joinRemote(editing.path, value) });
          await refreshRemote(remoteRef.current.directory);
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
          await refreshRemote(remoteRef.current.directory);
        } else {
          await window.geared.renameLocalPath({ source: editing.path, destination });
          await refreshLocal(localRef.current);
        }
      }
      setEditing(null);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Operation failed');
    }
  };

  const runRemoteCommand = async (command: string, remotePath: string): Promise<void> => {
    try {
      await window.geared.runRemoteFileCommand({ sessionId, command, remotePath });
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to run the command');
    }
  };

  const activeTransfers = transfers.filter(
    (transfer) => transfer.status === 'active' || transfer.status === 'queued'
  );

  const paneStyle = { fontSize: `${zoom}px` } as const;

  return (
    <aside className="sftp-panel" aria-label="SFTP browser">
      <div className="sftp-header">
        <div>
          <p className="section-label">SFTP</p>
          <h2>Files</h2>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close SFTP">
          ×
        </button>
      </div>
      <div className="sftp-sync" role="status">
        <span className="sftp-sync-state">
          {detached
            ? 'Detached'
            : alternateScreen
              ? 'Paused (alternate screen)'
              : 'Following shell'}
        </span>
        <button
          type="button"
          className="toolbar-button"
          onClick={() => setDetached((current) => !current)}
        >
          {detached ? 'Resume' : 'Detach'}
        </button>
        {pendingDirectory !== null ? (
          <button
            type="button"
            className="toolbar-button"
            onClick={() => void refreshRemote(pendingDirectory)}
          >
            Re-sync
          </button>
        ) : null}
      </div>
      {error ? <p className="sftp-error">{error}</p> : null}

      {transfers.length > 0 ? (
        <details className="sftp-transfers" open={activeTransfers.length > 0}>
          <summary>Transfers ({activeTransfers.length} active)</summary>
          <div className="sftp-transfer-list">
            {[...transfers]
              .reverse()
              .slice(0, 24)
              .map((transfer) => {
                const percent =
                  transfer.totalBytes && transfer.totalBytes > 0
                    ? Math.min(
                        100,
                        Math.round((transfer.transferredBytes / transfer.totalBytes) * 100)
                      )
                    : transfer.status === 'completed'
                      ? 100
                      : 0;
                return (
                  <div className="sftp-transfer" key={transfer.id}>
                    <div className="sftp-transfer-row">
                      <span className="sftp-transfer-name" title={transfer.name}>
                        {transfer.direction === 'upload' ? '↑' : '↓'} {transfer.name}
                      </span>
                      <small>
                        {formatBytes(transfer.transferredBytes)}
                        {transfer.totalBytes ? ` / ${formatBytes(transfer.totalBytes)}` : ''} ·{' '}
                        {transfer.status}
                      </small>
                      {transfer.status === 'active' || transfer.status === 'queued' ? (
                        <button
                          type="button"
                          className="icon-button danger"
                          aria-label={`Cancel ${transfer.name}`}
                          onClick={() => void window.geared.cancelSftpTransfer(transfer.id)}
                        >
                          ×
                        </button>
                      ) : null}
                    </div>
                    <div className="sftp-transfer-bar" role="progressbar" aria-valuenow={percent}>
                      <span style={{ width: `${percent}%` }} />
                    </div>
                    {transfer.error ? (
                      <small className="sftp-transfer-error">{transfer.error}</small>
                    ) : null}
                  </div>
                );
              })}
          </div>
        </details>
      ) : null}

      <section className="sftp-pane" aria-label="Remote files">
        <div className="sftp-pane-header">
          <span className="section-label">Remote</span>
          <div className="sftp-actions">
            <button
              type="button"
              className="toolbar-button"
              onClick={() => void refreshRemote(remote.directory)}
            >
              Refresh
            </button>
            <button type="button" className="toolbar-button" onClick={() => startCreate('remote')}>
              New folder
            </button>
            <button type="button" className="toolbar-button" onClick={() => void uploadSelected()}>
              Upload
            </button>
            <button
              type="button"
              className="toolbar-button"
              onClick={() => void downloadSelected()}
            >
              Download
            </button>
            <button type="button" className="toolbar-button" onClick={() => copyPaths('remote')}>
              Copy paths
            </button>
          </div>
        </div>
        <form
          className="sftp-path"
          onSubmit={(event) => {
            event.preventDefault();
            void refreshRemote(remoteDraft.trim() || '.');
          }}
        >
          <input
            value={remoteDraft}
            onChange={(event) => setRemoteDraft(event.target.value)}
            aria-label="Remote directory"
            spellCheck={false}
          />
          <button type="submit" className="toolbar-button">
            Go
          </button>
          <button
            type="button"
            className="toolbar-button"
            aria-label="Remote parent directory"
            onClick={() => void refreshRemote(posixDirname(remote.directory))}
          >
            ↑
          </button>
        </form>
        {editing?.side === 'remote' && editing.mode === 'create' ? (
          <div className="sftp-edit">
            <input
              autoFocus
              value={editValue}
              onChange={(event) => setEditValue(event.target.value)}
              placeholder="New folder name"
              aria-label="New remote folder name"
              onKeyDown={(event) => {
                if (event.key === 'Enter') void submitEdit();
                if (event.key === 'Escape') setEditing(null);
              }}
            />
            <button type="button" className="toolbar-button" onClick={() => void submitEdit()}>
              Create
            </button>
            <button type="button" className="toolbar-button" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        ) : null}
        {editing?.side === 'remote' && editing.mode === 'rename' ? (
          <div className="sftp-edit">
            <input
              autoFocus
              value={editValue}
              onChange={(event) => setEditValue(event.target.value)}
              placeholder={`Rename ${editing.path}`}
              aria-label="New remote name"
              onKeyDown={(event) => {
                if (event.key === 'Enter') void submitEdit();
                if (event.key === 'Escape') setEditing(null);
              }}
            />
            <button type="button" className="toolbar-button" onClick={() => void submitEdit()}>
              Rename
            </button>
            <button type="button" className="toolbar-button" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        ) : null}
        <div
          className="sftp-list"
          role="list"
          style={paneStyle}
          aria-label={`Remote files in ${remote.directory}`}
          onWheel={(event) => {
            if (!event.ctrlKey) return;
            event.preventDefault();
            setZoom((current) =>
              Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, current + (event.deltaY < 0 ? 1 : -1)))
            );
          }}
        >
          {remote.entries.map((entry) => (
            <button
              type="button"
              className="sftp-entry"
              role="listitem"
              key={entry.path}
              aria-selected={remoteSelected.has(entry.path)}
              data-selected={remoteSelected.has(entry.path) ? 'true' : undefined}
              title={entry.longName}
              onClick={(event) =>
                selectEntry(
                  'remote',
                  entry.path,
                  event,
                  remote.entries.map((item) => item.path)
                )
              }
              onDoubleClick={() => {
                if (entry.kind === 'directory') void refreshRemote(entry.path);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setContextMenu({ x: event.clientX, y: event.clientY, side: 'remote', entry });
              }}
            >
              <span className="sftp-entry-name">
                <span aria-hidden="true">{kindGlyph(entry.kind)}</span>
                {entry.name}
              </span>
              <small>
                {entry.kind === 'directory' ? '' : formatBytes(entry.size)}
                {'  '}
                {entry.longName.split(/\s+/u)[0] ?? ''}
              </small>
            </button>
          ))}
          {remote.entries.length === 0 ? <p className="muted">This directory is empty.</p> : null}
        </div>
      </section>

      <section className="sftp-pane" aria-label="Local files">
        <div className="sftp-pane-header">
          <span className="section-label">Local</span>
          <div className="sftp-actions">
            <button
              type="button"
              className="toolbar-button"
              onClick={() => void refreshLocal(localDirectory)}
            >
              Refresh
            </button>
            <button type="button" className="toolbar-button" onClick={() => startCreate('local')}>
              New folder
            </button>
            <button type="button" className="toolbar-button" onClick={() => void uploadSelected()}>
              Upload
            </button>
            <button
              type="button"
              className="toolbar-button"
              onClick={() =>
                void refreshLocal(localDirectory ? localDirname(localDirectory) : null)
              }
              disabled={!localDirectory}
            >
              Parent
            </button>
            <button type="button" className="toolbar-button" onClick={() => copyPaths('local')}>
              Copy paths
            </button>
          </div>
        </div>
        <p className="sftp-path-display">{localDirectory ?? 'This PC'}</p>
        {editing?.side === 'local' ? (
          <div className="sftp-edit">
            <input
              autoFocus
              value={editValue}
              onChange={(event) => setEditValue(event.target.value)}
              placeholder={editing.mode === 'create' ? 'New folder name' : `Rename ${editing.path}`}
              aria-label={editing.mode === 'create' ? 'New local folder name' : 'New local name'}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void submitEdit();
                if (event.key === 'Escape') setEditing(null);
              }}
            />
            <button type="button" className="toolbar-button" onClick={() => void submitEdit()}>
              {editing.mode === 'create' ? 'Create' : 'Rename'}
            </button>
            <button type="button" className="toolbar-button" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        ) : null}
        <div
          className="sftp-list"
          role="list"
          style={paneStyle}
          aria-label="Local files"
          onWheel={(event) => {
            if (!event.ctrlKey) return;
            event.preventDefault();
            setZoom((current) =>
              Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, current + (event.deltaY < 0 ? 1 : -1)))
            );
          }}
        >
          {localEntries.map((entry) => (
            <button
              type="button"
              className="sftp-entry"
              role="listitem"
              key={entry.path}
              aria-selected={localSelected.has(entry.path)}
              data-selected={localSelected.has(entry.path) ? 'true' : undefined}
              title={`${entry.path} · ${entry.permissions}`}
              onClick={(event) =>
                selectEntry(
                  'local',
                  entry.path,
                  event,
                  localEntries.map((item) => item.path)
                )
              }
              onDoubleClick={() => {
                if (entry.kind === 'directory' || entry.kind === 'drive')
                  void refreshLocal(entry.path);
                else if (entry.kind === 'file') void window.geared.openLocalPath(entry.path);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setContextMenu({ x: event.clientX, y: event.clientY, side: 'local', entry });
              }}
            >
              <span className="sftp-entry-name">
                <span aria-hidden="true">{kindGlyph(entry.kind)}</span>
                {entry.name}
              </span>
              <small>
                {entry.kind === 'directory' || entry.kind === 'drive'
                  ? ''
                  : formatBytes(entry.size)}
              </small>
            </button>
          ))}
          {localEntries.length === 0 ? (
            <p className="muted">No local items. Double-click a folder to open it.</p>
          ) : null}
        </div>
      </section>

      {contextMenu ? (
        <div
          className="sftp-context-menu"
          role="menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          {contextMenu.side === 'remote' && contextMenu.entry.kind === 'file'
            ? remoteFileCommands.map((command) => (
                <button
                  type="button"
                  role="menuitem"
                  key={command}
                  onClick={() => {
                    void runRemoteCommand(command, contextMenu.entry.path);
                    setContextMenu(null);
                  }}
                >
                  {command} “{contextMenu.entry.name}”
                </button>
              ))
            : null}
          {contextMenu.side === 'remote' ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setRemoteSelected(new Set([contextMenu.entry.path]));
                void downloadSelected();
                setContextMenu(null);
              }}
            >
              Download to local
            </button>
          ) : (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                void window.geared.openLocalPath(contextMenu.entry.path);
                setContextMenu(null);
              }}
            >
              Open
            </button>
          )}
          {contextMenu.side === 'local' ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                void window.geared.revealLocalPath(contextMenu.entry.path);
                setContextMenu(null);
              }}
            >
              Open location
            </button>
          ) : null}
          {contextMenu.entry.kind === 'directory' || contextMenu.entry.kind === 'drive' ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                if (contextMenu.side === 'remote') void refreshRemote(contextMenu.entry.path);
                else void refreshLocal(contextMenu.entry.path);
                setContextMenu(null);
              }}
            >
              Open folder
            </button>
          ) : null}
          {contextMenu.side === 'local' && contextMenu.entry.kind === 'file' ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setLocalSelected(new Set([contextMenu.entry.path]));
                void uploadSelected();
                setContextMenu(null);
              }}
            >
              Upload to remote
            </button>
          ) : null}
          {contextMenu.side === 'remote' && contextMenu.entry.kind === 'directory' ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setRemoteSelected(new Set([contextMenu.entry.path]));
                void downloadSelected();
                setContextMenu(null);
              }}
            >
              Download folder
            </button>
          ) : null}
          {!('guarded' in contextMenu.entry && contextMenu.entry.guarded) ? (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setEditing({
                    side: contextMenu.side,
                    mode: 'rename',
                    path: contextMenu.entry.path
                  });
                  setEditValue('');
                  setContextMenu(null);
                }}
              >
                Rename
              </button>
              <button
                type="button"
                role="menuitem"
                className="danger"
                onClick={() => {
                  if (contextMenu.side === 'remote') void deleteRemote([contextMenu.entry.path]);
                  else void deleteLocal([contextMenu.entry.path]);
                  setContextMenu(null);
                }}
              >
                Delete
              </button>
            </>
          ) : null}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              void navigator.clipboard.writeText(contextMenu.entry.path);
              setContextMenu(null);
            }}
          >
            Copy path
          </button>
        </div>
      ) : null}
    </aside>
  );
}

function joinRemote(directory: string, name: string): string {
  const base = directory.endsWith('/') ? directory : `${directory}/`;
  return base === '/' ? `/${name}` : posixJoinClean(`${base}${name}`);
}

function posixJoinClean(path: string): string {
  return path.replace(/\/{2,}/gu, '/');
}

function joinLocal(parent: string, name: string): string {
  const separator = /[\\/]$/u.test(parent)
    ? ''
    : parent.includes('\\') && !parent.includes('/')
      ? '\\'
      : '/';
  return `${parent}${separator}${name}`;
}
