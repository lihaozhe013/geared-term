/** Pure helper for the configurable tab-bar "+" button and the new-tab
 *  keyboard/menu command. Uses the `newTabProfileId` setting (null = local
 *  shell) and resolves it against the live saved-session list. */

import type { SessionProfileRecord } from '@geared-term/protocol';

export type NewTabTarget =
  | { kind: 'local' }
  | { kind: 'profile'; profile: SessionProfileRecord };

export function resolveNewTabTarget(
  profileId: string | null | undefined,
  profiles: SessionProfileRecord[]
): NewTabTarget {
  if (!profileId) return { kind: 'local' };
  const profile = profiles.find((p) => p.id === profileId);
  if (!profile) return { kind: 'local' };
  return { kind: 'profile', profile };
}
