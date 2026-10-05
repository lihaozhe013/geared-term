// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { resolveNewTabTarget } from './new-tab';
import type { SessionProfileRecord } from '@geared-term/protocol';

const localProfile: SessionProfileRecord = {
  id: 'local-1',
  kind: 'local',
  name: 'Local',
  term: 'xterm-256color'
};

const sshProfile: SessionProfileRecord = {
  id: 'ssh-1',
  kind: 'ssh',
  name: 'Remote',
  term: 'xterm-256color',
  host: 'example.com',
  user: 'alice',
  secretRefs: { password: 'secret-1' }
};

describe('resolveNewTabTarget', () => {
  it('resolves null to a local shell', () => {
    expect(resolveNewTabTarget(null, [localProfile])).toEqual({ kind: 'local' });
  });

  it('falls back to a local shell when the id no longer exists', () => {
    expect(resolveNewTabTarget('deleted', [localProfile, sshProfile])).toEqual({ kind: 'local' });
  });
});
