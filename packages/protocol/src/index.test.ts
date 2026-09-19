import { describe, expect, it } from 'vitest';
import { AppInfoSchema, TerminalPortMessageSchema } from './index';

describe('protocol schemas', () => {
  it('accepts app information', () => {
    const result = AppInfoSchema.safeParse({
      name: 'Geared Term',
      version: '0.1.0',
      isPackaged: false,
      platform: 'win32'
    });
    expect(result.success).toBe(true);
  });

  it('rejects an untrusted terminal message shape', () => {
    const result = TerminalPortMessageSchema.safeParse({
      kind: 'output',
      sessionId: '../escape',
      sequence: -1,
      chunk: 42
    });
    expect(result.success).toBe(false);
  });
});
