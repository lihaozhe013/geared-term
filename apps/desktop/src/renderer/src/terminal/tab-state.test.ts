import { describe, expect, it } from 'vitest';
import type { SshFailureCode, TerminalPortMessage } from '@geared-term/protocol';
import { applyTerminalTabState, shouldAutoCloseTerminalTab } from './tab-state';

const tab = { status: 'running' as const };

type TerminalState = Extract<TerminalPortMessage, { kind: 'state' }>['state'];

function state(state: TerminalState, errorCode?: SshFailureCode) {
  return {
    kind: 'state' as const,
    sessionId: 'ssh-1',
    sequence: 1,
    state,
    ...(errorCode ? { errorCode } : {})
  };
}

describe('applyTerminalTabState', () => {
  it('keeps a failure and its reason when cleanup states arrive afterward', () => {
    const failed = applyTerminalTabState(tab, state('failed', 'keepalive-timeout'), true);
    expect(failed).toEqual({ status: 'failed', failureCode: 'keepalive-timeout' });
    expect(applyTerminalTabState(failed, state('closing'), true)).toBe(failed);
    expect(applyTerminalTabState(failed, state('closed'), true)).toBe(failed);
  });

  it('retains the final SSH exit state after the connection closes', () => {
    const exited = applyTerminalTabState(tab, state('exited'), true);
    expect(exited.status).toBe('exited');
    expect(applyTerminalTabState(exited, state('closed'), true)).toBe(exited);
  });

  it('leaves local close handling available to its existing lifecycle', () => {
    expect(applyTerminalTabState(tab, state('closed'), false).status).toBe('closed');
  });
});

describe('shouldAutoCloseTerminalTab', () => {
  it('closes a running tab after an exit report regardless of exit status', () => {
    expect(shouldAutoCloseTerminalTab(tab, { ...state('exited'), detail: 'exitCode=23' })).toBe(
      true
    );
  });

  it('keeps a failed SSH tab even if a late exit report arrives', () => {
    expect(
      shouldAutoCloseTerminalTab({ status: 'failed' }, { ...state('exited'), detail: 'exitCode=0' })
    ).toBe(false);
  });

  it('does not close a tab on intermediate or failure states', () => {
    expect(shouldAutoCloseTerminalTab(tab, state('running'))).toBe(false);
    expect(shouldAutoCloseTerminalTab(tab, state('failed', 'connection-lost'))).toBe(false);
  });
});
