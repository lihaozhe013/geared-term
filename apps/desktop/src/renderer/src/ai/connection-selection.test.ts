import { describe, expect, it } from 'vitest';
import type { AiConnectionRecord } from '@geared-term/protocol';
import {
  moveArrayItem,
  resolveActiveAiConnectionId,
  resolveDefaultAiConnectionId
} from './connection-selection';

function connection(id: string): AiConnectionRecord {
  return {
    id,
    name: id,
    protocol: 'responses',
    baseUrl: 'https://example.test/v1',
    models: [{ id: `${id}-model`, model: `${id}-model` }],
    defaultModel: `${id}-model`
  };
}

describe('AI connection selection', () => {
  const connections = [connection('first'), connection('second')];

  it('prefers a configured default and falls back to the first connection', () => {
    expect(resolveDefaultAiConnectionId(connections, 'second')).toBe('second');
    expect(resolveDefaultAiConnectionId(connections, 'missing')).toBe('first');
    expect(resolveDefaultAiConnectionId([], 'missing')).toBeNull();
  });

  it('keeps a valid manual selection ahead of the configured default', () => {
    expect(resolveActiveAiConnectionId(connections, 'first', 'second')).toBe('first');
    expect(resolveActiveAiConnectionId(connections, 'missing', 'second')).toBe('second');
    expect(resolveActiveAiConnectionId(connections, null, null)).toBe('first');
  });
});

describe('AI model ordering', () => {
  it('moves items without changing their values', () => {
    const models = [
      { id: 'first', default: false },
      { id: 'second', default: true },
      { id: 'third', default: false }
    ];

    expect(moveArrayItem(models, 2, -1).map((model) => model.id)).toEqual([
      'first',
      'third',
      'second'
    ]);
    expect(moveArrayItem(models, 1, -1).map((model) => model.id)).toEqual([
      'second',
      'first',
      'third'
    ]);
    expect(moveArrayItem(models, 0, -1)).toBe(models);
    expect(moveArrayItem(models, 2, 1)).toBe(models);
    expect(moveArrayItem(models, 1, -1)[0]?.default).toBe(true);
  });
});
