# Geared Term Product Specification

> Status: Draft for implementation approval
>
> Last updated: 2026-09-19
>
> Target repository: `E:\dev\geared-term`

## 1. Purpose

This specification defines Geared Term, a standalone Electron, TypeScript, React, and xterm.js
desktop terminal application. It covers local PTYs, WSL, SSH, SFTP, the encrypted vault, terminal
environment detection, API-based AI chat, conversation history, and cross-platform packaging.

The specification is a behavioral product definition. It is independent of any other codebase and
imposes no compatibility obligations on any other application's data formats.

The key words **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are normative.

## 2. Sources and precedence

The specification was derived from:

1. the product goals of a dependable daily-use terminal with integrated file transfer and an AI
   assistant;
2. [`docs/web-llm-page-support-requirements.md`](docs/web-llm-page-support-requirements.md), only to
   keep that separate feature out of this product.

When sources disagree, the following order applies:

1. security, data integrity, and explicit safety invariants in this specification;
2. explicit requirements and product decisions in this specification;
3. recorded architecture decisions in the implementation plan.

## 3. Product goals

The initial release MUST:

- provide a dependable daily-use terminal for local shells, WSL, and SSH;
- preserve saved sessions, groups, authentication choices, terminal settings, and host trust;
- provide the integrated SFTP and AI assistant workflows;
- keep terminal I/O independent from React rendering and AI availability;
- keep secrets and privileged resources outside the renderer;
- provide the keyboard, focus, selection, and panel behavior defined in this specification unless an
  intentional exception is listed below;
- produce installable or portable artifacts for the supported release platforms;
- establish typed, validated boundaries that can support later product work without replacing the
  terminal core again.

## 4. Non-goals

The initial release MUST NOT include:

- direct embedding or DOM integration of third-party LLM websites;
- an autonomous agent loop or unattended command execution;
- SSH agent authentication, keyboard-interactive authentication, jump hosts, port forwarding, or
  automatic reconnect;
- WSL installation, import, uninstall, global shutdown, custom in-distro shell selection, or WSL
  SFTP browsing;
- restoration of live PTY or SSH handles after an application restart;
- multiple terminal panes or terminal splits. The product layout has terminal tabs and a
  terminal/right-panel split, not multiple simultaneous terminal panes;
- storage of unlimited terminal scrollback or background upload of terminal content;
- changing the established product UX merely to make it look more like a generic Electron app;
- reading or converting data formats belonging to any other application.

## 5. Normative product decisions

These decisions define behavior that a straightforward implementation might otherwise get wrong.

| Area                | Geared Term requirement                                                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Terminal engine     | xterm.js owns VT state, display, selection, and scrollback.                                                                                           |
| AI command action   | Copy, Insert, and Run are separate. Insert MUST never submit. Run requires an explicit click.                                                         |
| Implicit submit     | No setting may cause inserted command text to be submitted automatically.                                                                             |
| Command splitting   | Optional shell-aware parsing by top-level statement, with a conservative whole-block fallback.                                                        |
| Terminal context    | Selection remains preferred; viewport and a user-bounded amount of preceding scrollback are supported with preview and truncation disclosure.         |
| External AI consent | The first request to a normalized endpoint requires consent whether or not a snapshot is attached. Endpoint changes require renewed consent.          |
| Workspace restore   | Window and panel layout only. Do not auto-reconnect or silently reopen live sessions.                                                                 |
| SFTP command launch | A configured command runs against a quoted remote path only as an explicit SFTP context-menu action. It is separate from AI command Insert/Run rules. |
| Structured storage  | Session profiles, vault-encrypted secrets, AI connections, and environment records live in one embedded SQLite database owned by the main process.    |

## 6. Supported release platforms

The initial release MUST build and smoke-test these artifacts:

| Platform       | Minimum release artifact                             | Required session backends |
| -------------- | ---------------------------------------------------- | ------------------------- |
| Windows x86-64 | Installer; portable archive SHOULD also be available | Local ConPTY, WSL, SSH    |
| macOS arm64    | `.app` and DMG                                       | Local PTY, SSH            |
| Linux x86-64   | AppImage                                             | Local PTY, SSH            |

The application architecture SHOULD remain portable to additional architectures, but an architecture
is not supported until its packaged application passes the same smoke tests.

## 7. Application shell and workspace

### 7.1 Layout

- **APP-001**: The main window MUST contain custom application chrome, a collapsible session
  sidebar, a terminal tab strip, the active terminal, and a collapsible right panel.
- **APP-002**: The right panel MUST switch between SFTP and AI Assistant views.
- **APP-003**: The divider between the terminal and right panel MUST be draggable and MUST preserve
  its last usable ratio.
- **APP-004**: The right panel MUST only expose SFTP operations when the active session has SFTP
  capability. Local and WSL sessions do not have that capability.
- **APP-005**: Multiple tabs MUST hold independent terminal sessions, terminal display state,
  environment context, and AI conversations.
- **APP-006**: Activating a tab MUST atomically update the visible terminal and every action target.
- **APP-007**: Closing a connected tab MUST require confirmation. A closed or exited session may be
  closed without a misleading disconnect warning.
- **APP-008**: A local or remote process that reports an exit status MUST leave its final screen
  visible with an exit notice and close action.

### 7.2 Restored UI state

- **APP-009**: On a clean shutdown, the application MUST persist window bounds, maximized state,
  sidebar collapsed state, active right-panel kind, right-panel collapsed state, and split ratio.
- **APP-010**: Off-screen saved bounds MUST fall back to a visible display. Restored sizes MUST be
  clamped to the current display and a usable minimum.
- **APP-011**: Corrupt or missing UI state MUST fall back to safe defaults without blocking startup.
- **APP-012**: Open tabs and live connections MUST NOT be automatically restored in the initial
  release.

### 7.3 Focus, dialogs, and feedback

- **APP-013**: A newly connected tab MUST focus the terminal.
- **APP-014**: Opening a modal MUST move focus into it so keystrokes cannot leak into the terminal.
- **APP-015**: Streaming AI updates, SFTP refreshes, and command-card updates MUST NOT steal focus.
- **APP-016**: Windows IME MUST remain available in the terminal and assistant composer and MUST not
  remain unexpectedly active on non-text controls.
- **APP-017**: Success and failure feedback MUST be visible and bounded. Errors MUST NOT fail
  silently.
- **APP-018**: Destructive SFTP and WSL actions MUST use a confirmation dialog that names the
  target.

### 7.4 Menus and keyboard behavior

The native application menu MUST provide File, Edit, View, Window, and Help functions appropriate to
each platform, including settings, temporary connection, config location, theme, language, terminal
mode, and About.

When terminal focus is active, the following behavior is required:

| Action                  | Windows/Linux       | macOS               |
| ----------------------- | ------------------- | ------------------- |
| Send interrupt          | `Ctrl+C`            | `Ctrl+C`            |
| Copy terminal selection | `Ctrl+Shift+C`      | `Cmd+C`             |
| Paste                   | `Ctrl+Shift+V`      | `Cmd+V`             |
| Select all              | `Ctrl+Shift+A`      | `Cmd+A`             |
| Search                  | `Ctrl+F`            | `Cmd+F`             |
| Send Tab/backtab        | `Tab` / `Shift+Tab` | `Tab` / `Shift+Tab` |
| Cycle terminal mode     | `F6` / `Shift+F6`   | `F6` / `Shift+F6`   |

- **APP-019**: `Ctrl+C` in terminal context MUST send ETX and MUST NOT be captured by a root copy
  binding.
- **APP-020**: Platform application shortcuts such as Quit, Minimize, Close Window, Hide, Undo,
  Redo, Cut, and Paste MUST follow native conventions.
- **APP-021**: Keyboard handling MUST preserve terminal control, Alt/Meta, navigation, function-key,
  Enter, Shift+Enter, Alt+Enter, Backspace, and backtab sequences expected by xterm-compatible
  applications.

## 8. Sessions and profiles

### 8.1 Saved sessions

- **SES-001**: The sidebar MUST display saved sessions, grouped by the optional group name, with
  expandable groups and an ungrouped section.
- **SES-002**: Users MUST be able to create, edit, connect, and delete SSH, local, and WSL sessions.
- **SES-003**: Session type MUST be immutable after creation. Editing a connection target MUST
  invalidate or switch to the corresponding environment-context record safely.
- **SES-004**: Every session MUST have a stable identifier, display name, group, TERM value, and a
  type-specific target.
- **SES-005**: An empty SSH display name defaults to `user@host`; an empty local name defaults to
  the program basename or `Local Shell`; an empty WSL name defaults to the distribution name.
- **SES-006**: Supported TERM choices MUST include `xterm-256color`, `xterm`, `vt520`, `linux`, and
  `screen`.
- **SES-007**: Deleting a local or WSL saved session MUST also delete its private environment
  record. Deleting an SSH session MUST not delete a host environment shared with another session
  having the same `user@host:port` key.

### 8.2 Temporary SSH connections

- **SES-008**: A user MUST be able to open a one-shot SSH connection from the unlock gate or the
  application menu without unlocking the saved profile.
- **SES-009**: The temporary form MUST support host, port, user, password, and imported private key.
- **SES-010**: Temporary passwords, private-key contents, and passphrases MUST remain in memory and
  MUST NOT be written to profile storage or logs.
- **SES-011**: Temporary host-key trust MUST apply only to that connection and MUST NOT modify the
  persistent known-host store.
- **SES-012**: A temporary tab MAY use normal SFTP and AI UI while it exists, but it MUST NOT gain
  persistence implicitly.

## 9. Vault and secrets

- **VLT-001**: Saved SSH passwords, private keys, private-key passphrases, and AI API keys MUST be
  encrypted at rest.
- **VLT-002**: The renderer MUST never receive stored ciphertext, a vault key, or decrypted secrets.
- **VLT-003**: First use MUST allow creation of a master password. Subsequent use MUST require
  unlock unless password-free unlock was explicitly enabled.
- **VLT-004**: Master-password derivation MUST use an approved password KDF with recorded, versioned
  parameters.
- **VLT-005**: Secret encryption MUST use authenticated encryption with a unique nonce per value.
- **VLT-006**: Locking the vault MUST zero or release decrypted secret material, remove in-memory AI
  keys, hide saved sessions, and suppress password-free unlock for the rest of that process. It MUST
  NOT silently terminate already-running sessions.
- **VLT-007**: Changing the master password MUST re-encrypt all stored session and AI secrets in one
  recoverable transaction. Partial re-encryption MUST never become the active profile.
- **VLT-008**: Password-free unlock MUST be opt-in, explain its device-local trust model, and store
  its key-encryption key separately from the wrapped vault key.
- **VLT-009**: OS-protected storage SHOULD protect the auto-unlock material. If unavailable, a
  restrictive-permission local fallback MAY be offered only with an explicit warning.
- **VLT-010**: Secret values MUST be redacted from structured errors, debug formatting, analytics,
  crash reports, and logs.

## 10. Terminal subsystem

### 10.1 Backend-neutral contract

- **TERM-001**: Local PTY and SSH backends MUST implement the same lifecycle: create, input, resize,
  output, exit, close, and structured failure.
- **TERM-002**: Every event MUST carry a session identifier. Data and terminal-state events MUST
  carry a monotonically increasing sequence number so late events can be discarded.
- **TERM-003**: Close, exit, renderer detach, and backend failure MUST converge on one idempotent
  terminal state.
- **TERM-004**: Raw terminal output MUST flow directly to xterm.js and MUST NOT enter React state.
- **TERM-005**: Output transport MUST batch data and implement bounded flow control. A slow renderer
  MUST not create an unbounded main-process queue.
- **TERM-006**: Resize bursts MAY be coalesced, but the final size MUST reach the backend.

### 10.2 xterm.js behavior

- **TERM-007**: The terminal MUST support common VT/xterm behavior, 16/256/true color, Unicode, CJK,
  emoji, wide characters, combining characters, Powerline/Nerd Font glyphs, cursor styles, mouse
  reporting, and alternate-screen applications.
- **TERM-008**: The implementation MUST support selection, copy, paste, select all, visible
  scrollbar, scrollback, search with current-match navigation, and web links.
- **TERM-009**: WebGL rendering SHOULD be used when available and MUST fall back without losing the
  session after WebGL initialization or context loss.
- **TERM-010**: OSC 52 clipboard writes MAY update the local clipboard. Clipboard reads requested by
  the terminal MUST remain disabled unless a later security review approves them.
- **TERM-011**: Interactive mode MUST accept input. Read-only mode MUST preserve selection, copy,
  scrolling, and search while suppressing terminal input.
- **TERM-012**: Per-tab mode cycling MUST preserve the defined `F6` behavior.
- **TERM-013**: `Ctrl+wheel` terminal zoom MUST remain bounded to a usable font-size range and MUST
  trigger a correct PTY resize.
- **TERM-014**: Pasted and inserted text MUST normalize platform line endings predictably. NUL, DEL,
  ESC, BEL, and unsupported control characters MUST NOT be injected by command actions.
- **TERM-015**: Bracketed paste mode MUST be respected. Multi-line paste outside bracketed paste
  SHOULD require a review/confirmation step.
- **TERM-016**: A terminal component unmount MUST dispose all DOM, xterm, addon, resize, and
  transport subscriptions exactly once without implicitly closing a session that is being retained
  by its owning tab.

### 10.3 Terminal context snapshots

- **TERM-017**: Context extraction MUST read the xterm buffer, never terminal DOM nodes or a raw PTY
  log.
- **TERM-018**: A non-empty selection takes precedence over the viewport.
- **TERM-019**: Users MAY include a configured, bounded number of lines preceding the viewport. The
  default MUST NOT include the complete scrollback.
- **TERM-020**: Snapshot text MUST join wrapped rows correctly, remove style escape sequences,
  retain meaningful internal blank lines, trim display padding, and distinguish normal and alternate
  buffers.
- **TERM-021**: The user MUST see the selected source, truncation state, line/character bounds, and
  a preview before externally transmitting terminal content.
- **TERM-022**: One snapshot MUST be limited to 256 KiB unless a future schema migration
  deliberately changes the limit.

## 11. Local shell sessions

- **LOC-001**: A saved local session MUST support an optional executable, parsed argument list,
  optional working directory, display name, group, and TERM value.
- **LOC-002**: Arguments require an explicit executable. Unmatched shell-style quotes MUST be
  rejected before launch.
- **LOC-003**: A configured working directory MUST exist and be a directory. An omitted directory
  defaults to the user's home when available.
- **LOC-004**: Windows default-shell resolution MUST prefer an available PowerShell, then `ComSpec`,
  then `cmd.exe`. The child PATH MUST preserve both the GUI process and registry-derived entries.
- **LOC-005**: macOS and Linux MUST prefer `SHELL`, then the login shell, then `/bin/sh`. A bare
  recognized macOS shell MUST launch as a login shell; explicit arguments take precedence.
- **LOC-006**: Local children MUST receive the selected `TERM` and `COLORTERM=truecolor`.
- **LOC-007**: Windows local sessions MUST use ConPTY through `node-pty`. Unix platforms MUST use
  their native PTY backend.
- **LOC-008**: Startup failure, invalid cwd, PTY failure, I/O failure, resize failure, normal exit,
  and forced close MUST have distinct structured outcomes.
- **LOC-009**: Closing or dropping the last session owner MUST terminate and reap the local child.

## 12. WSL sessions

- **WSL-001**: WSL support is Windows-only and MUST use `wsl.exe` through the local ConPTY backend.
- **WSL-002**: Discovery MUST list distribution name, default marker, running/stopped/transitional
  state, and WSL version.
- **WSL-003**: Discovery MUST handle UTF-8 and UTF-16LE output, localized banner noise, distribution
  names containing spaces, unavailable WSL, and a ten-second timeout.
- **WSL-004**: The sidebar MUST provide an unlocked-only WSL Distributions section. Double-clicking
  a distribution opens a temporary WSL session; refresh is manual or triggered on unlock.
- **WSL-005**: A running distribution MAY be terminated only after confirmation. Global
  `wsl --shutdown` MUST NOT be exposed.
- **WSL-006**: Saved WSL sessions MUST support distribution, optional distro user, optional starting
  directory, name, group, and TERM.
- **WSL-007**: An omitted starting directory MUST map to the Linux home (`--cd ~`). Windows and
  Linux path styles MUST be passed through to `wsl.exe --cd` without treating a Linux path as a
  Windows process cwd.
- **WSL-008**: WSL environment detection MUST execute the POSIX probe inside the selected
  distribution.
- **WSL-009**: WSL sessions MUST NOT advertise SFTP capability in the initial release.

## 13. SSH sessions

- **SSH-001**: A saved SSH target MUST support host, port, user, TERM, password authentication, and
  imported private-key authentication with optional passphrase.
- **SSH-002**: Empty host or user and ports outside 1-65535 MUST be rejected before connection.
- **SSH-003**: Encrypted private keys MUST request a passphrase when needed. Saving an accepted
  passphrase requires an explicit Remember choice and an unlocked vault.
- **SSH-004**: The client MUST request an xterm-compatible PTY, wait for confirmed PTY and shell
  requests, support input and resize, and distinguish an exit status from an unclassified channel
  close.
- **SSH-005**: Unknown hosts MUST show host and SHA-256 fingerprint. Stored sessions MAY persist a
  trusted key only after explicit approval.
- **SSH-006**: A changed host key MUST show old and new fingerprints, default to rejection, and
  replace only the matching stored host entry after explicit approval.
- **SSH-007**: Host-key files and updates MUST be serialized so concurrent connections cannot
  corrupt them.
- **SSH-008**: Authentication rejection, key format, passphrase, host-key, connection, PTY, shell,
  and channel failures MUST map to localized structured errors.
- **SSH-009**: Closing a session MUST cancel terminal, SFTP, environment-probe, and pending host-key
  or passphrase work without leaving a usable privileged handle.
- **SSH-010**: There is no automatic reconnect in the initial release. A disconnect ends the session
  with an explicit terminal state.

## 14. SFTP and local file panel

- **SFTP-001**: SSH sessions MUST expose an SFTP channel independent of interactive terminal I/O.
  SFTP latency or failure MUST not block terminal data.
- **SFTP-002**: The SFTP view MUST show remote and local panes with path, name, type, permissions or
  equivalent metadata, size, selection, navigation, and refresh.
- **SFTP-003**: Windows local browsing MUST expose a drive overview and MUST protect drive roots
  from rename or deletion.
- **SFTP-004**: The panel MUST support upload and download of files and directory trees, new
  folders, rename, recursive delete without following remote symlinks, local open/open-location, and
  copying selected paths.
- **SFTP-005**: Multi-selection MUST be supported for listing, download, and deletion. Destructive
  operations MUST identify the item or count and warn that they cannot be undone.
- **SFTP-006**: Transfers MUST have stable IDs, byte progress when available, success/failure state,
  and a visible transfer list. Completion MUST refresh the relevant directory.
- **SFTP-007**: Remote listing MUST canonicalize the path when possible and use the canonical result
  as the panel location.
- **SFTP-008**: The remote panel SHOULD follow successfully submitted shell `cd` commands. Relative,
  home, parent, and absolute changes MUST resolve from the last authoritative remote directory.
- **SFTP-009**: Directory sync MUST pause in the alternate screen, allow explicit detach, and
  support a user-requested re-sync after returning to the primary shell screen.
- **SFTP-010**: A failed optimistic directory change MUST recover without leaving terminal echo
  disabled or exposing hidden probe output.
- **SFTP-011**: Users MUST be able to configure deduplicated, one-per-line remote-file commands such
  as `cat` or `less`. Selecting one MUST append a safely quoted full remote path and execute only
  after the explicit context-menu action.
- **SFTP-012**: File names containing unsupported terminal control characters MUST be rejected
  rather than injected.
- **SFTP-013**: `Ctrl+wheel` in either file pane MUST zoom both pane lists within bounded limits.

## 15. Terminal environment context

- **ENV-001**: The application MUST detect, store, and edit OS, distribution, kernel/build,
  architecture, shell, shell version, user, hostname, notes, environment-specific instructions,
  verification state, attachment state, and detection time.
- **ENV-002**: SSH environment records MUST be keyed by `user@host:port`. Saved local records MUST
  use `local:<session-id>`. Saved WSL records MUST use `wsl:<session-id>` and quick WSL records
  SHOULD use `wsl:distro:<name>`.
- **ENV-003**: Detection is best effort and MUST ignore banner noise, unknown fields, control
  characters, and unreasonable field lengths.
- **ENV-004**: POSIX and Windows probes MUST have bounded timeouts and MUST not depend on the user's
  interactive shell syntax.
- **ENV-005**: Fresh detection MAY replace detected facts but MUST preserve user notes,
  environment-specific instructions, and attachment preference. Replaced facts require
  reconfirmation.
- **ENV-006**: Editing a session target MUST prevent an environment draft from being silently saved
  under the wrong target key.
- **ENV-007**: Environment context is sent to AI only when attachment is enabled. The request
  preview MUST distinguish detected facts from user-authored instructions.

## 16. AI assistant

### 16.1 Connections and models

- **AI-001**: The application MUST support multiple named AI connections, one default connection,
  multiple models per connection, one default model per connection, and per-chat model selection.
- **AI-002**: Supported protocols are OpenAI Responses and OpenAI-compatible Chat Completions.
- **AI-003**: A connection MUST contain a name, protocol, HTTPS base URL or loopback HTTP URL,
  optional encrypted API key, models, default model, and accepted normalized endpoint.
- **AI-004**: Query strings, fragments, non-HTTPS remote endpoints, and malformed URLs MUST be
  rejected.
- **AI-005**: Chat Completions connections MUST support model discovery through `/models`. Responses
  connections MUST support a minimal, explicitly disclosed test request with storage disabled.
- **AI-006**: Responses models MUST support defaults for reasoning effort, verbosity, reasoning
  summary, and web search. A chat MAY override reasoning effort.

### 16.2 Request and streaming behavior

- **AI-007**: Request construction MUST combine the built-in safety prompt, global user
  instructions, attached environment facts, environment-specific instructions, conversation history,
  the current prompt, and an optional terminal snapshot in a deterministic order.
- **AI-008**: Terminal snapshots MUST be clearly delimited as untrusted observations. Snapshot text
  MUST never be interpreted as application instructions.
- **AI-009**: Before the first request to a normalized endpoint, the UI MUST show what categories of
  data can be sent and require confirmation. Changing endpoint identity MUST invalidate consent.
- **AI-010**: Provider-specific SSE or JSON MUST be parsed only in the main process adapter. The
  renderer receives provider-neutral start, delta, reasoning, activity, usage, source, complete, and
  error events.
- **AI-011**: Streaming text and reasoning MUST render incrementally. The user MUST be able to stop
  a request. Cancellation MUST abort network work and ignore late events.
- **AI-012**: While the user is near the bottom, new output SHOULD remain pinned. Reading older
  content MUST not be interrupted by forced scrolling.
- **AI-013**: The UI MUST distinguish connecting, queued, working, web search, source reading,
  writing, completed, failed, and cancelled states when the provider exposes them.
- **AI-014**: Responses output MUST preserve reasoning summaries, web-search activity, sources,
  token usage, and provider continuation state needed for a later turn.
- **AI-015**: Connect timeout MUST default to 15 seconds, stream idle timeout to 60 seconds, and one
  response to 4 MiB. Limit violations MUST produce structured errors.
- **AI-016**: Authentication, rate limit, rejected request, server, network, timeout, protocol,
  response-size, cancellation, and incomplete-response errors MUST be distinct.
- **AI-017**: An AI provider failure MUST not interrupt terminal or SFTP I/O.

### 16.3 Conversation UI and history

- **AI-018**: The composer MUST support Enter to send, Shift+Enter for a newline, auto-growth to a
  bounded height, snapshot attachment/removal, model selection, and Stop while streaming.
- **AI-019**: Markdown MUST be sanitized, selectable, themed, and syntax highlighted. External links
  MUST use a validated system-browser action.
- **AI-020**: Each conversation MUST be persisted to a human-readable Markdown history file after
  meaningful changes. It MUST include role, displayed content, snapshot metadata/text, reasoning,
  model, usage, and continuation metadata needed to continue the conversation.
- **AI-021**: The history window MUST list, refresh, load/continue, delete with confirmation, and
  open the history directory. Loading while a request is active MUST be rejected.
- **AI-022**: Starting a new chat MUST cancel in-flight work, clear current messages and attachment,
  and bind subsequent messages to a new history file.
- **AI-023**: Prompt text, responses, reasoning, snapshots, and command text MUST not appear in
  normal logs or analytics.

## 17. Shell command parsing and actions

### 17.1 Recognition and parsing

- **CMD-001**: Explicit shell fence labels MUST recognize at least `sh`, `shell`, `bash`, `zsh`,
  `fish`, `powershell`, `pwsh`, `cmd`, `bat`, and `dos`, with shell-specific capability levels.
- **CMD-002**: Data-language fences such as JSON, YAML, TOML, diff, text, and Python MUST NOT be
  treated as executable shell commands.
- **CMD-003**: Unlabelled fences MAY be inferred only at high confidence. Low-confidence content
  MUST remain a whole block with Copy and, when safe, Insert; Run MUST be withheld.
- **CMD-004**: The split unit is an independently submittable top-level statement, not a physical
  line.
- **CMD-005**: Bash-family parsing MUST preserve quoting, escaped newlines, pipelines, `&&`/`||`,
  substitutions, subshells, heredocs, environment prefixes, and compound `if`/`for`/`while`/function
  bodies.
- **CMD-006**: PowerShell parsing MUST separately preserve backtick continuation, pipelines,
  scriptblocks, here-strings, quoting, and compound statements.
- **CMD-007**: Leading explanatory comments MUST remain associated with the following command but
  MUST not be injected unless they are semantically required and visibly included in the payload.
- **CMD-008**: Prompt prefixes MAY be stripped only when every non-blank line consistently matches a
  recognized shell-session prompt pattern.
- **CMD-009**: If parsing might change semantics, the parser MUST return one whole-block candidate
  or a non-runnable result. It MUST NOT guess a plausible but incomplete command.
- **CMD-010**: Parser input size and work time MUST be bounded. Oversized or pathological input MUST
  degrade without blocking the renderer.

### 17.2 Streaming stability

- **CMD-011**: Command candidates MUST carry a content revision and stability state.
- **CMD-012**: Run MUST be disabled while a code block is incomplete, unterminated, changing, or
  derived from an unfinished response.
- **CMD-013**: A revised block MUST invalidate old command actions. An action from an old revision
  MUST fail closed instead of operating on stale text.

### 17.3 Copy, Insert, and Run

- **CMD-014**: Copy writes the exact command payload to the clipboard without unrelated prose or
  button text.
- **CMD-015**: Insert sends the exact payload to the currently displayed valid terminal and MUST NOT
  send Enter/Return.
- **CMD-016**: Run sends the exact payload and one appropriate submission sequence only after an
  explicit click on trusted application UI.
- **CMD-017**: Insert MUST be the primary action. Run MUST not have greater visual emphasis.
- **CMD-018**: The target session MUST be visible. At action time, the main process MUST validate
  the session identity and state; it MUST NOT substitute a newly active session after a switch or
  close.
- **CMD-019**: Repeated Run clicks MUST be debounced or require a renewed explicit action while the
  first submission is pending.
- **CMD-020**: Clearly destructive commands MUST receive stronger confirmation or be limited to
  Insert. Risk matching is a warning aid, not a security sandbox.
- **CMD-021**: The optional split-command display setting MUST remain available and default to off.
  Turning it on or off changes presentation only, not stored provider content or history.

## 18. Settings, appearance, and localization

- **SET-001**: Settings MUST cover General, Appearance, Terminal, SFTP, AI Connections, AI
  Assistant, Security & Vault, and About.
- **SET-002**: User settings MUST include language, theme, UI font/family/size, terminal primary and
  ordered fallback fonts, terminal font size, line height, cursor style, default TERM, command-split
  presentation, global AI instructions, SFTP open commands, and terminal-context bounds.
- **SET-003**: Terminal fallback fonts MUST support optional scale and horizontal/vertical
  adjustments, preserve order, and remove blanks, duplicates, and the primary font.
- **SET-004**: Font sizes MUST remain within 8-32 logical pixels and terminal line height within
  1.00-2.00 in stable 0.05 steps.
- **SET-005**: Built-in themes MUST include a dark default theme and the four Catppuccin variants.
  UI, terminal, selection, cursor, search, and code highlighting colors MUST remain coordinated.
- **SET-006**: User theme JSON files MUST be loadable from a documented theme directory. A valid
  user theme MAY override a built-in theme of the same name. Invalid files MUST be isolated and
  reported without blocking startup.
- **SET-007**: English and Simplified Chinese UI catalogs MUST be supported, plus a Follow System
  preference. Repository-facing source and documentation remain English.
- **SET-008**: A language change MUST refresh windows, menus, dialogs, and errors without requiring
  a process restart where technically practical.

## 19. Persistence

### 19.1 General persistence rules

- **DATA-001**: Settings, UI state, the structured database, vault metadata, host keys,
  environments, and history MUST each have a versioned schema or format identifier.
- **DATA-002**: Writes MUST be atomic or transactional. On failure, the last valid version MUST
  remain recoverable.
- **DATA-003**: Corrupt persisted data MUST be quarantined or preserved for diagnosis before safe
  defaults are written.
- **DATA-004**: xterm instances, PTY/SSH handles, raw WebContents objects, and unlimited scrollback
  MUST never be persisted.
- **DATA-005**: Data paths MUST use a Geared Term namespace.

### 19.2 Embedded structured storage

- **DATA-006**: Session profiles, vault-encrypted secrets, AI connections, and environment records
  MUST be stored in a single embedded SQLite database owned exclusively by the main process. The
  database MUST be accessed through `better-sqlite3` and MUST NOT be reachable from the preload or
  renderer.
- **DATA-007**: The database MUST enable write-ahead logging and foreign-key enforcement. Any
  mutation touching multiple rows or tables (profile saves with credentials, secret-reference
  cleanup, master-password rotation, bulk record operations) MUST execute as one transaction.
- **DATA-008**: Schema changes MUST be forward-only migrations recorded in code, each executed in
  one transaction with a pre-migration backup. An unreadable database or an unknown newer schema
  version MUST be quarantined with its contents preserved and replaced by a fresh database with a
  user-visible notice. It MUST NOT be silently deleted or downgraded.
- **DATA-009**: Secret material MUST exist in the database only as vault-encrypted rows carrying
  purpose, algorithm, and version metadata. Plaintext secret columns and secret values in logs are
  forbidden.
- **DATA-010**: Database rows MUST map one-to-one onto the validated protocol records
  (`SessionProfileRecord`, `EncryptedSecret`, `AiConnectionRecord`, `EnvironmentRecord`). Runtime
  schema validation remains at every IPC boundary independent of storage validation.
- **DATA-011**: Settings, UI state, known hosts, AI history Markdown, user themes, and logs remain
  in their documented versioned file stores. Moving one of these artifacts into the database
  requires a recorded architecture decision.

## 20. Electron security boundary

- **SEC-001**: Every Electron `BrowserWindow` MUST use `contextIsolation: true`,
  `nodeIntegration: false`, a sandbox where compatible, and an explicit Content Security Policy.
- **SEC-002**: The preload MUST expose only business-named methods with validated input. It MUST NOT
  expose `ipcRenderer`, arbitrary channels, arbitrary filesystem access, process spawning, or shell
  execution.
- **SEC-003**: Every IPC request, response, event, and MessagePort message MUST be runtime-validated
  at the trust boundary in addition to TypeScript checking.
- **SEC-004**: The renderer MUST never access PTY handles, SSH sockets, SFTP handles, filesystem
  APIs, the SQLite database, network credentials, or decrypted secrets.
- **SEC-005**: Navigation, new windows, downloads, permissions, and external URLs MUST be denied by
  default and handled through allowlisted schemes and explicit application actions.
- **SEC-006**: External URLs MUST be limited to `https:` unless a specific local-development flow
  authorizes loopback HTTP. Dangerous schemes MUST be rejected.
- **SEC-007**: Terminal, AI, and remote-file content are untrusted data. They MUST NOT become HTML,
  IPC channel names, executable code, or filesystem paths without validation appropriate to the
  operation.
- **SEC-008**: Production renderer reload/navigation MUST be blocked except through controlled app
  recovery. Renderer crashes MUST produce a defined session cleanup or reattachment outcome.
- **SEC-009**: Dependency updates, especially Electron, Chromium, `node-pty`, `better-sqlite3`,
  xterm.js, and `ssh2`, MUST be reviewed and package-smoke-tested as a compatibility set.

## 21. Diagnostics and privacy

- **OBS-001**: Debug builds MUST write `debug-logs/debug.log` as an application warning/error
  summary and detailed `debug-{app,ssh,terminal,assistant,system}.log` files.
- **OBS-002**: Release logs MUST use the per-user data directory.
- **OBS-003**: Each log MUST rotate at startup and before exceeding 2 MiB, retaining one
  `.previous.log` file.
- **OBS-004**: A renderer crash, main-process uncaught error, native module load failure, and
  unhandled rejection MUST be captured without including secrets or user content.
- **OBS-005**: Logs MUST NOT contain terminal output, clipboard contents, commands, prompts, AI
  responses, snapshots, passwords, private keys, passphrases, API keys, cookies, or authorization
  headers.
- **OBS-006**: Operational events MAY include opaque IDs, byte counts, durations, protocol state,
  error codes, and feature state needed to diagnose behavior.

## 22. Performance and reliability

- **REL-001**: Terminal output MUST bypass React reconciliation and be written to xterm.js in
  batches.
- **REL-002**: AI Markdown rendering and command parsing MUST be throttled or incremental during
  streaming.
- **REL-003**: PTY, SSH, SFTP, AI, persistence, and parser failures MUST be isolated by subsystem.
- **REL-004**: Closing a window or quitting MUST dispose sessions, transfers, network requests,
  subscriptions, timers, workers, native handles, and the database connection without hanging the
  process.
- **REL-005**: Suspend/resume, network loss, display-scale change, and WebGL context loss MUST reach
  a recoverable or clearly terminal state.
- **REL-006**: Packaged applications MUST load every rebuilt native module (`node-pty`,
  `better-sqlite3`) on every supported platform. A development-only success is insufficient.
- **REL-007**: Large terminal output, long scrollback, rapid resize, CJK/emoji, alternate-screen
  tools, and simultaneous SFTP or AI work MUST be included in release regression tests.

## 23. Accessibility

- **A11Y-001**: All application controls, tabs, dialogs, command actions, settings, and status
  changes MUST be keyboard reachable and have meaningful accessible names.
- **A11Y-002**: Focus order MUST remain stable during streaming and list refreshes.
- **A11Y-003**: Disabled actions MUST expose a reason; state MUST not be communicated by color
  alone.
- **A11Y-004**: Font scaling and high-DPI display MUST not hide terminal, dialog, or command-action
  controls.
- **A11Y-005**: Terminal accessibility support SHOULD use xterm.js accessibility facilities without
  mirroring unlimited terminal content into React.

## 24. Verification requirements

### 24.1 Unit and fixture tests

At minimum, automated tests MUST cover:

- protocol schemas, sequence handling, state machines, and error mapping;
- local shell resolution, argument parsing, cwd validation, PATH behavior, and exit cleanup;
- WSL UTF-8/UTF-16 decoding, listing parsing, launch arguments, and timeouts;
- known-host unknown/matching/changed/rejected/temporary behavior;
- password and private-key authentication paths;
- SFTP path handling, recursive operations, progress, sync state, and quoting;
- snapshot selection, viewport, wrapped lines, alternate screen, bounds, and truncation;
- Chat Completions and Responses endpoint building, stream parsing, cancellation, limits, sources,
  usage, continuation, and error classification;
- Bash-family and PowerShell command fixtures, incomplete streaming fences, comments, prompt
  stripping, and conservative fallback;
- settings, UI state, database repositories, schema migrations, vault, history, and corruption
  quarantine.

### 24.2 Integration and end-to-end tests

The suite MUST exercise:

- a real local PTY on each CI operating system;
- a controlled SSH/SFTP server for password, key, host verification, resize, data, exit, disconnect,
  environment detection, and file operations;
- main/preload/renderer request and stream boundaries;
- Insert sending no Enter and Run sending exactly one submission to the validated target;
- tab switching and closing while data, AI, or transfers are in flight;
- vault create/unlock/lock/change-password/auto-unlock;
- transactional database mutations, migration, and corruption recovery;
- packaged-app launch and native module loading;
- IME, high DPI, multiple displays, alternate-screen applications, and WebGL fallback through a
  documented manual matrix where automation is insufficient.

### 24.3 Traceability

Every normative requirement ID MUST appear in a requirements matrix with implementation owner,
automated test or manual procedure, evidence, and status. A feature is not complete merely because a
module with a matching name exists.

## 25. Initial release definition of done

Geared Term's initial release is complete only when:

1. every MUST requirement is implemented or explicitly waived in a recorded product decision;
2. every requirement group has closed requirements-matrix rows with owners and evidence;
3. local, WSL, SSH, SFTP, vault, environment, AI, history, and command-action acceptance suites
   pass;
4. Insert never submits and Run cannot operate on an incomplete or stale candidate;
5. stored credentials remain outside the renderer and outside plaintext storage;
6. unknown and changed SSH host keys fail closed without explicit approval;
7. supported packaged artifacts launch and pass PTY, SSH, database, and settings smoke tests;
8. shortcuts, focus, IME, Unicode, alternate screen, scaling, and panel layout complete manual
   regression;
9. the SQLite storage layer passes transaction, migration, rotation, and corruption-recovery suites;
10. no direct LLM web-page integration has been coupled into the terminal or API AI core;
11. known requirement gaps are empty, or each has an explicit owner, user-visible limitation, and
    approved release waiver.
