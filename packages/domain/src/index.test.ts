import { describe, expect, it } from 'vitest';
import { canTransition, normalizeSessionName, transitionSession } from './index';

describe('session state machine', () => {
  it('accepts the normal startup path', () => {
    expect(canTransition('created', 'starting')).toBe(true);
    expect(transitionSession('starting', 'running')).toBe('running');
  });

  it('rejects reopening a closed session', () => {
    expect(() => transitionSession('closed', 'running')).toThrow('Invalid session transition');
  });
});

describe('session names', () => {
  it('uses a stable local fallback', () => {
    expect(normalizeSessionName('local', '  ', 'PowerShell')).toBe('PowerShell');
  });
});
