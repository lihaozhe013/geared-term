# ADR 0003: Persisted saved session ordering

- Status: Accepted
- Date: 2026-09-23
- Relates to: SPEC.md SES-013, SES-014

## Context

The saved session sidebar groups profiles by their optional group name. Users need to choose the
order of sessions and groups, and expect that order to survive application restarts. A group must
also be able to exist without profiles so users can prepare a destination before moving sessions.
Moving a session between groups is a profile edit, so its membership and visual position must change
together.

## Decision

1. Store a rank on each session profile and a separate rank for each named group in the profile
   database. Keep ungrouped sessions at the top. A named group may have zero profiles.
2. Migration 3 initializes profile ranks from the former updated-at and identifier ordering, and
   initializes group ranks from the first profile in each group. New profiles and newly created
   groups append to their section. Empty group rows remain until explicitly deleted.
3. Expose validated group list, create, and delete IPC operations. Group creation appends a trimmed,
   bounded unique name. Group deletion succeeds only when the group has no profiles.
4. Expose one validated profile reorder IPC request containing the ordered ungrouped profile IDs and
   every ordered named group, including groups with no profile IDs. The main process validates that
   every saved profile and group appears exactly once, then persists profile ranks, group ranks, and
   group membership in one transaction.
5. Dragging a session to another group changes its group membership. Dragging a group header changes
   only the group order. Editing a profile into a different group appends it to that group.

## Security review

The IPC accepts only bounded group names and profile IDs; it does not accept connection targets,
credential fields, filesystem paths, or process commands. The main process parses strict shared
schemas, rejects blank, duplicate, missing, stale, or unknown names and identifiers, and applies
each mutation transactionally. Group deletion checks membership in the main process even when the
renderer offers the action only for empty groups. The preload exposes only these validated,
business-named operations.

## Consequences

The existing group-order table already stores named group rows, so supporting empty groups requires
no database migration. Profile and group order follows the same local data lifecycle and remains
available after restart.
