import { useEffect, useRef, useState } from 'react';
import type { SettingsRecord, VaultStatus } from '@geared-term/protocol';
import { KeyRound, Loader2, Lock } from 'lucide-react';
import { translate } from './i18n';

type VaultGateProps = {
  status: VaultStatus;
  language: SettingsRecord['language'];
  onStatusChange: (status: VaultStatus) => void;
};

export function VaultGate({ status, language, onStatusChange }: VaultGateProps): React.JSX.Element {
  const t = (key: Parameters<typeof translate>[1]): string => translate(language, key);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<HTMLInputElement | null>(null);
  const firstRun = !status.initialized;

  useEffect(() => {
    passwordRef.current?.focus();
  }, [firstRun]);

  const submit = (): void => {
    if (busy) return;
    setError(null);
    if (firstRun && password !== confirmPassword) {
      setError(t('passwordMismatch'));
      return;
    }
    if (!password) {
      setError(t('masterPassword'));
      return;
    }
    setBusy(true);
    const action = firstRun
      ? window.geared.initializeVault({ password })
      : window.geared.unlockVault({ password });
    void action
      .then((next) => {
        onStatusChange(next);
        setPassword('');
        setConfirmPassword('');
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : 'Vault operation failed');
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="vault-gate" role="dialog" aria-modal="true" aria-label={t('gateUnlockTitle')}>
      <div className="vault-gate-card">
        <div className="vault-gate-icon">
          {firstRun ? (
            <KeyRound size={18} aria-hidden="true" />
          ) : (
            <Lock size={18} aria-hidden="true" />
          )}
        </div>
        <h2 className="vault-gate-title">{t(firstRun ? 'gateSetupTitle' : 'gateUnlockTitle')}</h2>
        <p className="vault-gate-hint">{t(firstRun ? 'gateSetupHint' : 'gateUnlockHint')}</p>
        <form
          className="vault-gate-form"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <input
            ref={passwordRef}
            className="settings-input vault-gate-password"
            type="password"
            placeholder={t('masterPassword')}
            aria-label={t('masterPassword')}
            value={password}
            autoComplete={firstRun ? 'new-password' : 'current-password'}
            disabled={busy}
            onChange={(event) => setPassword(event.target.value)}
          />
          {firstRun ? (
            <input
              className="settings-input vault-gate-confirm"
              type="password"
              placeholder={t('confirmMasterPassword')}
              aria-label={t('confirmMasterPassword')}
              value={confirmPassword}
              autoComplete="new-password"
              disabled={busy}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          ) : null}
          {error ? (
            <p className="settings-status status-error" role="alert">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            className="primary-button vault-gate-submit"
            disabled={busy || password.length === 0 || (firstRun && confirmPassword.length === 0)}
          >
            {busy ? (
              <>
                <span className="activity-spinner">
                  <Loader2 size={13} aria-hidden="true" />
                </span>{' '}
                {t('gateDeriving')}
              </>
            ) : (
              t(firstRun ? 'gateCreate' : 'gateUnlock')
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
