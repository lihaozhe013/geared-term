# ADR 0003: Persisted saved session ordering

- Status: Accepted
- Date: 2026-09-23
- Relates to: SPEC.md SES-013

## Context

The saved session sidebar groups profiles by their optional group name. Users need to choose the
order of sessions and groups, and expect that order to survive application restarts. Moving a
session between groups is also a profile edit, so its group membership and visual position must
change together.

## Decision

1. Store a rank on each session profile and a separate rank for each named group in the profile
   database. Keep ungrouped sessions at the top.
2. Migration 3 initializes profile ranks from the former updated-at and identifier ordering, and
   initializes group ranks from the first profile in each group. New profiles and newly created
   groups append to their section.
3. Expose one validated profile reorder IPC request containing the ordered ungrouped profile IDs and
   ordered named groups with their profile IDs. The main process validates that every saved profile
   appears exactly once and that requested group names already exist, then persists profile ranks,
   group ranks, and group membership in one transaction.
4. Dragging a session to another group changes its group membership. Dragging a group header changes
   only the group order. Editing a profile into a different group appends it to that group.

## Security review

The new IPC accepts only bounded profile IDs and group names; it does not accept connection targets,
credential fields, filesystem paths, or process commands. The main process parses the strict shared
schema, rejects missing, duplicate, stale, or unknown identifiers and group names, and applies the
change transactionally. The preload exposes only the validated reorder operation.

## Consequences

The existing SQLite backup-before-migration path protects the version 2 database. Profile and group
order is stored alongside the saved profiles, so it follows the same local data lifecycle and
remains available after restart.
