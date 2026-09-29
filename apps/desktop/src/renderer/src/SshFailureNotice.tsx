import { CircleAlert } from 'lucide-react';
import type { SshFailureCode, SettingsRecord } from '@geared-term/protocol';
import { translate } from './i18n';

const failureMessages: Record<SshFailureCode, Parameters<typeof translate>[1]> = {
  'connection-failed': 'sshErrorConnectionFailed',
  'connection-lost': 'sshErrorConnectionLost',
  'keepalive-timeout': 'sshErrorKeepaliveTimeout',
  'remote-channel-closed': 'sshErrorRemoteChannelClosed',
  'authentication-failed': 'sshErrorAuthenticationFailed',
  'host-key-failed': 'sshErrorHostKeyFailed',
  'shell-request-failed': 'sshErrorShellRequestFailed',
  unexpected: 'sshErrorUnexpected'
};

type Props = {
  code: SshFailureCode;
  language: SettingsRecord['language'];
  onClose: () => void;
};

export function SshFailureNotice({ code, language, onClose }: Props): React.JSX.Element {
  return (
    <section className="ssh-failure-notice" role="alert">
      <CircleAlert className="ssh-failure-icon" size={18} aria-hidden="true" />
      <div className="ssh-failure-copy">
        <strong>{translate(language, 'sshErrorTitle')}</strong>
        <p>{translate(language, failureMessages[code])}</p>
      </div>
      <button type="button" className="toolbar-button" onClick={onClose}>
        {translate(language, 'close')}
      </button>
    </section>
  );
}
