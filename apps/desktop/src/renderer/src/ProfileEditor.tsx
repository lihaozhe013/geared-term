import { useCallback, useMemo, useState } from 'react';
import { useModalFocus } from './useModalFocus';
import { translate } from './i18n';
import type { MessageKey } from './i18n';
import type { SessionProfileRecord, SettingsRecord } from '@geared-term/protocol';

type ProfileEditorProps = {
  profile?: SessionProfileRecord;
  initialKind: SessionProfileRecord['kind'];
  defaultTerm: SessionProfileRecord['term'];
  language: SettingsRecord['language'];
  onSaved: (profiles: SessionProfileRecord[]) => void;
  onClose: () => void;
  onError: (message: string) => void;
};

type ProfileDraft = {
  id: string;
  kind: SessionProfileRecord['kind'];
  name: string;
  group: string;
  term: SessionProfileRecord['term'];
  shell: string;
  args: string;
  cwd: string;
  distribution: string;
  host: string;
  port: string;
  user: string;
  password: string;
  privateKey: string;
  passphrase: string;
  clearCredentials: boolean;
};

function createDraft(
  profile: SessionProfileRecord | undefined,
  defaultTerm: ProfileDraft['term'],
  defaultName: string,
  initialKind: ProfileDraft['kind']
): ProfileDraft {
  return {
    id: profile?.id ?? crypto.randomUUID(),
    kind: profile?.kind ?? initialKind,
    name: profile?.name ?? defaultName,
    group: profile?.group ?? '',
    term: profile?.term ?? defaultTerm,
    shell: profile?.shell ?? '',
    args: profile?.args?.join('\n') ?? '',
    cwd: profile?.cwd ?? '',
    distribution: profile?.distribution ?? '',
    host: profile?.host ?? '',
    port: profile?.port ? String(profile.port) : '22',
    user: profile?.user ?? '',
    password: '',
    privateKey: '',
    passphrase: '',
    clearCredentials: false
  };
}

function asError(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

export function ProfileEditor({
  profile,
  initialKind,
  defaultTerm,
  language,
  onSaved,
  onClose,
  onError
}: ProfileEditorProps): React.JSX.Element {
  const t = useCallback((key: MessageKey): string => translate(language, key), [language]);
  const [draft, setDraft] = useState<ProfileDraft>(() =>
    createDraft(profile, defaultTerm, translate(language, 'profileDefaultName'), initialKind)
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { containerRef } = useModalFocus<HTMLFormElement>();

  const isSsh = draft.kind === 'ssh';
  const savedCredentialLabels = useMemo(() => {
    if (!profile?.secretRefs) return [];
    return Object.entries(profile.secretRefs)
      .filter(([, value]) => Boolean(value))
      .map(([key]) => key);
  }, [profile?.secretRefs]);

  const update = <K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]): void => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const save = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const name = draft.name.trim();
      if (!name) throw new Error(t('errProfileNameRequired'));
      const profileInput: SessionProfileRecord = {
        id: draft.id,
        kind: draft.kind,
        name,
        ...(draft.group.trim() ? { group: draft.group.trim() } : {}),
        term: draft.term,
        ...(draft.kind === 'local'
          ? {
              ...(draft.shell.trim() ? { shell: draft.shell.trim() } : {}),
              ...(draft.cwd.trim() ? { cwd: draft.cwd.trim() } : {}),
              args: draft.args.split(/\r?\n/).filter((arg) => arg.length > 0)
            }
          : {}),
        ...(draft.kind === 'wsl'
          ? {
              distribution: draft.distribution.trim(),
              ...(draft.user.trim() ? { user: draft.user.trim() } : {}),
              ...(draft.cwd.trim() ? { cwd: draft.cwd.trim() } : {})
            }
          : {}),
        ...(draft.kind === 'ssh'
          ? {
              host: draft.host.trim(),
              port: Number(draft.port),
              user: draft.user.trim()
            }
          : {})
      };
      if (draft.kind === 'wsl' && !draft.distribution.trim()) {
        throw new Error(t('errWslDistributionRequired'));
      }
      if (draft.kind === 'ssh' && (!draft.host.trim() || !draft.user.trim())) {
        throw new Error(t('errSshHostUserRequired'));
      }
      if (
        draft.kind === 'ssh' &&
        (!Number.isInteger(Number(draft.port)) || Number(draft.port) < 1)
      ) {
        throw new Error(t('errSshPortPositive'));
      }

      const hasCredentialInput =
        draft.clearCredentials || Boolean(draft.password || draft.privateKey || draft.passphrase);
      const credentials =
        draft.kind === 'ssh' && hasCredentialInput
          ? draft.clearCredentials
            ? { password: '', privateKey: '', passphrase: '' }
            : {
                ...(draft.password ? { password: draft.password } : {}),
                ...(draft.privateKey ? { privateKey: draft.privateKey } : {}),
                ...(draft.passphrase ? { passphrase: draft.passphrase } : {})
              }
          : undefined;
      const saved = await window.geared.saveProfileWithCredentials({
        profile: profileInput,
        ...(credentials ? { credentials } : {})
      });
      onSaved(saved);
      onClose();
    } catch (reason) {
      const message = asError(reason, t('errSaveProfile'));
      setError(message);
      onError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-backdrop" role="presentation">
      <form
        ref={containerRef}
        className="settings-panel profile-editor"
        role="dialog"
        aria-modal="true"
        aria-label="Session profile editor"
        onSubmit={(event) => void save(event)}
      >
        <div className="settings-header">
          <div>
            <p className="section-label">{t('profileSection')}</p>
            <h2>{profile ? t('editSession') : t('newSessionProfile')}</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            data-modal-cancel
            aria-label="Close profile editor"
          >
            ×
          </button>
        </div>

        <div className="profile-editor-body">
          <div className="settings-grid">
            <label>
              {t('labelName')}
              <input
                value={draft.name}
                onChange={(event) => update('name', event.target.value)}
                autoFocus
              />
            </label>
            <label>
              {t('labelKind')}
              <select
                value={draft.kind}
                onChange={(event) => update('kind', event.target.value as ProfileDraft['kind'])}
                disabled={Boolean(profile)}
              >
                <option value="local">{t('profileLocal')}</option>
                <option value="wsl">WSL</option>
                <option value="ssh">SSH</option>
              </select>
            </label>
            <label>
              {t('labelGroup')}
              <input
                value={draft.group}
                onChange={(event) => update('group', event.target.value)}
              />
            </label>
            <label>
              {t('labelTerminalType')}
              <select
                value={draft.term}
                onChange={(event) => update('term', event.target.value as ProfileDraft['term'])}
              >
                <option value="xterm-256color">xterm-256color</option>
                <option value="xterm">xterm</option>
                <option value="vt520">vt520</option>
                <option value="linux">linux</option>
                <option value="screen">screen</option>
              </select>
            </label>
          </div>

          {draft.kind === 'local' ? (
            <div className="profile-editor-section">
              <p className="section-label">{t('profileStartup')}</p>
              <div className="settings-grid">
                <label>
                  {t('labelShellExecutable')}
                  <input
                    value={draft.shell}
                    onChange={(event) => update('shell', event.target.value)}
                    placeholder="pwsh.exe"
                  />
                </label>
                <label>
                  {t('labelWorkingDirectory')}
                  <input
                    value={draft.cwd}
                    onChange={(event) => update('cwd', event.target.value)}
                  />
                </label>
                <label className="profile-editor-wide">
                  {t('labelArguments')}
                  <textarea
                    value={draft.args}
                    onChange={(event) => update('args', event.target.value)}
                    rows={4}
                  />
                </label>
              </div>
            </div>
          ) : null}

          {draft.kind === 'wsl' ? (
            <div className="profile-editor-section">
              <p className="section-label">WSL</p>
              <div className="settings-grid">
                <label>
                  {t('factDistribution')}
                  <input
                    value={draft.distribution}
                    onChange={(event) => update('distribution', event.target.value)}
                    placeholder="Ubuntu"
                  />
                </label>
                <label>
                  {t('labelUserOptional')}
                  <input
                    value={draft.user}
                    onChange={(event) => update('user', event.target.value)}
                  />
                </label>
                <label className="profile-editor-wide">
                  {t('labelWorkingDirectory')}
                  <input
                    value={draft.cwd}
                    onChange={(event) => update('cwd', event.target.value)}
                    placeholder="~"
                  />
                </label>
              </div>
            </div>
          ) : null}

          {isSsh ? (
            <>
              <div className="profile-editor-section">
                <p className="section-label">{t('sectionConnection')}</p>
                <div className="settings-grid">
                  <label>
                    {t('labelHost')}
                    <input
                      value={draft.host}
                      onChange={(event) => update('host', event.target.value)}
                      placeholder="server.example.com"
                    />
                  </label>
                  <label>
                    {t('labelPort')}
                    <input
                      type="number"
                      min="1"
                      max="65535"
                      value={draft.port}
                      onChange={(event) => update('port', event.target.value)}
                    />
                  </label>
                  <label className="profile-editor-wide">
                    {t('labelUser')}
                    <input
                      value={draft.user}
                      onChange={(event) => update('user', event.target.value)}
                    />
                  </label>
                </div>
              </div>
              <div className="profile-editor-section">
                <p className="section-label">{t('sectionCredentials')}</p>
                <p className="settings-hint">
                  {savedCredentialLabels.length > 0
                    ? t('credentialsSavedHint').replace('{refs}', savedCredentialLabels.join(', '))
                    : t('credentialsStoredHint')}
                </p>
                <div className="settings-grid">
                  <label>
                    {t('labelPasswordOptional')}
                    <input
                      type="password"
                      value={draft.password}
                      onChange={(event) => update('password', event.target.value)}
                      placeholder={t('placeholderKeepSaved')}
                      autoComplete="new-password"
                    />
                  </label>
                  <label>
                    {t('labelPassphraseOptional')}
                    <input
                      type="password"
                      value={draft.passphrase}
                      onChange={(event) => update('passphrase', event.target.value)}
                      placeholder={t('placeholderForPrivateKey')}
                      autoComplete="new-password"
                    />
                  </label>
                  <label className="profile-editor-wide">
                    {t('labelPrivateKeyOptional')}
                    <textarea
                      value={draft.privateKey}
                      onChange={(event) => update('privateKey', event.target.value)}
                      rows={5}
                      placeholder={t('placeholderPrivateKeyLong')}
                    />
                  </label>
                  {profile?.secretRefs ? (
                    <label className="settings-checkbox profile-editor-wide">
                      <input
                        type="checkbox"
                        checked={draft.clearCredentials}
                        onChange={(event) => update('clearCredentials', event.target.checked)}
                      />
                      <span>{t('clearCredentialsOnSave')}</span>
                    </label>
                  ) : null}
                </div>
              </div>
            </>
          ) : null}

          {error ? <p className="settings-error error">{error}</p> : null}
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
          <button type="submit" className="primary-button profile-save" disabled={busy}>
            {busy ? t('saving') : t('saveProfile')}
          </button>
        </div>
      </form>
    </div>
  );
}
