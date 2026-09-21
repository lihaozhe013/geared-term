import { useCallback, useState } from 'react';
import type { SettingsRecord, SshTerminalRequest } from '@geared-term/protocol';
import { useModalFocus } from './useModalFocus';
import { translate } from './i18n';
import type { MessageKey } from './i18n';

type QuickSshDialogProps = {
  defaultTerm: SshTerminalRequest['term'];
  language: SettingsRecord['language'];
  onConnect: (request: SshTerminalRequest, name: string) => void;
  onClose: () => void;
};

export function QuickSshDialog({
  defaultTerm,
  language,
  onConnect,
  onClose
}: QuickSshDialogProps): React.JSX.Element {
  const t = useCallback((key: MessageKey): string => translate(language, key), [language]);
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [term, setTerm] = useState(defaultTerm);
  const [error, setError] = useState<string | null>(null);
  const { containerRef } = useModalFocus<HTMLFormElement>();

  const connect = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    try {
      const normalizedHost = host.trim();
      const normalizedUser = username.trim();
      const normalizedPort = Number(port);
      if (!normalizedHost || !normalizedUser) throw new Error(t('errSshHostUserRequired'));
      if (!Number.isInteger(normalizedPort) || normalizedPort < 1 || normalizedPort > 65535) {
        throw new Error(t('errSshPortRange'));
      }
      if (!password && !privateKey) throw new Error(t('errSshCredentialRequired'));
      const request: SshTerminalRequest = {
        sessionId: crypto.randomUUID(),
        host: normalizedHost,
        port: normalizedPort,
        username: normalizedUser,
        term,
        cols: 80,
        rows: 24,
        ...(password ? { password } : {}),
        ...(privateKey ? { privateKey } : {}),
        ...(passphrase ? { passphrase } : {})
      };
      onConnect(request, `${normalizedUser}@${normalizedHost}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('errOpenSsh'));
    }
  };

  return (
    <div className="settings-backdrop" role="presentation">
      <form
        ref={containerRef}
        className="settings-panel profile-editor quick-ssh-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-ssh-title"
        onSubmit={connect}
      >
        <div className="settings-header">
          <div>
            <p className="section-label">{t('quickSshSection')}</p>
            <h2 id="quick-ssh-title">{t('quickSshTitle')}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            data-modal-cancel
            aria-label="Close SSH dialog"
          >
            ×
          </button>
        </div>
        <div className="profile-editor-body">
          <p className="muted quick-ssh-note">{t('quickSshNote')}</p>
          <div className="settings-grid">
            <label>
              {t('labelHost')}
              <input
                value={host}
                onChange={(event) => setHost(event.target.value)}
                autoFocus
                placeholder="server.example.com"
              />
            </label>
            <label>
              {t('labelPort')}
              <input
                type="number"
                min="1"
                max="65535"
                value={port}
                onChange={(event) => setPort(event.target.value)}
              />
            </label>
            <label>
              {t('labelUser')}
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="operator"
              />
            </label>
            <label>
              {t('labelTerminalType')}
              <select
                value={term}
                onChange={(event) => setTerm(event.target.value as SshTerminalRequest['term'])}
              >
                <option value="xterm-256color">xterm-256color</option>
                <option value="xterm">xterm</option>
                <option value="vt520">vt520</option>
                <option value="linux">linux</option>
                <option value="screen">screen</option>
              </select>
            </label>
            <label>
              {t('labelPassword')}
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <label>
              {t('labelKeyPassphraseOptional')}
              <input
                type="password"
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
              />
            </label>
            <label className="profile-editor-wide">
              {t('labelPrivateKeyOptional')}
              <textarea
                value={privateKey}
                onChange={(event) => setPrivateKey(event.target.value)}
                rows={6}
                placeholder={t('placeholderPrivateKey')}
              />
            </label>
          </div>
          {error ? <p className="settings-error error">{error}</p> : null}
        </div>
        <div className="settings-actions">
          <button type="button" className="toolbar-button" onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="submit" className="primary-button profile-save">
            {t('connect')}
          </button>
        </div>
      </form>
    </div>
  );
}
