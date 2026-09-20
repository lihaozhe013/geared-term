import { AiHistorySaveRequestSchema, type AiHistorySaveRequest } from '@geared-term/protocol';

export type HistoryMessageInput = {
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  usage?: { input?: number; output?: number; reasoning?: number };
  sources?: Array<{ url: string; title?: string }>;
  continuation?: { connectionId: string; model: string; items: Array<Record<string, unknown>> };
};

export type HistoryEntryInput = {
  id: string;
  model?: string;
  reasoning: string;
  sources: Array<{ url: string; title?: string }>;
  messages: HistoryMessageInput[];
};

/**
 * Builds the history-save payload for the current conversation state.
 *
 * The trailing assistant placeholder (empty content while a reply is streaming
 * or before the first token) is dropped so a conversation can be persisted as
 * soon as the user prompt is sent. Metadata is attached to the last assistant
 * message only, mirroring the stream timeline.
 */
export function buildHistoryEntry(input: HistoryEntryInput): AiHistorySaveRequest {
  const turn = input.messages.filter((message) => message.content.trim().length > 0);
  const reversedAssistantIndex = [...turn]
    .reverse()
    .findIndex((message) => message.role === 'assistant');
  const lastAssistantIndex =
    reversedAssistantIndex < 0 ? -1 : turn.length - 1 - reversedAssistantIndex;
  return AiHistorySaveRequestSchema.parse({
    id: input.id,
    title: turn.find((message) => message.role === 'user')?.content.slice(0, 80) ?? 'Conversation',
    ...(input.model ? { model: input.model } : {}),
    messages: turn.map((message, index) => ({
      role: message.role,
      content: message.content,
      ...(message.role === 'assistant' && index === lastAssistantIndex
        ? {
            ...(input.reasoning ? { reasoning: input.reasoning } : {}),
            ...(message.usage
              ? {
                  usage: {
                    inputTokens: message.usage.input,
                    outputTokens: message.usage.output,
                    reasoningTokens: message.usage.reasoning
                  }
                }
              : {}),
            ...(input.sources.length > 0 ? { sources: input.sources } : {}),
            ...(message.continuation ? { continuation: message.continuation } : {})
          }
        : {})
    }))
  });
}
