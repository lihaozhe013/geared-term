# ADR 0010: Window effects and minimal chrome

Status: Accepted

## Context

The application needs optional translucent and frosted main-window backgrounds, plus a compact
layout that puts its application menu, terminal tabs, and window controls into one top row. Window
surface effects have operating-system and compositor requirements. A transparent BrowserWindow also
changes native resize and maximize behavior, and xterm must enable transparency before it opens.

## Decision

- Persist `minimalMode`, `windowEffect`, and `windowBackgroundOpacityPercent` in the existing
  version-1 settings record. Defaults are `false`, `solid`, and `85`; opacity is an integer from 60
  through 100 in increments of 5. Zod defaults keep existing settings valid.
- Apply effects only to the main window. Auxiliary windows remain solid so settings are available to
  recover from a poor main-window appearance choice.
- Create the main BrowserWindow with a transparent native surface only when its saved startup effect
  needs it. A live session that started solid cannot change its native window backing or xterm's
  `allowTransparency` capability. Preserve the requested setting, report that restart is required,
  and do not recreate terminal sessions.
- Apply opacity to renderer surface tints, never to the whole native window, so foreground text and
  controls retain full contrast. Keep theme colors opaque in storage.
- Use Electron vibrancy on macOS and the native acrylic material on Windows 11 22H2 or newer. Use
  ordinary window translucency on supported compositor sessions. Electron has no general Linux
  backdrop-blur API; Linux reports frosted glass as unavailable and falls back to translucency.
- Preserve native macOS traffic lights and the native macOS application menu. Use the existing
  renderer-owned window buttons on Windows and Linux.
- Render the compact menu from the existing allowlisted menu model. Keep settings and window changes
  on the existing validated settings IPC; do not add preload methods or process privileges.
- Switching standard/minimal chrome is immediate. The terminal workspace remains mounted, and the
  existing session, PTY, SSH, xterm, stream, and transfer lifecycles are not restarted.

## Consequences

- Existing installs stay solid and use the current standard layout until users opt in.
- Selecting translucency/frosted glass from a solid-started window requires restarting the
  application. Opacity and transitions between translucent and supported frosted glass can apply
  live when the window started with transparency enabled.
- Transparent native windows have platform limitations; each release target needs manual native
  smoke evidence before the effect is considered supported there.
- Linux frosted glass remains unavailable without a verified compositor-specific implementation.
- Renderer surface changes must be inspected over real desktop content; screenshots in an opaque or
  headless BrowserWindow cannot establish native translucency.

## Security review

Appearance settings are non-secret values parsed by the existing strict settings schema and
persisted by the existing atomic settings store. No new IPC operation, preload capability, URL,
filesystem access, process spawn, or command execution path is introduced. Renderer menu actions
continue through the existing main-process allowlist. Platform material calls use the BrowserWindow
already owned by the main process.

## Verification

- `pnpm typecheck` and `pnpm build` pass for the implementation.
- Main-process construction sets launch-time backing and native material using platform capability
  checks. Existing settings IPC remains the only settings write path; no preload operation was
  added.
- Cross-platform packaged visual smoke checks remain open for resize, maximize/restore, fullscreen,
  and native material behavior. Linux translucency also needs verification on named compositor
  sessions. Unsupported Linux blur is reported and falls back to translucency.
