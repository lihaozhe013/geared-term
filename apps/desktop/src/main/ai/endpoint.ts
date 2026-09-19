import { URL } from 'node:url';

export type AiProtocol = 'responses' | 'chat-completions';

export type NormalizedEndpoint = {
  baseUrl: string;
  requestUrl: string;
  modelsUrl: string;
  protocol: AiProtocol;
  identity: string;
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
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
): Record<string, unknown> {
  return { model, messages, stream: true };
}

export function buildResponsesPayload(
  model: string,
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
): Record<string, unknown> {
  const instructions = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n');
  const input = messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({ role: message.role, content: message.content }));
  const payload: Record<string, unknown> = { model, input, stream: true, store: false };
  if (instructions.length > 0) payload.instructions = instructions;
  return payload;
}
