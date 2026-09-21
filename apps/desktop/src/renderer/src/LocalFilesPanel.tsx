import { useCallback, useEffect, useState } from 'react';
import type { SettingsRecord } from '@geared-term/protocol';
import { X } from 'lucide-react';
import { translate, type MessageKey } from './i18n';
import { LocalFilePane } from './LocalFilePane';
import { ZOOM_MAX, ZOOM_MIN } from './sftp/panel-utils';

type LocalFilesPanelProps = {
  sessionId: string;
  fallbackDirectory?: string;
  sessionReady: boolean;
  language: SettingsRecord['language'];
  onClose: () => void;
};

export function LocalFilesPanel({
  sessionId,
  fallbackDirectory,
  sessionReady,
  language,
  onClose
}: LocalFilesPanelProps): React.JSX.Element {
  const t = useCallback((key: MessageKey) => translate(language, key), [language]);
  const [initialDirectory, setInitialDirectory] = useState<string | null | undefined>(undefined);
  const [zoom, setZoom] = useState(12);

  useEffect(() => {
    let cancelled = false;
    setInitialDirectory(undefined);
    void window.geared
      .getLocalWorkingDirectory(sessionId)
      .catch(() => null)
      .then((workingDirectory) => {
        if (cancelled) return;
        if (workingDirectory) {
          setInitialDirectory(workingDirectory);
        } else if (fallbackDirectory) {
          setInitialDirectory(fallbackDirectory);
        } else if (sessionReady) {
          setInitialDirectory(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [fallbackDirectory, sessionId, sessionReady]);

  return (
    <aside className="sftp-panel local-files-panel" aria-label={t('filesPanelLabel')}>
      <div className="sftp-header">
        <div>
          <p className="section-label">{t('filesPanelLabel')}</p>
          <h2>{t('filesTitle')}</h2>
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
      {initialDirectory === undefined ? (
        <p className="sftp-hint">{t('filesLoading')}</p>
      ) : (
        <LocalFilePane
          language={language}
          sectionLabel={t('filesLocal')}
          initialDirectory={initialDirectory}
          zoom={zoom}
          onZoomChange={(delta) =>
            setZoom((current) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, current + delta)))
          }
        />
      )}
    </aside>
  );
}
