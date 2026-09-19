import { useState } from 'react';
import type { SshTerminalRequest } from '@geared-term/protocol';
import { useModalFocus } from './useModalFocus';

type QuickSshDialogProps = {
  defaultTerm: SshTerminalRequest['term'];
  onConnect: (request: SshTerminalRequest, name: string) => void;
  onClose: () => void;
};

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'Unable to open SSH connection';
}

export function QuickSshDialog({
  defaultTerm,
  onConnect,
  onClose
}: QuickSshDialogProps): React.JSX.Element {
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
      if (!normalizedHost || !normalizedUser) throw new Error('SSH host and user are required');
      if (!Number.isInteger(normalizedPort) || normalizedPort < 1 || normalizedPort > 65535) {
        throw new Error('SSH port must be a valid number between 1 and 65535');
      }
      if (!password && !privateKey) throw new Error('Password or private key is required');
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
      setError(errorMessage(reason));
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
            <p className="section-label">Temporary connection</p>
            <h2 id="quick-ssh-title">Connect with SSH</h2>
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
          <p className="muted quick-ssh-note">
            This connection is not saved. Credentials remain in memory for the lifetime of the tab.
          </p>
          <div className="settings-grid">
            <label>
              Host
              <input
                value={host}
                onChange={(event) => setHost(event.target.value)}
                autoFocus
                placeholder="server.example.com"
              />
            </label>
            <label>
              Port
              <input
                type="number"
                min="1"
                max="65535"
                value={port}
                onChange={(event) => setPort(event.target.value)}
              />
            </label>
            <label>
              User
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="operator"
              />
            </label>
            <label>
              Terminal type
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
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <label>
              Private-key passphrase (optional)
              <input
                type="password"
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
              />
            </label>
            <label className="profile-editor-wide">
              Private key (optional)
              <textarea
                value={privateKey}
                onChange={(event) => setPrivateKey(event.target.value)}
                rows={6}
                placeholder="Paste an OpenSSH private key"
              />
            </label>
          </div>
          {error ? <p className="settings-error error">{error}</p> : null}
        </div>
        <div className="settings-actions">
          <button type="button" className="toolbar-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary-button profile-save">
            Connect
          </button>
        </div>
      </form>
    </div>
  );
}
