import { useCallback } from 'react';
import type { AppInfo, SettingsRecord, UpdateNotice } from '@geared-term/protocol';
import { Download, X } from 'lucide-react';
import { translate } from './i18n';
import type { MessageKey } from './i18n';

const homebrewUpgradeCommand = 'brew upgrade --cask geared-term';

export function UpdateNoticeCard({
  notice,
  installChannel,
  language,
  onView,
  onDismiss
}: {
  notice: UpdateNotice;
  installChannel: AppInfo['installChannel'];
  language: SettingsRecord['language'];
  onView: () => Promise<void>;
  onDismiss: () => Promise<void>;
}): React.JSX.Element {
  const t = useCallback((key: MessageKey): string => translate(language, key), [language]);
  const description = t('updateNoticeDescription').replace('{sha}', notice.commitSha.slice(0, 7));

  return (
    <aside className="update-notice-card" role="status" aria-live="polite" aria-atomic="true">
      <div className="update-notice-heading">
        <span className="update-notice-icon" aria-hidden="true">
          <Download size={15} />
        </span>
        <strong>{t('updateNoticeTitle')}</strong>
        <button
          type="button"
          className="icon-button update-notice-close"
          aria-label={t('dismissUpdateNotice')}
          onClick={() => void onDismiss().catch(() => undefined)}
        >
          <X size={15} aria-hidden="true" />
        </button>
      </div>
      <p className="update-notice-description">{description}</p>
      {installChannel === 'homebrew-cask' ? (
        <p className="update-notice-homebrew">
          {t('homebrewUpgradeHint')} <code>{homebrewUpgradeCommand}</code>
        </p>
      ) : null}
      <div className="update-notice-actions">
        <button
          type="button"
          className="primary-button"
          onClick={() => void onView().catch(() => undefined)}
        >
          {t('viewUpdate')}
        </button>
        <button
          type="button"
          className="toolbar-button"
          onClick={() => void onDismiss().catch(() => undefined)}
        >
          {t('dismissUpdateNotice')}
        </button>
      </div>
    </aside>
  );
}
