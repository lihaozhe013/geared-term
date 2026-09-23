# Geared Term

Geared Term is a cross-platform desktop terminal built with Electron, TypeScript, React, and
xterm.js. It brings local shells, WSL distributions, SSH connections, file transfer, environment
context, and an API-based AI assistant into one workspace, so day-to-day development and operations
work happens in a single window instead of scattered tools.

## Features

### Sessions and connections

- Local terminal sessions with configurable executable, arguments, and working directory
- WSL distribution discovery and one-click launch on Windows (ConPTY-based)
- SSH connections with password and private-key authentication, passphrase support, and strict
  host-key verification (unknown and changed keys fail closed)
- Multiple terminal tabs with independent sessions, environment context, and AI conversations
- Saved session profiles grouped in a collapsible sidebar, plus one-shot temporary SSH connections

### Files and transfers

- Dual-pane SFTP browser for SSH sessions: upload, download, recursive operations, cancellation, and
  byte-progress transfers
- Bidirectional directory synchronization between the SFTP panel and shell `cd` navigation
- Single-pane local file browser for ordinary local shells with the full set of filesystem actions
- Size-bounded remote file editing with save-conflict detection

### Security and storage

- Encrypted credential vault (AES-256-GCM, PBKDF2-derived master password) with transactional
  password rotation
- Optional password-free unlock backed by the OS key service, never by a silent weak fallback
- Secrets never reach the renderer; the database, PTY, SSH, and SFTP layers live exclusively in the
  main process behind validated IPC
- Session profiles, secrets, AI connections, and environment records persisted in an embedded,
  migration-safe SQLite database

### AI assistant

- OpenAI Responses and OpenAI-compatible Chat Completions endpoints, multiple named connections,
  model discovery, and per-chat model selection
- Terminal context (selection or viewport snapshot) attached to prompts as clearly delimited
  untrusted observations
- Shell code blocks split into reviewable command cards with separate Copy, Insert, and Run actions
  — Insert never submits, Run always requires an explicit click
- Human-readable Markdown conversation history with continuation support

### Terminal experience and appearance

- xterm.js rendering with WebGL, Unicode/CJK/emoji, ligature detection, and search
- Terminal font zoom, custom font fallback chains, and configurable line height
- Built-in dark theme plus the Catppuccin family, and user themes loaded from JSON files
- Rebindable keyboard shortcuts with conflict reporting
- English and Simplified Chinese interfaces, and background-to-tray mode on Windows/Linux

## Supported platforms

| Platform       | Artifact                            |
| -------------- | ----------------------------------- |
| Windows x86-64 | NSIS installer and portable archive |
| macOS arm64    | `.dmg`                              |
| Linux x86-64   | AppImage                            |

## Nightly downloads

Geared Term publishes automated nightly builds for all three supported platforms. Every nightly run
replaces the rolling `nightly` prerelease on GitHub with fresh artifacts built from the latest
published commit.

Grab the latest build from the
[nightly release page](https://github.com/lihaozhe013/geared-term/releases/tag/nightly), or
directly:

- [Windows installer](https://github.com/lihaozhe013/geared-term/releases/download/nightly/geared-term-windows-x64-setup.exe)
- [Windows portable](https://github.com/lihaozhe013/geared-term/releases/download/nightly/geared-term-windows-x64-portable.exe)
- [macOS (arm64) DMG](https://github.com/lihaozhe013/geared-term/releases/download/nightly/geared-term-macos-arm64.dmg)
- [Linux (x86-64) AppImage](https://github.com/lihaozhe013/geared-term/releases/download/nightly/geared-term-linux-x64.AppImage)

The release also ships `SHA256SUMS.txt` covering every artifact, so you can verify what you
downloaded.

A few things to know about nightlies:

- Nightly builds are unsigned development artifacts. macOS Gatekeeper will warn on first launch
  because no developer signing is applied yet.
- The Windows installer build checks the nightly channel automatically after startup and once per
  day, downloads updates, and offers in-app installation. Portable, macOS, and Linux builds detect
  new nightlies and link you to the release page for manual download.
- "Check for Updates" is available at any time under Settings → About.
- Nightly quality is best-effort: each build only publishes after the full typecheck, unit test,
  Electron E2E, and packaged-startup smoke pipeline succeeds, but treat it as an unstable channel.

## Documentation

- [`SPEC.md`](SPEC.md) — normative behavior specification
- [`docs/architecture.md`](docs/architecture.md) — implementation design and process boundaries
- [`docs/requirements-matrix.md`](docs/requirements-matrix.md) — implementation status and evidence

## License

MIT
