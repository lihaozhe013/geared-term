import { describe, expect, it } from 'vitest';
import { rankFuzzyItems } from './fuzzy-search';

describe('rankFuzzyItems', () => {
  it('ranks exact, prefix, contiguous, punctuation-insensitive, and subsequence matches', () => {
    const items = ['provider/g-px-t-4', 'openai/gpt-4', 'gpt-4o-mini', 'provider/gpt4x', 'gpt-4'];

    expect(rankFuzzyItems(items, 'gpt-4', (item) => item)).toEqual([
      'gpt-4',
      'gpt-4o-mini',
      'openai/gpt-4',
      'provider/gpt4x',
      'provider/g-px-t-4'
    ]);
  });

  it('matches case-insensitively and handles Unicode letters', () => {
    const items = ['文档-配置.txt', '目录', 'README.md'];
    expect(rankFuzzyItems(items, '文配', (item) => item)).toEqual(['文档-配置.txt']);
    expect(rankFuzzyItems(items, 'readme', (item) => item)).toEqual(['README.md']);
  });

  it('keeps original order for equal and punctuation-only matches', () => {
    const items = ['b-abc', 'a_abc', 'abc'];
    expect(rankFuzzyItems(items, 'abc', (item) => item)).toEqual(['abc', 'b-abc', 'a_abc']);
    expect(rankFuzzyItems(items, '-', (item) => item)).toEqual(['b-abc']);
  });

  it('returns every item in order for an empty query and no items for a miss', () => {
    const items = ['second', 'first'];
    expect(rankFuzzyItems(items, '  ', (item) => item)).toEqual(items);
    expect(rankFuzzyItems(items, 'missing', (item) => item)).toEqual([]);
  });
});
