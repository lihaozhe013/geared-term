# ADR 0009: Optional terminal context menu on right-click

Status: Accepted

## Context

Some terminal applications use the right mouse button for their own interactions. The application
currently handles right-click to show its terminal context menu, which prevents those mouse events
from reaching the terminal program. Users need to choose which behavior owns the right button.

## Decision

- Persist `showTerminalContextMenuOnRightClick` in the existing settings record as a boolean,
  defaulting to `true` for new and existing settings.
- Provide the preference in Terminal settings, the renderer View menu, and the native View menu.
  Each surface reads and updates the same validated setting.
- When enabled, stop the right-button event from reaching xterm and show the application terminal
  context menu. When disabled, suppress the browser context menu and allow xterm to report the mouse
  event to the terminal program.
- Forward xterm `onBinary` input through the existing terminal MessagePort. The protocol accepts at
  most 64 KiB of input and, for binary messages, permits only byte-valued characters (`0x00` through
  `0xff`). The local PTY and SSH backends reconstruct those values as raw bytes before writing. Text
  input remains unchanged.
- Keep the settings schema version and terminal MessagePort boundary unchanged. No new IPC channel,
  operation, filesystem access, process capability, or secret access is introduced.

## Security review

The new setting is non-secret and validated with the existing strict settings schema. Renderer menu
actions are allowlisted in the main process and only toggle this persisted preference. Binary input
is size-bounded and validated at both preload and main-process MessagePort boundaries; invalid
binary characters cause the existing terminal protocol failure path to close the session. Raw input
bytes are written only to the PTY or SSH channel already owned by that terminal session.

## Consequences

The default preserves current application behavior. With the preference disabled, the app continues
to prevent the browser's own context menu from appearing while xterm receives right-click reports.
The terminal application's behavior depends on its active mouse reporting mode.

## Verification

Protocol tests cover the setting default and binary-input byte boundary. Backend tests assert that
binary values are written as raw bytes. Playwright E2E covers setting and menu synchronization,
restart persistence, and delivery of a right-click report to a controlled local terminal.
