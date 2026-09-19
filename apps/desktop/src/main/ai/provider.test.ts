import { describe, expect, it, vi } from 'vitest';
import { streamAiRequest } from './provider';

describe('AI provider adapter', () => {
  it('sends the API key only as a bearer header and maps SSE deltas', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
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
    expect(events).toEqual([{ kind: 'delta', text: 'hello' }, { kind: 'complete' }]);
    fetchMock.mockRestore();
  });
});
