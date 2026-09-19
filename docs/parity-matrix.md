# Geared Term parity matrix

This matrix tracks the current implementation against the normative requirement groups in
[`SPEC.md`](../SPEC.md). A row is marked **implemented** only when code and automated verification
exist in this repository. UI parity, import compatibility, and packaged end-to-end behavior remain
open until their dedicated fixtures and tests are added.

| Requirement group             | Current status     | Evidence                                                                                                                                                    | Remaining gate                                                                                |
| ----------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| APP application shell         | partial            | `apps/desktop/src/renderer/src/App.tsx`, independent terminal tabs, persisted sidebar state, and secure window creation in `apps/desktop/src/main/index.ts` | restored bounds edge cases, dialogs, focus, menus, accessibility audit                        |
| SES sessions and profiles     | partial            | versioned profile schema, profile list/save/delete IPC, local profile UI, and saved SSH resolution                                                          | profile editing forms, WSL/SSH setup flow, import mapping                                     |
| VLT vault and secrets         | implemented (core) | `apps/desktop/src/main/vault/vault.ts`, vault tests, renderer-free IPC                                                                                      | password rotation, device-local auto-unlock policy, OS keychain integration                   |
| TERM terminal transport       | implemented (core) | `apps/desktop/src/main/local-terminal.ts`, protocol schemas, xterm renderer, independent tab lifecycle, and persisted terminal settings                     | context snapshots, accessibility and packaging stress tests                                   |
| LOC local shells              | implemented (core) | shell resolution and ConPTY/PTY lifecycle in `local-terminal.ts`                                                                                            | configurable executable/arguments UI and environment persistence                              |
| WSL sessions                  | partial            | UTF-8/UTF-16 discovery parser, validated discovery IPC, double-click launch tabs, and bounded WSL environment probe                                        | confirmation UI and Windows-only E2E                                                           |
| SSH sessions                  | implemented (core) | `apps/desktop/src/main/ssh/ssh-session.ts`, known-host tests, and main-process vault-backed profile resolution                                              | connection form, passphrase prompt, host-key dialog, SSH integration fixtures                 |
| SFTP                          | partial            | `SftpService`, independent SSH SFTP channel, validated list IPC, and remote-file panel                                                                    | local pane, transfers/cancellation, canonical path/sync behavior, and end-to-end coverage      |
| ENV environment context       | partial            | bounded local/WSL probe parser, versioned environment persistence, validated IPC, and context editor panel                                                | SSH probes, AI attachment preview, and conflict-aware refresh                                 |
| AI assistant                  | implemented (core) | endpoint validation, vault-referenced connection metadata, cancellable AI MessagePort, provider adapter, SSE parser, and `AssistantPanel.tsx`               | model discovery, conversation history, terminal-context attachment, richer Markdown rendering |
| CMD command actions           | partial            | bounded conservative parser, content revisions, main-side revision/run validation, command cards, and copy/insert/run gating                                | split-command presentation, stale-session UX, destructive-command confirmation, and E2E tests |
| SET settings and localization | partial            | versioned settings schema, preload IPC, persisted settings panel, English/Chinese labels, and terminal theme/font/cursor application                        | complete settings groups, theme JSON loading, catalog coverage, and window refresh             |
| DATA persistence/import       | partial            | atomic versioned JSON stores, corruption quarantine tests, and persisted environment records                                                               | sanitized legacy fixtures, importer helper, conflict preview and rollback                     |
| SEC Electron boundary         | implemented (core) | context isolation, sandbox, CSP, navigation/new-window blocking, validated IPC                                                                              | dependency audit, production navigation tests, packaged security review                       |
| OBS diagnostics               | implemented (core) | redacted category logs with startup/size rotation                                                                                                           | crash reporting hooks and release-log verification                                            |
| REL reliability               | partial            | cleanup paths, bounded queues/timeouts, unit tests                                                                                                          | suspend/resume, WebGL fallback, long-output and packaged native-module tests                  |
| A11Y accessibility            | not started        | —                                                                                                                                                           | keyboard/focus audit, screen-reader semantics, scaling verification                           |

## Verification commands

The current checkpoint is reproducible with:

```text
pnpm typecheck
pnpm test
pnpm build
pnpm package
```

The reference baseline and required sanitized fixture list are recorded in
[`reference-baseline.json`](reference-baseline.json). The legacy repository remains read-only.
