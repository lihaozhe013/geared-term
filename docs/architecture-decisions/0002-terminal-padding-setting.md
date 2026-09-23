# ADR 0002: Configurable terminal padding

- Status: Accepted
- Date: 2026-09-23
- Relates to: `SPEC.md` SET-002, SET-004

## Context

The terminal surface carried a fixed 18 px padding inherited from the original card-style layout.
Full-screen TUI programs (for example lazygit or opencode) paint their own background and borders
inside the xterm cell grid, so that padding reads as a large asymmetric gutter around the program:
18 px on the left/top, and roughly 32-40 px on the right because FitAddon additionally reserves 14
px for the scrollbar gutter. Mainstream terminals default to 0-8 px and usually expose the value as
a user setting (Windows Terminal `padding`, iTerm2 margins, Hyper/Tabby CSS padding).

Removing the padding requires persisting a new user preference.

## Decision

1. **Field.** `SettingsRecord` gains `terminalPadding`, an integer number of logical pixels in the
   range 0-32. The persisted settings schema version stays at 1; the field uses a schema default of
   0, so records written before the field existed parse unchanged and resolve to the edge-to-edge
   layout (SET-004).
2. **Default.** The default is 0. The terminal fills the workspace edge to edge, matching VS Code;
   the remaining right/bottom sliver is the cell-grid quantization plus xterm's fixed scrollbar
   gutter, which is unchanged.
3. **Application.** The value is published to the renderer as the `--gt-terminal-padding` CSS custom
   property and consumed by `.terminal-surface`. Changing it resizes `.terminal-host`, which the
   existing `ResizeObserver` already observes, so `FitAddon` re-fits without extra wiring.
4. **Presentation.** The value is edited in Settings - Appearance beside font size and line height.
   Non-integer, negative, and greater-than-32 values are rejected by the schema.

## Consequences

- Existing profiles keep working with no migration step; the new default makes terminal content
  flush with the workspace while remaining adjustable up to the old spacing.
- The setting is part of the versioned settings JSON, so backup/restore and the existing atomic
  write path cover it automatically.
- No process boundary, secret access, or IPC surface changes; only the renderer layout consumes it.
