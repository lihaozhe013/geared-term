import { URL } from 'node:url';
import type { AiResponsesModelDefaults } from '@geared-term/protocol';

export type AiProtocol = 'responses' | 'chat-completions';

export type NormalizedEndpoint = {
  baseUrl: string;
  requestUrl: string;
  modelsUrl: string;
  protocol: AiProtocol;
  identity: string;
};

export const defaultResponsesOptions: AiResponsesModelDefaults = {
  reasoningEffort: 'default',
  verbosity: 'default',
  reasoningSummary: true,
  webSearch: false
};

const terminalSuffixes = ['/chat/completions', '/responses', '/models'] as const;

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

export function normalizeEndpoint(input: string, protocol: AiProtocol): NormalizedEndpoint {
  const value = input.trim();
  const url = new URL(value);
  const isHttps = url.protocol === 'https:';
  const isAllowedLoopback = url.protocol === 'http:' && isLoopback(url.hostname);
  if (!isHttps && !isAllowedLoopback)
    throw new Error('AI endpoints must use HTTPS or loopback HTTP');
  if (url.username || url.password || url.search || url.hash)
    throw new Error('AI endpoint must not contain credentials, query, or fragment');
  let path = url.pathname.replace(/\/+$/u, '');
  for (const suffix of terminalSuffixes) {
    if (path.endsWith(suffix)) {
      path = path.slice(0, -suffix.length);
      break;
    }
  }
  // Bare hosts serve OpenAI-compatible APIs under /v1 in practice, so users can
  // paste either a bare host or a full endpoint link and get a working URL.
  if (path === '') path = '/v1';
  url.pathname = path;
  const baseUrl = url.toString().replace(/\/$/u, '');
  const requestPath = protocol === 'responses' ? '/responses' : '/chat/completions';
  return {
    baseUrl,
    requestUrl: `${baseUrl}${requestPath}`,
    modelsUrl: `${baseUrl}/models`,
    protocol,
    identity: `${protocol}:${baseUrl}`
  };
}

export function buildChatCompletionsPayload(
  model: string,
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
    continuation?: { connectionId: string; model: string; items: Array<Record<string, unknown>> };
  }>
): Record<string, unknown> {
  return {
    model,
    messages: messages.map(({ role, content }) => ({ role, content })),
    stream: true
  };
}

export function buildResponsesPayload(
  model: string,
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
    continuation?: { connectionId: string; model: string; items: Array<Record<string, unknown>> };
  }>,
  options: AiResponsesModelDefaults = defaultResponsesOptions,
  connectionId?: string
): Record<string, unknown> {
  const instructions = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n');
  const input = messages
    .filter((message) => message.role !== 'system')
    .flatMap((message) => {
      const continuation = message.continuation;
      if (
        message.role === 'assistant' &&
        continuation &&
        continuation.model === model &&
        (!connectionId || continuation.connectionId === connectionId)
      ) {
        return continuation.items;
      }
      return [{ role: message.role, content: message.content }];
    });
  const payload: Record<string, unknown> = {
    model,
    input,
    stream: true,
    store: false,
    include: ['reasoning.encrypted_content']
  };
  if (instructions.length > 0) payload.instructions = instructions;
  payload.reasoning = {
    ...(options.reasoningEffort !== 'default' ? { effort: options.reasoningEffort } : {}),
    summary: options.reasoningSummary ? 'auto' : 'none'
  };
  if (options.verbosity !== 'default') {
    payload.text = { verbosity: options.verbosity };
  }
  if (options.webSearch) {
    payload.tools = [{ type: 'web_search' }];
    payload.include = ['reasoning.encrypted_content', 'web_search_call.action.sources'];
  }
  return payload;
}
