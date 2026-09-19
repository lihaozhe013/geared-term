import { normalizeEndpoint, type AiProtocol, type NormalizedEndpoint } from './endpoint';
import {
  mapChatCompletionEvent,
  parseSseFrame,
  splitSseBuffer,
  type AiStreamEvent
} from './stream';

const connectTimeoutMs = 15_000;
const idleTimeoutMs = 60_000;
const maxResponseBytes = 4 * 1024 * 1024;

export type AiRequest = {
  endpoint: string;
  protocol: AiProtocol;
  model: string;
  payload: Record<string, unknown>;
  apiKey?: string;
  signal?: AbortSignal;
  onEvent: (event: AiStreamEvent) => void;
};

export type AiResponse = {
  endpoint: NormalizedEndpoint;
  status: number;
};

function mergeSignals(signal: AbortSignal | undefined, controller: AbortController): AbortSignal {
  if (!signal) return controller.signal;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([signal, controller.signal]);
  signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  return controller.signal;
}

function mapResponseEvent(payload: unknown): AiStreamEvent | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const value = payload as {
    type?: unknown;
    delta?: unknown;
    response?: { usage?: { input_tokens?: unknown; output_tokens?: unknown } };
    item?: { url?: unknown; title?: unknown };
  };
  if (value.type === 'response.output_text.delta' && typeof value.delta === 'string')
    return { kind: 'delta', text: value.delta };
  if (value.type === 'response.reasoning_summary_text.delta' && typeof value.delta === 'string')
    return { kind: 'reasoning', text: value.delta };
  if (value.type === 'response.completed') {
    const usage = value.response?.usage;
    if (
      usage &&
      (typeof usage.input_tokens === 'number' || typeof usage.output_tokens === 'number')
    ) {
      return {
        kind: 'usage',
        inputTokens: typeof usage.input_tokens === 'number' ? usage.input_tokens : undefined,
        outputTokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : undefined
      };
    }
    return { kind: 'complete' };
  }
  if (value.type === 'response.output_item.added' && typeof value.item?.url === 'string') {
    return {
      kind: 'source',
      url: value.item.url,
      title: typeof value.item.title === 'string' ? value.item.title : undefined
    };
  }
  return undefined;
}

async function readStream(
  response: Response,
  protocol: AiProtocol,
  onEvent: (event: AiStreamEvent) => void,
  signal: AbortSignal
): Promise<void> {
  if (!response.body) throw new Error('AI provider returned no response body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let totalBytes = 0;
  while (true) {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('AI stream idle timeout')), idleTimeoutMs);
      })
    ]).finally(() => {
      if (timeoutId) clearTimeout(timeoutId);
    });
    if (result.done) break;
    if (signal.aborted) throw signal.reason ?? new Error('AI request cancelled');
    totalBytes += result.value.byteLength;
    if (totalBytes > maxResponseBytes) throw new Error('AI response size limit exceeded');
    buffer += decoder.decode(result.value, { stream: true });
    const split = splitSseBuffer(buffer);
    buffer = split.remainder;
    for (const frame of split.frames) {
      const payload = parseSseFrame(frame);
      if (payload && typeof payload === 'object' && 'done' in payload && payload.done === true) {
        onEvent({ kind: 'complete' });
        return;
      }
      const event =
        protocol === 'responses' ? mapResponseEvent(payload) : mapChatCompletionEvent(payload);
      if (event) onEvent(event);
    }
  }
  const finalPayload = parseSseFrame(buffer);
  const finalEvent =
    protocol === 'responses'
      ? mapResponseEvent(finalPayload)
      : mapChatCompletionEvent(finalPayload);
  if (finalEvent) onEvent(finalEvent);
  onEvent({ kind: 'complete' });
}

export async function streamAiRequest(request: AiRequest): Promise<AiResponse> {
  const endpoint = normalizeEndpoint(request.endpoint, request.protocol);
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error('AI connection timeout')),
    connectTimeoutMs
  );
  const signal = mergeSignals(request.signal, controller);
  try {
    const response = await fetch(endpoint.requestUrl, {
      method: 'POST',
      headers: {
        accept: 'text/event-stream, application/json',
        'content-type': 'application/json',
        ...(request.apiKey ? { authorization: `Bearer ${request.apiKey}` } : {})
      },
      body: JSON.stringify(request.payload),
      signal
    });
    clearTimeout(timeout);
    if (!response.ok) {
      const body = await response
        .text()
        .then((value) => value.slice(0, 1024))
        .catch(() => '');
      throw new Error(
        `AI provider rejected request (${response.status})${body ? `: ${body}` : ''}`
      );
    }
    await readStream(response, request.protocol, request.onEvent, signal);
    return { endpoint, status: response.status };
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

export const aiLimits = {
  connectTimeoutMs,
  idleTimeoutMs,
  maxResponseBytes
} as const;
