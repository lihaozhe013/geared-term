import { describe, expect, it } from 'vitest';
import type { SshFailureCode, TerminalPortMessage } from '@geared-term/protocol';
import { applyTerminalTabState } from './tab-state';

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
