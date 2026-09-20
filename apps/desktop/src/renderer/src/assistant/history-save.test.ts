import { describe, expect, it } from 'vitest';
import { AiHistorySaveRequestSchema } from '@geared-term/protocol';
import { buildHistoryEntry, type HistoryMessageInput } from './history-save';

const base = {
  id: 'b65fd951-baf9-460b-b80e-2f756baceb98',
  reasoning: '',
  sources: [] as Array<{ url: string; title?: string }>
};

function user(content: string): HistoryMessageInput {
  return { role: 'user', content };
}

function assistant(overrides: Partial<HistoryMessageInput> = {}): HistoryMessageInput {
  return { role: 'assistant', content: 'answer', ...overrides };
}

describe('buildHistoryEntry', () => {
  it('persists a conversation the moment the prompt is sent', () => {
    const entry = buildHistoryEntry({
      ...base,
      messages: [user('check the logs'), { role: 'assistant', content: '' }]
    });
    expect(entry.messages).toHaveLength(1);
    expect(entry.messages[0]).toEqual({ role: 'user', content: 'check the logs' });
    expect(entry.title).toBe('check the logs');
  });

  it('maps usage fields onto the last assistant message', () => {
    const entry = buildHistoryEntry({
      ...base,
      messages: [user('q'), assistant({ usage: { input: 12, output: 34, reasoning: 5 } })]
    });
    const last = entry.messages.at(-1);
    expect(last?.usage).toEqual({ inputTokens: 12, outputTokens: 34, reasoningTokens: 5 });
  });

  it('attaches reasoning, sources, and continuation only to the last assistant message', () => {
    const continuation = { connectionId: 'conn-1', model: 'gpt-test', items: [] };
    const entry = buildHistoryEntry({
      ...base,
      model: 'gpt-test',
      reasoning: 'thinking out loud',
      sources: [{ url: 'https://example.test/docs' }],
      messages: [
        user('q1'),
        assistant({ continuation, usage: { input: 1, output: 2 } }),
        user('q2'),
        assistant()
      ]
    });
    expect(entry.model).toBe('gpt-test');
    expect(entry.messages[1]).not.toHaveProperty('continuation');
    expect(entry.messages[1]).not.toHaveProperty('reasoning');
    const last = entry.messages.at(-1);
    expect(last?.reasoning).toBe('thinking out loud');
    expect(last?.sources).toEqual([{ url: 'https://example.test/docs' }]);
    expect(last?.continuation).toBeUndefined();
  });

  it('keeps the stored continuation metadata clean for the next request', () => {
    const entry = buildHistoryEntry({
      ...base,
      messages: [
        user('q'),
        assistant({
          continuation: {
            connectionId: 'conn-1',
            model: 'gpt-test',
            items: [{ type: 'reasoning' }]
          }
        })
      ]
    });
    expect(() => AiHistorySaveRequestSchema.parse(entry)).not.toThrow();
  });

  it('rejects stream-event-shaped continuation metadata', () => {
    expect(() =>
      buildHistoryEntry({
        ...base,
        messages: [
          user('q'),
          assistant({
            continuation: {
              kind: 'continuation',
              connectionId: 'conn-1',
              model: 'gpt-test',
              items: []
            } as unknown as HistoryMessageInput['continuation']
          })
        ]
      })
    ).toThrow();
  });
});
