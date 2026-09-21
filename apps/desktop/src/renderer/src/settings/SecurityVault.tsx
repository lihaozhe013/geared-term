import { useEffect, useState } from 'react';
import type { AutoUnlockStatus, VaultStatus } from '@geared-term/protocol';
import { Lock, Unlock } from 'lucide-react';
import { Row, Section } from './primitives';
import type { Translate } from './sections';

export function SecurityVaultSection({ t }: { t: Translate }): React.JSX.Element {
  const [vault, setVault] = useState<VaultStatus | null>(null);
  const [autoUnlock, setAutoUnlock] = useState<AutoUnlockStatus | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void window.geared
      .getVaultStatus()
      .then(setVault)
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : t('errVaultStatus'))
      );
    void window.geared
      .getAutoUnlockStatus()
      .then(setAutoUnlock)
      .catch(() => undefined);
    return window.geared.onVaultChanged(setVault);
  }, []);

  const run = async (action: () => Promise<VaultStatus>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const next = await action();
      setVault(next);
      setStatus(next.unlocked ? t('vaultUnlocked') : t('vaultLocked'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('errVaultOperation'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title={t('groupSecurity')}>
      <p className="settings-hint">
        {vault
          ? !vault.initialized
            ? t('vaultNotInitialized')
            : vault.unlocked
              ? t('vaultUnlocked')
              : t('vaultLocked')
          : ''}
      </p>

      {vault && !vault.initialized ? (
        <>
          <Row label={t('masterPassword')}>
            <input
              className="settings-input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
            />
          </Row>
          <Row label={t('confirmMasterPassword')}>
            <input
              className="settings-input"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
            />
          </Row>
          <div className="settings-actions-row">
            <button
              type="button"
              className="primary-button settings-apply"
              disabled={busy || !password || password !== confirmPassword}
              onClick={() => {
                if (password !== confirmPassword) {
                  setError(t('passwordMismatch'));
                  return;
                }
                void run(() => window.geared.initializeVault({ password })).then(() => {
                  setPassword('');
                  setConfirmPassword('');
                });
              }}
            >
              {t('createVault')}
            </button>
          </div>
        </>
      ) : null}

      {vault && vault.initialized && !vault.unlocked ? (
        <>
          <Row label={t('masterPassword')}>
            <input
              className="settings-input"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
          </Row>
          <div className="settings-actions-row">
            <button
              type="button"
              className="primary-button settings-apply"
              disabled={busy || !password}
              onClick={() => {
                void run(() => window.geared.unlockVault({ password })).then(() => setPassword(''));
              }}
            >
              <Unlock size={13} aria-hidden="true" /> {t('unlockVaultLabel')}
            </button>
          </div>
        </>
      ) : null}

      {vault && vault.initialized && vault.unlocked ? (
        <>
          <div className="settings-actions-row">
            <button
              type="button"
              className="toolbar-button"
              disabled={busy}
              onClick={() => void run(() => window.geared.lockVault())}
            >
              <Lock size={13} aria-hidden="true" /> {t('lock')}
            </button>
          </div>
          <p className="settings-subheading">{t('changeMasterPassword')}</p>
          <Row label={t('currentPassword')}>
            <input
              className="settings-input"
              type="password"
              value={oldPassword}
              onChange={(event) => setOldPassword(event.target.value)}
              autoComplete="current-password"
            />
          </Row>
          <Row label={t('newPassword')}>
            <input
              className="settings-input"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              autoComplete="new-password"
            />
          </Row>
          <div className="settings-actions-row">
            <button
              type="button"
              className="primary-button settings-apply"
              disabled={busy || !oldPassword || !newPassword}
              onClick={() => {
                void run(() => window.geared.rotateVault({ oldPassword, newPassword })).then(() => {
                  setOldPassword('');
                  setNewPassword('');
                });
              }}
            >
              {t('changeMasterPassword')}
            </button>
          </div>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={Boolean(autoUnlock?.enabled)}
              disabled={!autoUnlock?.supported || busy}
              onChange={(event) => {
                const next = event.target.checked;
                setBusy(true);
                const action = next
                  ? window.geared.enableAutoUnlock()
                  : window.geared.disableAutoUnlock();
                void action
                  .then(setAutoUnlock)
                  .catch((reason: unknown) =>
                    setError(reason instanceof Error ? reason.message : t('errVaultOperation'))
                  )
                  .finally(() => setBusy(false));
              }}
            />
            <span>{t('autoUnlock')}</span>
          </label>
          <p className="settings-hint">
            {autoUnlock && !autoUnlock.supported ? t('autoUnlockUnsupported') : t('autoUnlockHint')}
          </p>
        </>
      ) : null}

      {status ? <p className="settings-status status-ok">{status}</p> : null}
      {error ? <p className="settings-status status-error">{error}</p> : null}
    </Section>
  );
}
