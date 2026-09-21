import { describe, expect, it } from 'vitest';
import { insertTabAfter, moveTabById, nextCopyName, tabDisplayLabel } from './tab-ordering';

describe('moveTabById', () => {
  const tabs = ['a', 'b', 'c', 'd'].map((id) => ({ id }));

  it('moves before the target when dropping on the leading half', () => {
    expect(moveTabById(tabs, 'a', 'c', false).map((tab) => tab.id)).toEqual(['b', 'a', 'c', 'd']);
    expect(moveTabById(tabs, 'd', 'b', false).map((tab) => tab.id)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('moves after the target when dropping on the trailing half', () => {
    expect(moveTabById(tabs, 'a', 'c', true).map((tab) => tab.id)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveTabById(tabs, 'd', 'b', true).map((tab) => tab.id)).toEqual(['a', 'b', 'd', 'c']);
  });

  it('is a no-op when ids are missing or identical', () => {
    expect(moveTabById(tabs, 'a', 'a', true)).toBe(tabs);
    expect(moveTabById(tabs, 'x', 'b', true)).toBe(tabs);
    expect(moveTabById(tabs, 'a', 'x', true)).toBe(tabs);
  });
});

describe('insertTabAfter', () => {
  it('inserts right after the anchor tab', () => {
    const tabs = [{ id: 'a' }, { id: 'b' }];
    expect(insertTabAfter(tabs, { id: 'c' }, 'a').map((tab) => tab.id)).toEqual(['a', 'c', 'b']);
  });

  it('appends when the anchor is missing', () => {
    const tabs = [{ id: 'a' }];
    expect(insertTabAfter(tabs, { id: 'c' }, 'zz').map((tab) => tab.id)).toEqual(['a', 'c']);
  });
});

describe('nextCopyName', () => {
  it('uses a plain copy suffix first', () => {
    expect(nextCopyName([], 'Local')).toBe('Local (copy)');
  });

  it('increments the counter past existing copies', () => {
    expect(nextCopyName(['Local (copy)'], 'Local')).toBe('Local (copy 2)');
    expect(nextCopyName(['Local (copy)', 'Local (copy 2)'], 'Local')).toBe('Local (copy 3)');
  });

  it('ignores copies of other tab names', () => {
    expect(nextCopyName(['Other (copy)'], 'Local')).toBe('Local (copy)');
  });
});

describe('tabDisplayLabel', () => {
  it('prefers manual renames over dynamic titles', () => {
    expect(tabDisplayLabel({ name: 'Local', manualTitle: true, dynamicTitle: 'vim' })).toBe(
      'Local'
    );
  });

  it('uses the trimmed dynamic title when not manually renamed', () => {
    expect(tabDisplayLabel({ name: 'Local', dynamicTitle: ' vim ~ ' })).toBe('vim ~');
  });

  it('falls back to the name for empty dynamic titles', () => {
    expect(tabDisplayLabel({ name: 'Local', dynamicTitle: '   ' })).toBe('Local');
    expect(tabDisplayLabel({ name: 'Local' })).toBe('Local');
  });
});
