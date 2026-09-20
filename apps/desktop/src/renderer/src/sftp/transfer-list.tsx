import type { SftpTransfer } from '@geared-term/protocol';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import type { MessageKey } from '../i18n';
import { formatBytes } from './panel-utils';

type SftpTransferListProps = {
  transfers: SftpTransfer[];
  activeCount: number;
  t: (key: MessageKey) => string;
  onCancel: (transferId: string) => void;
  onClear: () => void;
};

/** Collapsible transfer ledger; open while anything is queued or active. */
export function SftpTransferList({
  transfers,
  activeCount,
  t,
  onCancel,
  onClear
}: SftpTransferListProps): React.JSX.Element {
  return (
    <details className="sftp-transfers" open={activeCount > 0}>
      <summary>
        <span>
          {t('sftpTransfers')} ({activeCount} {t('sftpActive')})
        </span>
        <button
          type="button"
          className="toolbar-button"
          onClick={(event) => {
            event.preventDefault();
            onClear();
          }}
        >
          {t('sftpClear')}
        </button>
      </summary>
      <div className="sftp-transfer-list">
        {[...transfers]
          .reverse()
          .slice(0, 24)
          .map((transfer) => {
            const percent =
              transfer.totalBytes && transfer.totalBytes > 0
                ? Math.min(100, Math.round((transfer.transferredBytes / transfer.totalBytes) * 100))
                : transfer.status === 'completed'
                  ? 100
                  : 0;
            return (
              <div className="sftp-transfer" key={transfer.id}>
                <div className="sftp-transfer-row">
                  <span className="sftp-transfer-name" title={transfer.name}>
                    {transfer.direction === 'upload' ? (
                      <ArrowUp size={13} aria-hidden="true" />
                    ) : (
                      <ArrowDown size={13} aria-hidden="true" />
                    )}
                    <span className="sftp-transfer-label">
                      {transfer.name}
                      {transfer.fileCount ? ` (${transfer.fileCount})` : ''}
                    </span>
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
                      onClick={() => onCancel(transfer.id)}
                    >
                      <X size={13} aria-hidden="true" />
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
  );
}
