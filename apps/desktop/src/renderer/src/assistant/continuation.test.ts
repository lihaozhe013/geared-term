import { describe, expect, it } from 'vitest';
import {
  AiStreamEventSchema,
  AiStreamRequestSchema,
  type AiStreamEvent
} from '@geared-term/protocol';

type ContinuationMetadata = {
  connectionId: string;
  model: string;
  items: Array<Record<string, unknown>>;
};

const parsedEvent: AiStreamEvent = AiStreamEventSchema.parse({
  kind: 'continuation',
  connectionId: 'connection-1',
  model: 'gpt-test',
  items: [{ type: 'reasoning', encrypted_content: 'abc' }]
});
if (parsedEvent.kind !== 'continuation') throw new Error('expected a continuation event');
const continuationEvent: Extract<AiStreamEvent, { kind: 'continuation' }> = parsedEvent;

function buildRequest(continuation: ContinuationMetadata | undefined): unknown {
  return {
    streamId: 'stream-1',
    connectionId: 'connection-1',
    model: 'gpt-test',
    messages: [
      { role: 'user', content: 'first prompt' },
      { role: 'assistant', content: 'first answer', ...(continuation ? { continuation } : {}) }
    ],
    prompt: 'second prompt'
  };
}

describe('assistant continuation metadata contract', () => {
  it('stores continuation metadata without the event discriminator', () => {
    const { kind: _kind, ...continuation } = continuationEvent;
    expect(continuation).toEqual({
      connectionId: 'connection-1',
      model: 'gpt-test',
      items: [{ type: 'reasoning', encrypted_content: 'abc' }]
    });
  });

  it('accepts a follow-up request carrying stripped continuation metadata', () => {
    const { kind: _kind, ...continuation } = continuationEvent;
    expect(() => AiStreamRequestSchema.parse(buildRequest(continuation))).not.toThrow();
  });

  it('rejects the raw stream event shape echoed back as message metadata', () => {
    expect(() => AiStreamRequestSchema.parse(buildRequest(continuationEvent))).toThrow();
  });
});
