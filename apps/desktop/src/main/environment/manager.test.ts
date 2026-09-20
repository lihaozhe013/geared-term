import { describe, expect, it, vi } from 'vitest';
import type { EnvironmentRecord, LocalTerminalRequest } from '@geared-term/protocol';
import type { Logger } from '../logging';
import type { AppStorage } from '../persistence/app-storage';
import { EnvironmentManager } from './manager';

function logger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  } as unknown as Logger;
}

describe('environment manager', () => {
  it('auto-probes local sessions, preserves legacy context, and attaches new records', async () => {
    let environments: EnvironmentRecord[] = [
      {
        id: 'legacy-environment',
        targetKey: 'local',
        kind: 'local',
        facts: { os: 'Legacy OS' },
        notes: 'Keep these notes',
        instructions: 'Keep these instructions',
        attachToAi: false,
        verified: true,
        detectedAt: null
      }
    ];
    const storage = {
      environmentSnapshot: () => environments,
      saveEnvironment: vi.fn(async (record: EnvironmentRecord) => {
        environments = [record];
        return environments;
      })
    } as unknown as AppStorage;
    const manager = new EnvironmentManager(storage, logger());
    const request = {
      sessionId: 'session-1',
      shell: '/bin/sh',
      args: [],
      cwd: process.cwd(),
      cols: 80,
      rows: 24,
      term: 'xterm-256color'
    } as LocalTerminalRequest;

    manager.onLocalReady({
      sessionId: 'session-1',
      shell: '/bin/sh',
      cwd: process.cwd(),
      environment: { SHELL: '/bin/sh' },
      request
    });

    await vi.waitFor(() => expect(environments[0]?.targetKey).toBe('local:session-1'), {
      timeout: 2_000
    });
    expect(environments[0]).toMatchObject({
      id: 'legacy-environment',
      kind: 'local',
      attachToAi: false,
      verified: false,
      notes: 'Keep these notes',
      instructions: 'Keep these instructions'
    });
    expect(environments[0]?.facts.shell).toBe('/bin/sh');
  });
});
