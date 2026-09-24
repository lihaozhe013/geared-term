import type { ProfileOrderRequest, SessionProfileRecord } from '@geared-term/protocol';

export type SidebarOrder = ProfileOrderRequest;

export type SidebarProfileDropTarget =
  | { kind: 'profile'; profileId: string; after: boolean }
  | { kind: 'group'; name: string }
  | { kind: 'ungrouped' };

export function createSidebarOrder(
  profiles: readonly Pick<SessionProfileRecord, 'id' | 'group'>[],
  groupNames: readonly string[] = []
): SidebarOrder {
  const ungroupedIds: string[] = [];
  const groups = new Map<string, string[]>(groupNames.map((name) => [name, []]));

  for (const profile of profiles) {
    const groupName = profile.group?.trim();
    if (!groupName) {
      ungroupedIds.push(profile.id);
      continue;
    }
    const profileIds = groups.get(groupName);
    if (profileIds) profileIds.push(profile.id);
    else groups.set(groupName, [profile.id]);
  }

  return {
    ungroupedIds,
    groups: Array.from(groups, ([name, profileIds]) => ({ name, profileIds }))
  };
}

export function moveSidebarProfile(
  order: SidebarOrder,
  profileId: string,
  target: SidebarProfileDropTarget
): SidebarOrder {
  if (target.kind === 'profile' && target.profileId === profileId) return order;

  const sourceGroup = order.groups.find((group) => group.profileIds.includes(profileId));
  const isUngrouped = order.ungroupedIds.includes(profileId);
  if (!sourceGroup && !isUngrouped) return order;

  const ungroupedIds = order.ungroupedIds.filter((id) => id !== profileId);
  const groups = order.groups.map((group) => ({
    name: group.name,
    profileIds: group.profileIds.filter((id) => id !== profileId)
  }));

  let destinationGroupName: string | null;
  if (target.kind === 'ungrouped') {
    destinationGroupName = null;
  } else if (target.kind === 'group') {
    destinationGroupName = target.name;
  } else {
    destinationGroupName =
      groups.find((group) => group.profileIds.includes(target.profileId))?.name ?? null;
    if (destinationGroupName === null && !ungroupedIds.includes(target.profileId)) {
      return order;
    }
  }

  const movedGroup = groups.find((group) => group.name === destinationGroupName);
  if (destinationGroupName && !movedGroup) {
    if (sourceGroup?.name !== destinationGroupName) return order;
    groups.splice(
      Math.min(
        order.groups.findIndex((group) => group.name === destinationGroupName),
        groups.length
      ),
      0,
      { name: destinationGroupName, profileIds: [] }
    );
  }

  if (target.kind === 'profile') {
    const targetIsUngrouped = ungroupedIds.includes(target.profileId);
    if (destinationGroupName === null && !targetIsUngrouped) return order;
  }

  if (destinationGroupName === null) {
    const insertAt =
      target.kind === 'profile'
        ? ungroupedIds.indexOf(target.profileId) + (target.after ? 1 : 0)
        : ungroupedIds.length;
    if (insertAt < 0) return order;
    ungroupedIds.splice(insertAt, 0, profileId);
  } else {
    const destination = groups.find((group) => group.name === destinationGroupName);
    if (!destination) return order;
    const targetIndex =
      target.kind === 'profile' ? destination.profileIds.indexOf(target.profileId) : -1;
    if (target.kind === 'profile' && targetIndex < 0) return order;
    const insertAt =
      target.kind === 'profile'
        ? targetIndex + (target.after ? 1 : 0)
        : destination.profileIds.length;
    destination.profileIds.splice(insertAt, 0, profileId);
  }

  return { ungroupedIds, groups };
}

export function moveSidebarGroup(
  order: SidebarOrder,
  groupName: string,
  targetName: string,
  after: boolean
): SidebarOrder {
  if (groupName === targetName) return order;
  const from = order.groups.findIndex((group) => group.name === groupName);
  const target = order.groups.findIndex((group) => group.name === targetName);
  if (from < 0 || target < 0) return order;

  const groups = order.groups.slice();
  const [moved] = groups.splice(from, 1);
  if (!moved) return order;
  const targetIndex = groups.findIndex((group) => group.name === targetName);
  if (targetIndex < 0) return order;
  groups.splice(after ? targetIndex + 1 : targetIndex, 0, moved);
  return { ungroupedIds: order.ungroupedIds, groups };
}
