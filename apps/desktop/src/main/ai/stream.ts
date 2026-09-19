import type { AiActivityLabel } from '@geared-term/protocol';

export type AiStreamEvent =
  | { kind: 'delta'; text: string }
  | { kind: 'reasoning'; text: string }
  | { kind: 'activity'; id: string; label: AiActivityLabel; detail?: string }
  | { kind: 'usage'; inputTokens?: number; outputTokens?: number }
  | { kind: 'source'; url: string; title?: string }
  | { kind: 'complete' }
  | { kind: 'error'; message: string };

export function parseSseFrame(frame: string): unknown | undefined {
  const data = frame
    .split(/\r?\n/u)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  if (!data || data === '[DONE]') return data === '[DONE]' ? { done: true } : undefined;
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return undefined;
  }
}

export function splitSseBuffer(buffer: string): { frames: string[]; remainder: string } {
  const parts = buffer.split(/\r?\n\r?\n/u);
  return { frames: parts.slice(0, -1), remainder: parts.at(-1) ?? '' };
}

export function mapChatCompletionEvent(payload: unknown): AiStreamEvent | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const value = payload as {
    choices?: Array<{ delta?: { content?: unknown; reasoning_content?: unknown } }>;
    usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
  };
  const delta = value.choices?.[0]?.delta;
  if (typeof delta?.content === 'string') return { kind: 'delta', text: delta.content };
  if (typeof delta?.reasoning_content === 'string')
    return { kind: 'reasoning', text: delta.reasoning_content };
  if (
    value.usage &&
    (typeof value.usage.prompt_tokens === 'number' ||
      typeof value.usage.completion_tokens === 'number')
  ) {
    return {
      kind: 'usage',
      inputTokens:
        typeof value.usage.prompt_tokens === 'number' ? value.usage.prompt_tokens : undefined,
      outputTokens:
        typeof value.usage.completion_tokens === 'number'
          ? value.usage.completion_tokens
          : undefined
    };
  }
  return undefined;
}

export function mapResponseEvent(payload: unknown): AiStreamEvent | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const value = payload as {
    type?: unknown;
    delta?: unknown;
    response?: { usage?: { input_tokens?: unknown; output_tokens?: unknown } };
    item?: {
      url?: unknown;
      title?: unknown;
      action?: { query?: unknown };
    };
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
  if (typeof value.type === 'string' && value.type.startsWith('response.web_search_call')) {
    const query =
      typeof value.item?.action?.query === 'string' ? value.item.action.query : undefined;
    const label: AiActivityLabel = query ? 'searching-query' : 'searching-web';
    const id = query ? `search:${query}` : 'search:web';
    return { kind: 'activity', id, label, detail: query };
  }
  if (typeof value.type === 'string' && value.type.startsWith('response.file_search_call')) {
    return { kind: 'activity', id: 'read:files', label: 'reading-sources' };
  }
  return undefined;
}
