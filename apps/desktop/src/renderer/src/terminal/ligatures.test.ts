import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildLigatureJoiner, defaultLigatureSequences, loadLigatureSequences } from './ligatures';

describe('buildLigatureJoiner', () => {
  it('returns disjoint ranges for every occurrence, longest match first', () => {
    const joiner = buildLigatureJoiner(['=', '=>', '<=>']);
    expect(joiner('a<=>b=>c')).toEqual([
      [1, 4],
      [5, 7]
    ]);
  });

  it('escapes regular expression metacharacters', () => {
    const joiner = buildLigatureJoiner(['|||', '/\\', '***']);
    expect(joiner('x|||y/\\z***w|||')).toEqual([
      [1, 4],
      [5, 7],
      [8, 11],
      [12, 15]
    ]);
  });

  it('ignores invalid sequences and keeps state between calls', () => {
    const joiner = buildLigatureJoiner(['<', '9', '=>', '日本語', '!==']);
    expect(joiner('a=>b!==c')).toEqual([
      [1, 3],
      [4, 7]
    ]);
    expect(joiner('=>')).toEqual([[0, 2]]);
    expect(joiner('')).toEqual([]);
  });

  it('returns no ranges when no sequence matches', () => {
    const joiner = buildLigatureJoiner(['->']);
    expect(joiner('plain text')).toEqual([]);
  });

  it('produces a valid default table', () => {
    const joiner = buildLigatureJoiner(defaultLigatureSequences());
    expect(joiner('=> !=')).toEqual([
      [0, 2],
      [3, 5]
    ]);
  });
});

describe('loadLigatureSequences', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('caches lookups per font family and falls back after failures', async () => {
    const invoke = vi.fn<(family: string) => Promise<string[]>>(async () => []);
    invoke.mockResolvedValueOnce(['=>', '===']);
    invoke.mockRejectedValueOnce(new Error('font missing'));
    invoke.mockRejectedValueOnce(new Error('font missing'));
    vi.stubGlobal('window', { geared: { getTerminalLigatureSequences: invoke } });

    await expect(loadLigatureSequences('Fira Code')).resolves.toEqual(['=>', '===']);
    await expect(loadLigatureSequences('Fira Code')).resolves.toEqual(['=>', '===']);
    expect(invoke).toHaveBeenCalledTimes(1);

    await expect(loadLigatureSequences('Custom Font')).rejects.toThrow('font missing');
    await expect(loadLigatureSequences('Custom Font')).rejects.toThrow('font missing');
    expect(invoke).toHaveBeenCalledTimes(3);

    await expect(loadLigatureSequences('Ligatureless Mono')).resolves.toEqual([]);
    await expect(loadLigatureSequences('Ligatureless Mono')).resolves.toEqual([]);
    expect(invoke).toHaveBeenCalledTimes(5);
  });
});
