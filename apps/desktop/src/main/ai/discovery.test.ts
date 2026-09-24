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
    expect(result).toEqual({ models: ['model-a', 'model-b'], truncated: false });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('http://127.0.0.1:11434/v1/models');
  });

  it('prefers the /models listing for responses endpoints', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { data: [{ id: 'gpt fixture' }, { id: 'o-series fixture' }] })
      );
    const result = await discoverModels({
      protocol: 'responses',
      baseUrl: 'https://api.example.test/v1',
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    expect(result).toEqual({
      models: ['gpt fixture', 'o-series fixture'],
      truncated: false
    });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://api.example.test/v1/models');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('falls back to the disclosed storage-free responses test request', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(404, 'no listing'))
      .mockResolvedValueOnce(jsonResponse(200, { id: 'resp_1' }));
    const result = await discoverModels({
      protocol: 'responses',
      baseUrl: 'https://api.example.test/v1',
      model: 'fixture-large',
      apiKey: 'sk-test',
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    expect(result).toEqual({ models: ['fixture-large'], truncated: false });
    const [, init] = fetchImpl.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'fixture-large',
      input: [{ role: 'user', content: 'Reply with OK.' }],
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

  it('discovers more than 256 models and reports when the bounded result is truncated', async () => {
    const source = Array.from({ length: 4100 }, (_, index) => ({ id: `model-${index}` }));
    const result = await discoverModels({
      protocol: 'chat-completions',
      baseUrl: 'https://api.example.test/v1',
      fetchImpl: vi
        .fn()
        .mockResolvedValue(jsonResponse(200, { data: source })) as unknown as typeof fetch
    });

    expect(result.models).toHaveLength(4096);
    expect(result.models[255]).toBe('model-255');
    expect(result.models[4095]).toBe('model-4095');
    expect(result.truncated).toBe(true);
  });

  it('does not report truncation when the catalog exactly fits the limit', async () => {
    const source = Array.from({ length: 4096 }, (_, index) => ({ id: `model-${index}` }));
    const result = await discoverModels({
      protocol: 'chat-completions',
      baseUrl: 'https://api.example.test/v1',
      fetchImpl: vi
        .fn()
        .mockResolvedValue(jsonResponse(200, { data: source })) as unknown as typeof fetch
    });

    expect(result.models).toHaveLength(4096);
    expect(result.truncated).toBe(false);
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
