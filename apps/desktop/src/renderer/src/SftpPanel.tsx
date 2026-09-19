import { useCallback, useEffect, useState } from 'react';
import type { SftpRemoteEntry } from '@geared-term/protocol';

type SftpPanelProps = {
  sessionId: string;
  onClose: () => void;
};

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function SftpPanel({ sessionId, onClose }: SftpPanelProps): React.JSX.Element {
  const [directory, setDirectory] = useState('.');
  const [draftDirectory, setDraftDirectory] = useState('.');
  const [entries, setEntries] = useState<SftpRemoteEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(
    async (nextDirectory: string = directory): Promise<void> => {
      setLoading(true);
      try {
        const result = await window.geared.listSftp({ sessionId, directory: nextDirectory });
        setEntries(result);
        setDirectory(nextDirectory);
        setDraftDirectory(nextDirectory);
        setError(null);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Unable to read remote directory');
      } finally {
        setLoading(false);
      }
    },
    [directory, sessionId]
  );

  useEffect(() => {
    setDirectory('.');
    setDraftDirectory('.');
    setSelectedPath(undefined);
    void refresh('.');
  }, [sessionId]);

  const selectedEntry = entries.find((entry) => entry.path === selectedPath);

  const upload = async (): Promise<void> => {
    setTransferring(true);
    try {
      const result = await window.geared.uploadSftp({
        sessionId,
        remoteDirectory: directory
      });
      if (result.accepted) await refresh();
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to upload file');
    } finally {
      setTransferring(false);
    }
  };

  const download = async (): Promise<void> => {
    if (!selectedEntry || selectedEntry.kind === 'directory') {
      setError('Select a remote file before downloading');
      return;
    }
    setTransferring(true);
    try {
      const result = await window.geared.downloadSftp({
        sessionId,
        remotePath: selectedEntry.path,
        suggestedName: selectedEntry.name
      });
      if (result.accepted) setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to download file');
    } finally {
      setTransferring(false);
    }
  };

  return (
    <aside className="sftp-panel" aria-label="SFTP browser">
      <div className="sftp-header">
        <div>
          <p className="section-label">SFTP</p>
          <h2>Remote files</h2>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close SFTP">
          ×
        </button>
      </div>
      <form
        className="sftp-path"
        onSubmit={(event) => {
          event.preventDefault();
          void refresh(draftDirectory.trim() || '.');
        }}
      >
        <input
          value={draftDirectory}
          onChange={(event) => setDraftDirectory(event.target.value)}
          aria-label="Remote directory"
          spellCheck={false}
        />
        <button type="submit" className="toolbar-button" disabled={loading}>
          {loading ? '…' : 'Go'}
        </button>
      </form>
      <div className="sftp-actions">
        <button
          type="button"
          className="toolbar-button"
          onClick={() => void refresh()}
          disabled={loading}
        >
          Refresh
        </button>
        <button
          type="button"
          className="toolbar-button"
          onClick={() => void refresh('..')}
          disabled={loading || directory === '.'}
        >
          Parent
        </button>
        <button
          type="button"
          className="toolbar-button"
          onClick={() => void upload()}
          disabled={loading || transferring}
        >
          Upload
        </button>
        <button
          type="button"
          className="toolbar-button"
          onClick={() => void download()}
          disabled={loading || transferring || !selectedEntry || selectedEntry.kind === 'directory'}
        >
          Download
        </button>
      </div>
      {error ? <p className="sftp-error">{error}</p> : null}
      <div className="sftp-list" role="list" aria-label={`Files in ${directory}`}>
        {entries.map((entry) => (
          <button
            type="button"
            className="sftp-entry"
            role="listitem"
            key={entry.path}
            aria-selected={entry.path === selectedPath}
            data-selected={entry.path === selectedPath ? 'true' : undefined}
            onDoubleClick={() => {
              if (entry.kind === 'directory') void refresh(entry.path);
            }}
            onClick={() => {
              setSelectedPath(entry.path);
              setDraftDirectory(entry.path);
            }}
            title={entry.longName}
          >
            <span className="sftp-entry-name">
              <span aria-hidden="true">{entry.kind === 'directory' ? '▸' : '·'}</span>
              {entry.name}
            </span>
            <small>{entry.kind === 'directory' ? 'directory' : formatBytes(entry.size)}</small>
          </button>
        ))}
        {!loading && !error && entries.length === 0 ? (
          <p className="muted">This directory is empty.</p>
        ) : null}
      </div>
      <small className="sftp-hint">
        Select a file to download; double-click a directory to open it.
      </small>
    </aside>
  );
}
