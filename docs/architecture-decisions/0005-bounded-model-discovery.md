# ADR 0005: Bounded model discovery results

- Status: Accepted
- Date: 2026-09-24
- Relates to: `SPEC.md` AI-005

## Context

The discovery response crossed the existing main/preload/renderer boundary with a 256-model cap,
which matches the saved-model limit. Large provider catalogs can contain many more models, making
the discovery picker unable to search entries beyond the first 256.

## Decision

1. Discovery returns at most 4,096 unique model IDs and a `truncated` flag that is true only when
   another valid unique ID exists beyond that bound.
2. The existing preload and IPC operation remain in place. Its validated response schema accepts the
   larger bounded list and requires the truncation flag.
3. Saved AI connections retain their current 256-model maximum. The settings picker searches the
   discovery result locally, displays up to 100 matches at a time, and tells the user when discovery
   was truncated.

## Consequences

- Models after the first 256 provider results can be found and added to a connection.
- Provider catalogs larger than 4,096 entries remain bounded across the process boundary and are
  explicitly identified as partial.
- Adding a discovered model does not change the saved connection model limit.
