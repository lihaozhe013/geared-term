import { URL } from 'node:url';

export type AiProtocol = 'responses' | 'chat-completions';

export type NormalizedEndpoint = {
  baseUrl: string;
  requestUrl: string;
  protocol: AiProtocol;
  identity: string;
};

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
  if (url.pathname.endsWith('/')) url.pathname = url.pathname.slice(0, -1);
  const baseUrl = url.toString().replace(/\/$/u, '');
  const requestPath = protocol === 'responses' ? '/responses' : '/chat/completions';
  return {
    baseUrl,
    requestUrl: `${baseUrl}${requestPath}`,
    protocol,
    identity: `${protocol}:${baseUrl}`
  };
}

export function buildChatCompletionsPayload(
  model: string,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
): Record<string, unknown> {
  return { model, messages, stream: true };
}

export function buildResponsesPayload(
  model: string,
  input: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
): Record<string, unknown> {
  return { model, input, stream: true, store: false };
}
