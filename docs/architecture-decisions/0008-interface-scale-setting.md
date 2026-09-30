# ADR 0008: Independently persisted interface scale

Status: Accepted

## Context

The UI font size setting controls interface typography and some related chrome dimensions, but many
controls, gaps, and panel widths remain fixed. Users need a separate scale control for application
UI without changing terminal glyph size or terminal padding.

## Decision

- Persist `uiScalePercent` in the existing version-1 settings record as an integer from 75 to 150 in
  increments of 5, defaulting to 100 for existing settings.
- Apply the scale to fixed renderer UI dimensions, icons, and side-panel widths in the main and
  auxiliary windows. Persist side-panel widths as design dimensions and scale them only when
  rendering and interpreting pointer movement.
- Keep terminal font size and normal-buffer/full-screen terminal padding on their dedicated
  settings.
- Keep the settings schema version unchanged; the field default makes prior settings records valid.

## Consequences

Small windows can require horizontal or vertical scrolling at larger scale values. The default value
preserves the current 100% interface dimensions. UI font size remains independently stored and
continues to affect the existing typography tokens.

## Verification

Protocol tests cover the default, bounds, and increments. Playwright E2E verifies persistence,
scaling in the main and settings windows, terminal font independence, and layout at both limits.
