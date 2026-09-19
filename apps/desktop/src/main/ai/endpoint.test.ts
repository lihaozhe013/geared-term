import { describe, expect, it } from 'vitest';
import { buildChatCompletionsPayload, buildResponsesPayload, normalizeEndpoint } from './endpoint';
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

  it('converts pasted endpoint links and bare hosts automatically', () => {
    expect(normalizeEndpoint('https://api.openai.com', 'responses').requestUrl).toBe(
      'https://api.openai.com/v1/responses'
    );
    expect(
      normalizeEndpoint('https://api.openai.com/v1/chat/completions', 'responses').requestUrl
    ).toBe('https://api.openai.com/v1/responses');
    expect(
      normalizeEndpoint('https://api.openai.com/v1/responses', 'chat-completions').baseUrl
    ).toBe('https://api.openai.com/v1');
    expect(normalizeEndpoint('https://api.openai.com/v1/models', 'responses').requestUrl).toBe(
      'https://api.openai.com/v1/responses'
    );
    expect(normalizeEndpoint('http://127.0.0.1:11434', 'responses').requestUrl).toBe(
      'http://127.0.0.1:11434/v1/responses'
    );
  });

  it('keeps custom path prefixes and exposes the models URL', () => {
    const endpoint = normalizeEndpoint('https://gateway.example.test/llm/', 'responses');
    expect(endpoint.baseUrl).toBe('https://gateway.example.test/llm');
    expect(endpoint.requestUrl).toBe('https://gateway.example.test/llm/responses');
    expect(endpoint.modelsUrl).toBe('https://gateway.example.test/llm/models');
  });

  it('builds a streaming payload without a provider key', () => {
    expect(buildChatCompletionsPayload('model', [{ role: 'user', content: 'hello' }])).toEqual({
      model: 'model',
      messages: [{ role: 'user', content: 'hello' }],
      stream: true
    });
  });

  it('lifts system messages into responses instructions', () => {
    expect(
      buildResponsesPayload('model', [
        { role: 'system', content: 'be terse' },
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
        { role: 'user', content: 'bye' }
      ])
    ).toEqual({
      model: 'model',
      instructions: 'be terse',
      input: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
        { role: 'user', content: 'bye' }
      ],
      stream: true,
      store: false
    });
    expect(buildResponsesPayload('model', [{ role: 'user', content: 'hi' }])).toEqual({
      model: 'model',
      input: [{ role: 'user', content: 'hi' }],
      stream: true,
      store: false
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
