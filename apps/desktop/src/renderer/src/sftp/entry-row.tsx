import type { LocalEntry, SftpRemoteEntry } from '@geared-term/protocol';
import { File, Folder, HardDrive, Link } from 'lucide-react';
import { formatBytes } from './panel-utils';

type SftpEntryRowProps = {
  entry: SftpRemoteEntry | LocalEntry;
  side: 'remote' | 'local';
  selected: boolean;
  title: string;
  meta: string;
  onClick: (event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => void;
  onDoubleClick: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
};

function KindIcon({
  kind
}: {
  kind: SftpRemoteEntry['kind'] | LocalEntry['kind'];
}): React.JSX.Element {
  if (kind === 'directory') return <Folder size={13} aria-hidden="true" />;
  if (kind === 'drive') return <HardDrive size={13} aria-hidden="true" />;
  if (kind === 'symlink') return <Link size={13} aria-hidden="true" />;
  return <File size={13} aria-hidden="true" />;
}

/** One selectable file row shared by the remote and local pane lists. */
export function SftpEntryRow({
  entry,
  selected,
  title,
  meta,
  onClick,
  onDoubleClick,
  onContextMenu
}: SftpEntryRowProps): React.JSX.Element {
  return (
    <button
      type="button"
      className="sftp-entry"
      role="listitem"
      key={entry.path}
      aria-selected={selected}
      data-selected={selected ? 'true' : undefined}
      title={title}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
    >
      <span className="sftp-entry-name">
        <KindIcon kind={entry.kind} />
        <span className="sftp-entry-label">{entry.name}</span>
      </span>
      <small>{meta}</small>
    </button>
  );
}

export function remoteMeta(entry: SftpRemoteEntry): string {
  const size = entry.kind === 'directory' ? '' : formatBytes(entry.size);
  return `${size}  ${entry.longName.split(/\s+/u)[0] ?? ''}`;
}

export function localMeta(entry: LocalEntry): string {
  return entry.kind === 'directory' || entry.kind === 'drive' ? '' : formatBytes(entry.size);
}
