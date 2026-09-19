# Geared Term requirements matrix

This matrix tracks the current implementation against the normative requirement groups in
[`SPEC.md`](../SPEC.md). A row is marked **implemented** only when code and automated verification
exist in this repository. UI completion, storage migration, and packaged end-to-end behavior remain
open until their dedicated fixtures and tests are added.

| Requirement group             | Current status     | Evidence                                                                                                                                                                      | Remaining gate                                                                     |
| ----------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| APP application shell         | partial            | `apps/desktop/src/renderer/src/App.tsx`, independent terminal tabs, persisted sidebar state, and secure window creation in `apps/desktop/src/main/index.ts`                   | restored bounds edge cases, dialogs, focus, menus, accessibility audit             |
| SES sessions and profiles     | partial            | versioned profile schema, profile list/save/delete IPC, grouped profile sidebar, `ProfileEditor.tsx` for local/WSL/SSH targets, one-shot SSH dialog, and saved SSH resolution | environment identity semantics                                                     |
| VLT vault and secrets         | implemented (core) | `apps/desktop/src/main/vault/vault.ts`, vault tests, renderer-free IPC, and profile-editor lifecycle controls                                                                 | password rotation, device-local auto-unlock policy, OS keychain integration        |
| TERM terminal transport       | implemented (core) | `apps/desktop/src/main/local-terminal.ts`, protocol schemas, xterm renderer, independent tab lifecycle, and persisted terminal settings                                       | context snapshots, accessibility and packaging stress tests                        |
| LOC local shells              | implemented (core) | shell resolution and ConPTY/PTY lifecycle in `local-terminal.ts`, plus executable/arguments/cwd profile fields                                                                | environment persistence and shell-specific validation                              |
| WSL sessions                  | partial            | UTF-8/UTF-16 discovery parser, validated discovery IPC, confirmed double-click launch tabs, and bounded WSL environment probe                                                 | Windows-only E2E                                                                   |
| SSH sessions                  | implemented (core) | `apps/desktop/src/main/ssh/ssh-session.ts`, saved/temporary connection forms, vault-backed password/private-key/passphrase replacement, known-host tests, and host-key dialog | SSH integration fixtures and reconnect/error-flow coverage                         |
| SFTP                          | partial            | `SftpService`, independent SSH SFTP channel, validated list/transfer IPC, canonical listing paths, symlink-safe removal, main-owned file dialogs, and remote-file panel       | local pane, transfer cancellation, sync behavior, and end-to-end coverage          |
| ENV environment context       | partial            | bounded local/WSL probe parser, versioned environment persistence, validated IPC, and context editor panel                                                                    | SSH probes, richer AI context redaction, and conflict-aware refresh                |
| AI assistant                  | implemented (core) | endpoint validation, vault-referenced connection metadata, cancellable AI MessagePort, provider adapter, SSE parser, environment attachment preview, and `AssistantPanel.tsx` | model discovery, conversation history, richer Markdown rendering                   |
| CMD command actions           | partial            | bounded conservative parser, content revisions, main-side revision/run validation, destructive-risk classification, optional split command cards, and copy/insert/run gating  | stale-session UX and E2E tests                                                     |
| SET settings and localization | partial            | versioned settings schema, preload IPC, persisted settings panel, English/Chinese labels, and terminal theme/font/cursor application                                          | complete settings groups, theme JSON loading, catalog coverage, and window refresh |
| DATA persistence              | partial            | atomic versioned JSON stores, corruption quarantine tests, and persisted environment records                                                                                 | SQLite profile store: embedded database, transactional writes, rotation, migration and corruption suites |
| SEC Electron boundary         | implemented (core) | context isolation, sandbox, CSP, navigation/new-window blocking, validated IPC                                                                                                | dependency audit, production navigation tests, packaged security review            |
| OBS diagnostics               | implemented (core) | redacted category logs with startup/size rotation                                                                                                                             | crash reporting hooks and release-log verification                                 |
| REL reliability               | partial            | cleanup paths, bounded queues/timeouts, unit tests                                                                                                                           | suspend/resume, WebGL fallback, long-output and packaged native-module tests       |
| A11Y accessibility            | not started        | —                                                                                                                                                                            | keyboard/focus audit, screen-reader semantics, scaling verification                |

## Verification commands

The current checkpoint is reproducible with:

```text
pnpm typecheck
pnpm test
pnpm build
pnpm package
```
