import { normalizeEndpoint, type AiProtocol, type NormalizedEndpoint } from './endpoint';
import {
  mapChatCompletionEvent,
  mapResponseEvent,
  parseSseFrame,
  splitSseBuffer,
  type AiStreamEvent
} from './stream';

const connectTimeoutMs = 15_000;
const idleTimeoutMs = 60_000;
const maxResponseBytes = 4 * 1024 * 1024;

export class AiProviderError extends Error {
  public constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

export type AiRequest = {
  connectionId?: string;
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

async function readStream(
  response: Response,
  protocol: AiProtocol,
  onEvent: (event: AiStreamEvent) => void,
  signal: AbortSignal,
  continuationContext: { connectionId: string; model: string }
): Promise<void> {
  if (!response.body) throw new Error('AI provider returned no response body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let totalBytes = 0;
  let completed = false;
  const seenSources = new Set<string>();
  const emitMapped = (mapped: AiStreamEvent | AiStreamEvent[] | undefined): void => {
    if (!mapped) return;
    for (const event of Array.isArray(mapped) ? mapped : [mapped]) {
      if (event.kind === 'source') {
        if (seenSources.has(event.url)) continue;
        seenSources.add(event.url);
      }
      if (event.kind === 'continuation') {
        onEvent({ ...event, ...continuationContext });
      } else {
        onEvent(event);
      }
      if (event.kind === 'complete') completed = true;
    }
  };
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
        if (!completed) onEvent({ kind: 'complete' });
        completed = true;
        return;
      }
      const event =
        protocol === 'responses' ? mapResponseEvent(payload) : mapChatCompletionEvent(payload);
      emitMapped(event);
    }
  }
  const finalPayload = parseSseFrame(buffer);
  const finalEvent =
    protocol === 'responses'
      ? mapResponseEvent(finalPayload)
      : mapChatCompletionEvent(finalPayload);
  emitMapped(finalEvent);
  if (!completed) onEvent({ kind: 'complete' });
}

export async function streamAiRequest(request: AiRequest): Promise<AiResponse> {
  const endpoint = normalizeEndpoint(request.endpoint, request.protocol);
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error('AI connection timeout')),
    connectTimeoutMs
  );
  const signal = mergeSignals(request.signal, controller);
  // Lifecycle activity steps. The renderer auto-closes a running step when the
  // next one starts, so only transitions are emitted here.
  let writingStarted = false;
  const emit = (event: AiStreamEvent): void => {
    if (event.kind === 'delta' && !writingStarted) {
      writingStarted = true;
      request.onEvent({ kind: 'activity', id: 'write', label: 'writing' });
    }
    request.onEvent(event);
  };
  try {
    request.onEvent({ kind: 'activity', id: 'connect', label: 'connecting' });
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
      throw new AiProviderError(
        `AI provider rejected request (${response.status})${body ? `: ${body}` : ''}`,
        response.status
      );
    }
    request.onEvent({ kind: 'activity', id: 'work', label: 'working' });
    await readStream(response, request.protocol, emit, signal, {
      connectionId: request.connectionId ?? 'provider',
      model: request.model
    });
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
