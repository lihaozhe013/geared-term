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

## Revision (2026-09-23)

The original decision set the default to 0, which inverted the original complaint: the shell prompt
then hugged the workspace edge. Reviewing the reference terminals showed their defaults are static
and in practice non-zero - Windows Terminal `padding` is `8, 8, 8, 8`, VS Code adds 20 px of left
padding to `.xterm`, and WezTerm defaults to 1 cell left/right and 0.5 cell top/bottom - and none of
them vary padding by mode. Their full-screen programs therefore always carry a frame.

geared-term can do better because it already tracks the alternate screen buffer. The revised
decision supersedes items 2-3 above:

1. **Default.** The schema default and `defaultSettings` value become 12, so records written before
   the field existed resolve to the shell inset rather than the edge-to-edge layout.
2. **Shell vs full-screen.** `terminalPadding` applies while the normal buffer is active. When the
   active pane has entered the alternate screen buffer (`CSI ?47`, `?1047`, or `?1049`), the
   `.terminal-surface[data-alternate-screen='true']` rule forces a 0 padding so full-screen programs
   fill the workspace.
3. **Wiring.** `App` derives the attribute from the existing `alternateScreens` map, which
   `TerminalPane` populates via its alternate-screen parser handlers. Toggling the attribute resizes
   `.terminal-host`, so the running `ResizeObserver` re-fits the active pane and informs the pty.

Trade-off: entering or leaving a full-screen program changes the grid dimensions, so xterm may
reflow the last lines of shell output once per transition. Mainstream terminals avoid that reflow by
never changing padding, at the cost of a permanent frame around full-screen programs.

Programs that do not use the alternate screen (REPLs, `ssh`, progress output) keep the inset.

## Revision (2026-09-24)

Full-screen programs such as lazygit and tmux can benefit from a smaller frame than the shell, and
some TUI applications provide no internal padding control. The zero-padding policy is therefore
replaced with an independent full-screen setting:

1. **Field.** `SettingsRecord` gains `fullScreenTerminalPadding`, an integer number of logical
   pixels in the range 0-32. It defaults to 8 in the schema and new settings, so existing records
   parse without a migration.
2. **Application.** Normal-buffer `terminalPadding` remains unchanged. The alternate-screen CSS rule
   uses `fullScreenTerminalPadding`; changing either setting resizes the terminal host and the
   existing `ResizeObserver` re-fits the active pane.
3. **Presentation.** Settings - Appearance exposes the full-screen padding beside the normal-buffer
   setting. Both values are validated by the existing settings schema and persisted in the current
   settings JSON.

The settings apply uniformly to all programs detected in the alternate screen buffer. Programs that
do not enter that buffer continue to use normal-buffer padding.
