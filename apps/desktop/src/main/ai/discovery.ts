import { normalizeEndpoint, type AiProtocol } from './endpoint';

const connectTimeoutMs = 15_000;
const maxModels = 256;

export type DiscoveryRequest = {
  protocol: AiProtocol;
  baseUrl: string;
  model?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
};

export type DiscoveryResult = { models: string[] };

/**
 * Best-effort model discovery. Both protocols first try the OpenAI-compatible
 * GET /models listing; when that is unavailable, Responses endpoints fall back
 * to validating the configured model with a minimal, disclosed, storage-free
 * request (AI-005).
 */
export async function discoverModels(request: DiscoveryRequest): Promise<DiscoveryResult> {
  const endpoint = normalizeEndpoint(request.baseUrl, request.protocol);
  const fetchImpl = request.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error('Model discovery timed out')),
    connectTimeoutMs
  );
  try {
    try {
      const response = await fetchImpl(endpoint.modelsUrl, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          ...(request.apiKey ? { authorization: `Bearer ${request.apiKey}` } : {})
        },
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`Model discovery failed (${response.status})`);
      const payload = (await response.json()) as unknown;
      const models = parseModelList(payload);
      if (models.length === 0) throw new Error('Model discovery returned no models');
      return { models };
    } catch (error) {
      if (controller.signal.aborted || isTimeout(error)) throw error;
      if (request.protocol !== 'responses') throw error;
    }
    const model = request.model?.trim();
    if (!model) {
      throw new Error('Enter a model name to test a Responses endpoint');
    }
    const response = await fetchImpl(endpoint.requestUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(request.apiKey ? { authorization: `Bearer ${request.apiKey}` } : {})
      },
      body: JSON.stringify({
        model,
        input: [{ role: 'user', content: 'Reply with OK.' }],
        stream: false,
        store: false
      }),
      signal: controller.signal
    });
    if (!response.ok) {
      const body = await response
        .text()
        .then((value) => value.slice(0, 200))
        .catch(() => '');
      throw new Error(
        `Responses test request failed (${response.status})${body ? `: ${body}` : ''}`
      );
    }
    return { models: [model] };
  } catch (error) {
    if (isTimeout(error)) throw error;
    if (controller.signal.aborted) throw new Error('Model discovery timed out');
    if (error instanceof Error) throw error;
    throw new Error('Model discovery failed');
  } finally {
    clearTimeout(timeout);
  }
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && error.message === 'Model discovery timed out';
}

function parseModelList(payload: unknown): string[] {
  const source =
    payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : Array.isArray(payload)
        ? payload
        : [];
  const models = new Set<string>();
  for (const entry of source) {
    const id =
      typeof entry === 'string'
        ? entry
        : entry && typeof entry === 'object' && typeof (entry as { id?: unknown }).id === 'string'
          ? (entry as { id: string }).id
          : undefined;
    if (id && id.length <= 256) models.add(id);
    if (models.size >= maxModels) break;
  }
  return [...models];
}
