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
  const profiles = [{ id: 'p1', name: 'web-01' }];

  it('prefers manual renames over live profile names', () => {
    expect(
      tabDisplayLabel({ name: 'Draft', manualTitle: true, sourceProfileId: 'p1' }, profiles)
    ).toBe('Draft');
  });

  it('follows the live profile name', () => {
    expect(tabDisplayLabel({ name: 'stale', sourceProfileId: 'p1' }, profiles)).toBe('web-01');
  });

  it('falls back to the snapshot when the profile is gone or blank', () => {
    expect(tabDisplayLabel({ name: 'Removed', sourceProfileId: 'p1' }, [])).toBe('Removed');
    expect(tabDisplayLabel({ name: 'Removed', sourceProfileId: 'p1' })).toBe('Removed');
    expect(
      tabDisplayLabel({ name: 'Fallback', sourceProfileId: 'p1' }, [{ id: 'p1', name: '  ' }])
    ).toBe('Fallback');
  });

  it('keeps the snapshot name for tabs not opened from a profile', () => {
    expect(tabDisplayLabel({ name: 'Local' }, profiles)).toBe('Local');
    expect(tabDisplayLabel({ name: 'Local', sourceProfileId: 'p9' }, profiles)).toBe('Local');
  });
});
