import { describe, expect, it } from 'vitest';
import { buildChatCompletionsPayload, normalizeEndpoint } from './endpoint';
import { mapChatCompletionEvent, parseSseFrame, splitSseBuffer } from './stream';

describe('AI endpoint safety', () => {
  it('normalizes HTTPS endpoints and rejects unsafe remote HTTP', () => {
    expect(normalizeEndpoint('https://api.example.test/v1/', 'chat-completions').requestUrl).toBe(
      'https://api.example.test/v1/chat/completions'
    );
    expect(() => normalizeEndpoint('http://api.example.test/v1', 'responses')).toThrow('HTTPS');
  });

  it('allows loopback HTTP without preserving query or credentials', () => {
    expect(() =>
      normalizeEndpoint('http://user:pass@localhost:3000/v1?key=secret', 'responses')
    ).toThrow('credentials');
  });

  it('builds a streaming payload without a provider key', () => {
    expect(buildChatCompletionsPayload('model', [{ role: 'user', content: 'hello' }])).toEqual({
      model: 'model',
      messages: [{ role: 'user', content: 'hello' }],
      stream: true
    });
  });
});

describe('SSE parsing', () => {
  it('splits frames and maps content deltas', () => {
    const split = splitSseBuffer('data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata:');
    expect(split.frames).toHaveLength(1);
    expect(mapChatCompletionEvent(parseSseFrame(split.frames[0]!))).toEqual({
      kind: 'delta',
      text: 'hi'
    });
  });
});
