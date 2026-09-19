export type AiStreamEvent =
  | { kind: 'delta'; text: string }
  | { kind: 'reasoning'; text: string }
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
