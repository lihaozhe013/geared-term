import { describe, expect, it } from 'vitest';
import { createSidebarOrder, moveSidebarGroup, moveSidebarProfile } from './sidebar-ordering';

const profiles = [
  { id: 'u1', group: undefined },
  { id: 'a1', group: 'Alpha' },
  { id: 'a2', group: 'Alpha' },
  { id: 'b1', group: 'Beta' }
] as const;

describe('createSidebarOrder', () => {
  it('keeps ungrouped sessions first and preserves section order', () => {
    expect(createSidebarOrder(profiles)).toEqual({
      ungroupedIds: ['u1'],
      groups: [
        { name: 'Alpha', profileIds: ['a1', 'a2'] },
        { name: 'Beta', profileIds: ['b1'] }
      ]
    });
  });

  it('merges group names after trimming whitespace', () => {
    expect(
      createSidebarOrder([
        { id: 'a1', group: ' Alpha ' },
        { id: 'a2', group: 'Alpha' }
      ])
    ).toEqual({ ungroupedIds: [], groups: [{ name: 'Alpha', profileIds: ['a1', 'a2'] }] });
  });
});

describe('moveSidebarProfile', () => {
  const order = createSidebarOrder(profiles);

  it('reorders a session within its group', () => {
    expect(
      moveSidebarProfile(order, 'a1', { kind: 'profile', profileId: 'a2', after: true }).groups[0]
        ?.profileIds
    ).toEqual(['a2', 'a1']);
  });

  it('moves a session before a row in another group', () => {
    const next = moveSidebarProfile(order, 'a2', {
      kind: 'profile',
      profileId: 'b1',
      after: false
    });
    expect(next.groups).toEqual([
      { name: 'Alpha', profileIds: ['a1'] },
      { name: 'Beta', profileIds: ['a2', 'b1'] }
    ]);
  });

  it('moves a session into an ungrouped list and removes an empty group', () => {
    const next = moveSidebarProfile(order, 'b1', { kind: 'ungrouped' });
    expect(next.ungroupedIds).toEqual(['u1', 'b1']);
    expect(next.groups).toEqual([{ name: 'Alpha', profileIds: ['a1', 'a2'] }]);
  });

  it('appends to a collapsed group header target', () => {
    expect(moveSidebarProfile(order, 'u1', { kind: 'group', name: 'Beta' }).groups[1]).toEqual({
      name: 'Beta',
      profileIds: ['b1', 'u1']
    });
  });

  it('returns the existing order for missing or identical targets', () => {
    expect(
      moveSidebarProfile(order, 'a1', { kind: 'profile', profileId: 'a1', after: false })
    ).toBe(order);
    expect(
      moveSidebarProfile(order, 'a1', { kind: 'profile', profileId: 'missing', after: false })
    ).toBe(order);
  });
});

describe('moveSidebarGroup', () => {
  it('moves a group before or after another group', () => {
    expect(moveSidebarGroup(createSidebarOrder(profiles), 'Beta', 'Alpha', false).groups).toEqual([
      { name: 'Beta', profileIds: ['b1'] },
      { name: 'Alpha', profileIds: ['a1', 'a2'] }
    ]);
    expect(moveSidebarGroup(createSidebarOrder(profiles), 'Alpha', 'Beta', true).groups).toEqual([
      { name: 'Beta', profileIds: ['b1'] },
      { name: 'Alpha', profileIds: ['a1', 'a2'] }
    ]);
  });

  it('returns the existing order when a group target is missing or identical', () => {
    const order = createSidebarOrder(profiles);
    expect(moveSidebarGroup(order, 'Alpha', 'Alpha', true)).toBe(order);
    expect(moveSidebarGroup(order, 'Alpha', 'missing', true)).toBe(order);
  });
});
