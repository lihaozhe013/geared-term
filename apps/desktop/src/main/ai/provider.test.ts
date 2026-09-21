import { describe, expect, it, vi } from 'vitest';
import { streamAiRequest } from './provider';

describe('AI provider adapter', () => {
  it('sends the API key only as a bearer header and maps SSE deltas', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' }
      })
    );
    const events: unknown[] = [];
    await streamAiRequest({
      endpoint: 'https://api.example.test/v1',
      protocol: 'chat-completions',
      model: 'model',
      payload: { model: 'model', stream: true },
      apiKey: 'secret-key',
      onEvent: (event) => events.push(event)
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/v1/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: 'Bearer secret-key' })
      })
    );
    expect(events).toEqual([
      { kind: 'activity', id: 'connect', label: 'connecting' },
      { kind: 'activity', id: 'work', label: 'working' },
      { kind: 'activity', id: 'write', label: 'writing' },
      { kind: 'delta', text: 'hello' },
      { kind: 'complete' }
    ]);
    fetchMock.mockRestore();
  });

  it('maps Responses continuation and deduplicates web sources', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          [
            'data: {"type":"response.reasoning_summary_text.delta","delta":"think"}',
            '',
            'data: {"type":"response.web_search_call.searching","id":"search-1","action":{"query":"docs"}}',
            '',
            'data: {"type":"response.web_search_call.completed","id":"search-1","action":{"query":"docs","sources":[{"url":"https://example.com","title":"Example"}]}}',
            '',
            'data: {"type":"response.output_item.added","item":{"url":"https://example.com","title":"Example"}}',
            '',
            'data: {"type":"response.completed","response":{"model":"model","usage":{"input_tokens":3,"output_tokens":4,"output_tokens_details":{"reasoning_tokens":2}},"output":[{"type":"reasoning","encrypted_content":"opaque"}]}}',
            '',
            'data: [DONE]',
            ''
          ].join('\n'),
          { status: 200, headers: { 'content-type': 'text/event-stream' } }
        )
      );
    const events: unknown[] = [];
    await streamAiRequest({
      connectionId: 'connection-1',
      endpoint: 'https://api.example.test/v1',
      protocol: 'responses',
      model: 'model',
      payload: { model: 'model', stream: true },
      onEvent: (event) => events.push(event)
    });
    expect(events).toContainEqual({ kind: 'reasoning', text: 'think' });
    expect(events).toContainEqual({
      kind: 'activity',
      id: 'search-1',
      label: 'searching-query',
      detail: 'docs',
      state: 'done'
    });
    expect(events.filter((event) => (event as { kind?: string }).kind === 'source')).toEqual([
      { kind: 'source', url: 'https://example.com', title: 'Example' }
    ]);
    expect(events).toContainEqual({
      kind: 'continuation',
      connectionId: 'connection-1',
      model: 'model',
      items: [{ type: 'reasoning', encrypted_content: 'opaque' }]
    });
    expect(events).toContainEqual({
      kind: 'usage',
      inputTokens: 3,
      outputTokens: 4,
      reasoningTokens: 2
    });
    expect(events.at(-1)).toEqual({ kind: 'complete' });
    fetchMock.mockRestore();
  });
});
