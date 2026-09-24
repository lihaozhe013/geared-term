import { useCallback, useState } from 'react';
import type { SettingsRecord } from '@geared-term/protocol';
import { useModalFocus } from './useModalFocus';
import { translate } from './i18n';
import type { MessageKey } from './i18n';

type CreateGroupDialogProps = {
  language: SettingsRecord['language'];
  onCreate: (name: string) => Promise<void>;
  onClose: () => void;
};

export function CreateGroupDialog({
  language,
  onCreate,
  onClose
}: CreateGroupDialogProps): React.JSX.Element {
  const t = useCallback((key: MessageKey): string => translate(language, key), [language]);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { containerRef } = useModalFocus<HTMLFormElement>();

  const save = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const normalizedName = name.trim();
    if (!normalizedName) {
      setError(t('errGroupNameRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onCreate(normalizedName);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('errCreateGroup'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-backdrop" role="presentation">
      <form
        ref={containerRef}
        className="settings-panel profile-editor group-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-group-title"
        onSubmit={(event) => void save(event)}
      >
        <div className="settings-header">
          <div>
            <p className="section-label">{t('sessions')}</p>
            <h2 id="create-group-title">{t('createEmptyGroup')}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            data-modal-cancel
            aria-label={t('close')}
          >
            ×
          </button>
        </div>
        <div className="profile-editor-body">
          <label className="group-name-label">
            {t('groupName')}
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={160}
              autoFocus
            />
          </label>
          {error ? (
            <p className="settings-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <div className="settings-actions">
          <button
            type="button"
            className="toolbar-button"
            onClick={onClose}
            data-modal-cancel
            disabled={busy}
          >
            {t('cancel')}
          </button>
          <button type="submit" className="primary-button settings-save" disabled={busy}>
            {busy ? t('saving') : t('createGroup')}
          </button>
        </div>
      </form>
    </div>
  );
}
