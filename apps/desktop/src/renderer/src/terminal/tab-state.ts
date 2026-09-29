import type { SshFailureCode, TerminalPortMessage } from '@geared-term/protocol';

export type TerminalTabState = {
  status: 'starting' | 'awaiting-user' | 'running' | 'exited' | 'failed' | 'closed';
  failureCode?: SshFailureCode;
};

type StateMessage = Extract<TerminalPortMessage, { kind: 'state' }>;

export function applyTerminalTabState<T extends TerminalTabState>(
  tab: T,
  message: StateMessage,
  isSsh: boolean
): T {
  if (tab.status === 'failed' && message.state !== 'failed') return tab;
  if (
    isSsh &&
    tab.status === 'exited' &&
    (message.state === 'closing' || message.state === 'closed')
  ) {
    return tab;
  }

  return {
    ...tab,
    status:
      message.state === 'closing'
        ? 'closed'
        : message.state === 'created'
          ? 'starting'
          : message.state,
    ...(message.state === 'failed'
      ? { failureCode: message.errorCode ?? (isSsh ? 'unexpected' : undefined) }
      : {})
  };
}
