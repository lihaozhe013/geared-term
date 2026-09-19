import { describe, expect, it, vi } from 'vitest';
import { discoverModels } from './discovery';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
  } as unknown as Response;
}

describe('model discovery', () => {
  it('parses chat completions /models payloads', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        data: [{ id: 'model-a' }, { id: 'model-b' }, { id: 'model-a' }, { nope: true }]
      })
    );
    const result = await discoverModels({
      protocol: 'chat-completions',
      baseUrl: 'http://127.0.0.1:11434/v1/',
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    expect(result.models).toEqual(['model-a', 'model-b']);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('http://127.0.0.1:11434/v1/models');
  });

  it('sends the disclosed storage-free responses test request', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { id: 'resp_1' }));
    const result = await discoverModels({
      protocol: 'responses',
      baseUrl: 'https://api.example.test/v1',
      model: 'fixture-large',
      apiKey: 'sk-test',
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    expect(result.models).toEqual(['fixture-large']);
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'fixture-large',
      input: [],
      stream: false,
      store: false
    });
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
  });

  it('requires a model for responses discovery', async () => {
    await expect(
      discoverModels({
        protocol: 'responses',
        baseUrl: 'https://api.example.test/v1',
        fetchImpl: vi.fn() as unknown as typeof fetch
      })
    ).rejects.toThrow('Enter a model name');
  });

  it('maps non-2xx responses to a structured failure', async () => {
    await expect(
      discoverModels({
        protocol: 'chat-completions',
        baseUrl: 'https://api.example.test/v1',
        fetchImpl: vi.fn().mockResolvedValue(jsonResponse(401, 'denied')) as unknown as typeof fetch
      })
    ).rejects.toThrow('401');
  });

  it('rejects endpoints that are not HTTPS or loopback HTTP', async () => {
    await expect(
      discoverModels({
        protocol: 'chat-completions',
        baseUrl: 'http://api.example.test/v1',
        fetchImpl: vi.fn() as unknown as typeof fetch
      })
    ).rejects.toThrow('HTTPS or loopback HTTP');
  });
});
