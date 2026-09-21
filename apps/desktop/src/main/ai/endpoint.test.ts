import { describe, expect, it } from 'vitest';
import { buildChatCompletionsPayload, buildResponsesPayload, normalizeEndpoint } from './endpoint';
import { mapChatCompletionEvent, mapResponseEvent, parseSseFrame, splitSseBuffer } from './stream';

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
      store: false,
      include: ['reasoning.encrypted_content'],
      reasoning: { summary: 'auto' }
    });
    expect(buildResponsesPayload('model', [{ role: 'user', content: 'hi' }])).toEqual({
      model: 'model',
      input: [{ role: 'user', content: 'hi' }],
      stream: true,
      store: false,
      include: ['reasoning.encrypted_content'],
      reasoning: { summary: 'auto' }
    });
  });

  it('maps non-default Responses options and web search sources', () => {
    expect(
      buildResponsesPayload('reasoning-model', [{ role: 'user', content: 'research this' }], {
        reasoningEffort: 'high',
        verbosity: 'low',
        reasoningSummary: false,
        webSearch: true
      })
    ).toMatchObject({
      model: 'reasoning-model',
      stream: true,
      store: false,
      reasoning: { effort: 'high', summary: 'none' },
      text: { verbosity: 'low' },
      tools: [{ type: 'web_search' }],
      include: ['reasoning.encrypted_content', 'web_search_call.action.sources']
    });
  });

  it('maps an explicit no-summary default without inventing an effort', () => {
    expect(
      buildResponsesPayload('model', [{ role: 'user', content: 'hello' }], {
        reasoningEffort: 'default',
        verbosity: 'default',
        reasoningSummary: false,
        webSearch: false
      })
    ).toMatchObject({ reasoning: { summary: 'none' } });
    expect(
      buildResponsesPayload('model', [{ role: 'user', content: 'hello' }], {
        reasoningEffort: 'default',
        verbosity: 'default',
        reasoningSummary: false,
        webSearch: false
      }).reasoning
    ).not.toHaveProperty('effort');
  });

  it('does not put Responses-only fields on Chat Completions payloads', () => {
    expect(
      buildChatCompletionsPayload('model', [{ role: 'user', content: 'hello' }])
    ).not.toHaveProperty('reasoning');
  });

  it('uses matching provider continuation items for later Responses turns', () => {
    expect(
      buildResponsesPayload(
        'model',
        [
          { role: 'user', content: 'first' },
          {
            role: 'assistant',
            content: 'visible answer',
            continuation: {
              connectionId: 'connection-1',
              model: 'model',
              items: [{ type: 'reasoning', encrypted_content: 'opaque' }]
            }
          },
          { role: 'user', content: 'continue' }
        ],
        undefined,
        'connection-1'
      ).input
    ).toEqual([
      { role: 'user', content: 'first' },
      { type: 'reasoning', encrypted_content: 'opaque' },
      { role: 'user', content: 'continue' }
    ]);
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

  it('maps Responses reasoning, search completion, usage, sources, and continuation', () => {
    expect(
      mapResponseEvent({ type: 'response.reasoning_summary_text.delta', delta: 'plan' })
    ).toEqual({ kind: 'reasoning', text: 'plan' });
    expect(
      mapResponseEvent({
        type: 'response.web_search_call.completed',
        id: 'search-1',
        action: {
          query: 'terminal security',
          sources: [{ url: 'https://example.com', title: 'Example' }]
        }
      })
    ).toEqual([
      {
        kind: 'activity',
        id: 'search-1',
        label: 'searching-query',
        detail: 'terminal security',
        state: 'done'
      },
      { kind: 'source', url: 'https://example.com', title: 'Example' }
    ]);
    expect(
      mapResponseEvent({
        type: 'response.completed',
        response: {
          model: 'reasoning-model',
          usage: {
            input_tokens: 10,
            output_tokens: 20,
            output_tokens_details: { reasoning_tokens: 7 }
          },
          output: [{ type: 'reasoning', encrypted_content: 'opaque' }]
        }
      })
    ).toEqual([
      { kind: 'usage', inputTokens: 10, outputTokens: 20, reasoningTokens: 7 },
      {
        kind: 'continuation',
        connectionId: 'provider',
        model: 'reasoning-model',
        items: [{ type: 'reasoning', encrypted_content: 'opaque' }]
      }
    ]);
    expect(
      mapResponseEvent({
        type: 'response.output_item.added',
        item: { url: 'file:///unsafe', title: 'Unsafe' }
      })
    ).toBeUndefined();
  });
});
