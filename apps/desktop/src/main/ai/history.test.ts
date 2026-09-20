import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AiHistoryStore } from './history';

describe('ai history store', () => {
  const directories: string[] = [];

  function createStore(): AiHistoryStore {
    const root = mkdtempSync(join(tmpdir(), 'geared-term-history-'));
    directories.push(root);
    return new AiHistoryStore(root);
  }

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('saves, lists, loads, and deletes conversations', async () => {
    const store = createStore();
    const saved = await store.save({
      title: 'Fix disk usage',
      model: 'fixture-large',
      messages: [
        { role: 'user', content: 'How do I find large files?' },
        { role: 'assistant', content: 'Use `du -ah . | sort -rh | head`.' }
      ]
    });
    expect(saved.messageCount).toBe(2);

    const entries = await store.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.title).toBe('Fix disk usage');

    const loaded = await store.load(saved.id);
    expect(loaded?.messages).toEqual([
      { role: 'user', content: 'How do I find large files?' },
      { role: 'assistant', content: 'Use `du -ah . | sort -rh | head`.' }
    ]);

    // Appending to the same id keeps one file and updates metadata.
    await store.save({
      id: saved.id,
      title: 'Fix disk usage',
      model: 'fixture-large',
      messages: [
        { role: 'user', content: 'How do I find large files?' },
        { role: 'assistant', content: 'Use `du -ah . | sort -rh | head`.' },
        { role: 'user', content: 'And on Windows?' }
      ]
    });
    expect(await store.list()).toHaveLength(1);
    const continued = await store.load(saved.id);
    expect(continued?.messages).toHaveLength(3);

    await store.remove(saved.id);
    expect(await store.list()).toHaveLength(0);
    expect(await store.load(saved.id)).toBeUndefined();
  });

  it('rejects traversal-style identifiers', async () => {
    const store = createStore();
    expect(await store.load('../secrets')).toBeUndefined();
    await store.remove('../../vault.json');
    await expect(
      store.save({ id: 'a/b', title: 'x', messages: [{ role: 'user', content: 'c' }] })
    ).resolves.toMatchObject({
      title: 'x'
    });
  });

  it('skips malformed history files instead of failing the listing', async () => {
    const store = createStore();
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(store.path, { recursive: true });
    writeFileSync(join(store.path, 'broken.md'), 'not a conversation', 'utf8');
    expect(await store.list()).toEqual([]);
    const saved = await store.save({
      title: 'Good',
      messages: [{ role: 'user', content: 'hi' }]
    });
    const entries = await store.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBe(saved.id);
  });

  it('sorts the listing by updated time descending', async () => {
    const store = createStore();
    const first = await store.save({
      title: 'First',
      messages: [{ role: 'user', content: 'one' }]
    });
    const second = await store.save({
      title: 'Second',
      messages: [{ role: 'user', content: 'two' }]
    });
    const entries = await store.list();
    expect(entries[0]?.id).toBe(second.id);
    expect(entries[1]?.id).toBe(first.id);
  });

  it('round-trips reasoning, usage, snapshots, sources, and continuation metadata', async () => {
    const store = createStore();
    const saved = await store.save({
      title: 'Inspect output',
      model: 'responses-model',
      messages: [
        {
          role: 'user',
          content: 'Explain this output',
          snapshot: {
            source: 'selection',
            truncated: false,
            lineStart: null,
            lineEnd: null,
            charCount: 12,
            alternateScreen: false,
            text: 'untrusted output'
          }
        },
        {
          role: 'assistant',
          content: 'The output is inconclusive.',
          reasoning: 'Compare the observed fields first.',
          usage: { inputTokens: 12, outputTokens: 8, reasoningTokens: 4 },
          sources: [{ url: 'https://example.com', title: 'Example' }],
          continuation: {
            connectionId: 'connection-1',
            model: 'responses-model',
            items: [{ type: 'reasoning', encrypted_content: 'opaque' }]
          }
        }
      ]
    });
    await expect(store.load(saved.id)).resolves.toMatchObject({
      messages: [
        { snapshot: { text: 'untrusted output' } },
        {
          reasoning: 'Compare the observed fields first.',
          usage: { inputTokens: 12, outputTokens: 8, reasoningTokens: 4 },
          sources: [{ url: 'https://example.com', title: 'Example' }],
          continuation: { connectionId: 'connection-1' }
        }
      ]
    });
  });
});
