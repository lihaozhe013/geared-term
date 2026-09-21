import type { AiActivityLabel } from '@geared-term/protocol';

export type AiStreamEvent =
  | { kind: 'delta'; text: string }
  | { kind: 'reasoning'; text: string }
  | {
      kind: 'activity';
      id: string;
      label: AiActivityLabel;
      detail?: string;
      state?: 'running' | 'done';
    }
  | {
      kind: 'usage';
      inputTokens?: number;
      outputTokens?: number;
      reasoningTokens?: number;
    }
  | { kind: 'source'; url: string; title?: string }
  | {
      kind: 'continuation';
      connectionId: string;
      model: string;
      items: Array<Record<string, unknown>>;
    }
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
  if (typeof delta?.reasoning_content === 'string') {
    return { kind: 'reasoning', text: delta.reasoning_content };
  }
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

type ResponsePayload = {
  type?: unknown;
  delta?: unknown;
  item?: {
    id?: unknown;
    url?: unknown;
    title?: unknown;
    action?: { query?: unknown; sources?: unknown };
  };
  part?: { text?: unknown };
  action?: { query?: unknown; sources?: unknown };
  id?: unknown;
  response?: {
    model?: unknown;
    usage?: {
      input_tokens?: unknown;
      output_tokens?: unknown;
      output_tokens_details?: { reasoning_tokens?: unknown };
    };
    output?: unknown;
  };
};

function sourceEvents(value: unknown): AiStreamEvent[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((source) => {
    if (!source || typeof source !== 'object') return [];
    const item = source as { url?: unknown; title?: unknown };
    if (typeof item.url !== 'string' || !/^https?:\/\//iu.test(item.url)) return [];
    return [
      {
        kind: 'source' as const,
        url: item.url,
        title: typeof item.title === 'string' ? item.title : undefined
      }
    ];
  });
}

export function mapResponseEvent(payload: unknown): AiStreamEvent | AiStreamEvent[] | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const value = payload as ResponsePayload;
  if (value.type === 'response.output_text.delta' && typeof value.delta === 'string') {
    return { kind: 'delta', text: value.delta };
  }
  if (
    ((value.type === 'response.reasoning_summary_text.delta' ||
      value.type === 'response.reasoning_summary_part.added') &&
      typeof value.delta === 'string') ||
    typeof value.part?.text === 'string'
  ) {
    return {
      kind: 'reasoning',
      text: typeof value.delta === 'string' ? value.delta : (value.part?.text as string)
    };
  }
  if (value.type === 'response.completed') {
    const events: AiStreamEvent[] = [];
    const usage = value.response?.usage;
    if (
      usage &&
      (typeof usage.input_tokens === 'number' ||
        typeof usage.output_tokens === 'number' ||
        typeof usage.output_tokens_details?.reasoning_tokens === 'number')
    ) {
      events.push({
        kind: 'usage',
        inputTokens: typeof usage.input_tokens === 'number' ? usage.input_tokens : undefined,
        outputTokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : undefined,
        reasoningTokens:
          typeof usage.output_tokens_details?.reasoning_tokens === 'number'
            ? usage.output_tokens_details.reasoning_tokens
            : undefined
      });
    }
    if (Array.isArray(value.response?.output)) {
      const allItems = value.response.output.filter((item): item is Record<string, unknown> =>
        Boolean(item && typeof item === 'object')
      );
      const items = allItems.filter((item) => {
        if (!item || typeof item !== 'object') return false;
        const candidate = item as { type?: unknown; encrypted_content?: unknown };
        return candidate.type === 'reasoning' && typeof candidate.encrypted_content === 'string';
      });
      if (items.length > 0) {
        events.push({
          kind: 'continuation',
          connectionId: 'provider',
          model: typeof value.response?.model === 'string' ? value.response.model : 'unknown',
          items: items.slice(0, 32)
        });
      }
      for (const item of allItems) {
        const action = (item as { action?: unknown }).action;
        if (action && typeof action === 'object') {
          events.push(...sourceEvents((action as { sources?: unknown }).sources));
        }
      }
    }
    return events.length === 0 ? { kind: 'complete' } : events;
  }
  if (value.type === 'response.output_item.added') {
    const events: AiStreamEvent[] = [];
    if (typeof value.item?.url === 'string' && /^https?:\/\//iu.test(value.item.url)) {
      events.push({
        kind: 'source',
        url: value.item.url,
        title: typeof value.item.title === 'string' ? value.item.title : undefined
      });
    }
    events.push(...sourceEvents(value.item?.action?.sources));
    return events.length > 0 ? events : undefined;
  }
  if (typeof value.type === 'string' && value.type.startsWith('response.web_search_call')) {
    const query =
      typeof value.item?.action?.query === 'string'
        ? value.item.action.query
        : typeof value.action?.query === 'string'
          ? value.action.query
          : undefined;
    const rawId = value.item?.id ?? value.id;
    const id = typeof rawId === 'string' ? rawId : query ? `search:${query}` : 'search:web';
    const state = value.type.endsWith('.completed') ? 'done' : 'running';
    const activity: AiStreamEvent = {
      kind: 'activity',
      id,
      label: query ? 'searching-query' : 'searching-web',
      detail: query,
      state
    };
    const sources = sourceEvents(value.action?.sources ?? value.item?.action?.sources);
    return sources.length > 0 ? [activity, ...sources] : activity;
  }
  if (typeof value.type === 'string' && value.type.startsWith('response.file_search_call')) {
    return { kind: 'activity', id: 'read:files', label: 'reading-sources' };
  }
  return undefined;
}
