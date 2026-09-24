import { describe, expect, it } from 'vitest';
import { searchModelIds } from './model-search';

describe('searchModelIds', () => {
  it('ranks exact, contiguous, and ordered character matches in that order', () => {
    const models = ['provider/gpt4x', 'openai/gpt-4', 'gpt-4o-mini', 'provider/g-px-t-4', 'gpt-4'];

    expect(searchModelIds(models, 'gpt-4')).toEqual([
      'gpt-4',
      'gpt-4o-mini',
      'openai/gpt-4',
      'provider/gpt4x',
      'provider/g-px-t-4'
    ]);
  });

  it('matches without regard to case or punctuation', () => {
    expect(searchModelIds(['openrouter/Model-299'], 'MODEL 299')).toEqual(['openrouter/Model-299']);
  });

  it('keeps provider order for equally ranked results', () => {
    expect(searchModelIds(['provider/abc-one', 'provider/abc-two'], 'abc')).toEqual([
      'provider/abc-one',
      'provider/abc-two'
    ]);
  });

  it('returns all models for an empty query and none when there are no matches', () => {
    expect(searchModelIds(['a', 'b'], '  ')).toEqual(['a', 'b']);
    expect(searchModelIds(['a', 'b'], 'missing')).toEqual([]);
    expect(searchModelIds(['gpt-4', 'gemini'], '-')).toEqual(['gpt-4']);
  });
});
