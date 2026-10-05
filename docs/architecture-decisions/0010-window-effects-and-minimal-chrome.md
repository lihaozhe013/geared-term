# ADR 0010: Window effects and minimal chrome

Status: Accepted

## Context

The application needs optional translucent and frosted main-window backgrounds, plus a compact
layout that puts its application menu, terminal tabs, and window controls into one top row. Window
surface effects have operating-system and compositor requirements. A transparent BrowserWindow also
changes native resize and maximize behavior, and xterm must enable transparency before it opens.

## Decision

- Persist `minimalMode`, `windowEffect`, and `windowBackgroundOpacityPercent` in the existing
  version-1 settings record. Defaults for new settings are `true`, `frosted`, and `25`; opacity is
  an integer from 0 through 100 in increments of 5. Zero removes the renderer theme tint and 100
  fully covers the native backdrop. Zod defaults keep existing settings valid.
- Apply effects only to the main window. Auxiliary windows remain solid so settings are available to
  recover from a poor main-window appearance choice.
- Create the main BrowserWindow with a transparent native surface only when its saved startup effect
  needs it. A live session that started solid cannot change its native window backing or xterm's
  `allowTransparency` capability. Preserve the requested setting, report that restart is required,
  and do not recreate terminal sessions.
- Apply opacity to renderer surface tints, never to the whole native window, so foreground text and
  controls retain full contrast. Give each visible workspace region one tinted background owner;
  nested layout containers and panels remain transparent. Keep theme colors opaque in storage.
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

- Existing installs keep their saved effect, opacity, and layout; new settings start with minimal
  chrome and frosted glass at 25% background opacity. No settings migration is required. Builds
  predating this range change reject saved opacity values below 60%, so raise the value to at least
  60% before downgrading to one of those builds.
- Selecting translucency/frosted glass from a solid-started window requires restarting the
  application. Opacity and transitions between translucent and supported frosted glass can apply
  live when the window started with transparency enabled.
- Transparent native windows have platform limitations; each release target needs manual native
  smoke evidence before the effect is considered supported there.
- Linux frosted glass remains unavailable without a verified compositor-specific implementation.
- Renderer surface changes must be inspected over real desktop content; screenshots in an opaque or
  headless BrowserWindow cannot establish native translucency.
- Existing Playwright `window-effects.spec.ts` coverage composites the side panel, terminal, and top
  bar over a fixed color in standard and minimal mode at 60%, 75%, and 100%. Automated coverage for
  the expanded lower range is pending.
- An isolated macOS desktop comparison at 25% opacity confirms the under-window material can show
  blurred desktop color. The full development and packaged matrix for focus changes, resize,
  maximize/restore, and fullscreen recovery remains open. Linux translucency also needs verification
  on named compositor sessions. Unsupported Linux blur is reported and falls back to translucency.

## Security review

Appearance settings are non-secret values parsed by the existing strict settings schema and
persisted by the existing atomic settings store. No new IPC operation, preload capability, URL,
filesystem access, process spawn, or command execution path is introduced. Renderer menu actions
continue through the existing main-process allowlist. Platform material calls use the BrowserWindow
already owned by the main process.

## Verification

- Type checking, build, and automated tests have not been run for this update; manual verification
  remains with the user.
- Main-process construction sets launch-time backing and native material using platform capability
  checks, and macOS launch vibrancy follows the system window focus state. Existing settings IPC
  remains the only settings write path; no preload operation was added.
- Existing Playwright `window-effects.spec.ts` coverage composites the side panel, terminal, and top
  bar over a fixed color in standard and minimal mode at 60%, 75%, and 100%. Main-process unit tests
  cover macOS material and focus-state configuration. Tests for the expanded range were not added or
  run in this update.
- Cross-platform packaged visual smoke checks remain open for resize, maximize/restore, fullscreen,
  native material behavior, and macOS Reduce Transparency state. Linux translucency also needs
  verification on named compositor sessions. Unsupported Linux blur is reported and falls back to
  translucency.
