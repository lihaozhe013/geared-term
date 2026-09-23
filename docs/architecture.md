# Geared Term Architecture Reference

> Status: Current architecture reference
>
> Last updated: 2026-09-23
>
> Governing specification: [`SPEC.md`](../SPEC.md) · Requirement status:
> [`docs/requirements-matrix.md`](requirements-matrix.md)

This document records how Geared Term is built: the repository layout, process ownership, terminal
transport, persistence design, auxiliary windows, update delivery, and the test strategy. Behavior
requirements are normative and live only in `SPEC.md`; one-off decisions that need a rationale live
in [`docs/architecture-decisions/`](architecture-decisions/).

## 1. Repository layout

The repository is a pnpm workspace so Electron code, pure domain packages, and tests are versioned
together without exposing Electron or Node dependencies to pure logic.

```text
apps/
  desktop/
    src/
      main/
        ai/                    provider adapters, streaming, history, context, discovery
        environment/           bounded local/WSL environment probes
        files/                 validated local filesystem operations
        persistence/           SQLite profile store, JSON stores, vault rotation facade
        sftp/                  SFTP service, transfers, cd tracking, remote commands, editor file
        ssh/                   ssh2 session, host keys, authentication
        vault/                 encrypted secret storage
        wsl/                   distribution discovery and launch
        index.ts               IPC wiring, window lifecycle, update/tray integration
        logging.ts             redacted category logs with rotation
        menu.ts                native application menu
        settings-window.ts     single-instance settings window
        remote-editor-window.ts  remote file editing window
        terminal-snapshot-window.ts  snapshot scratch editor window
        tray.ts                background-mode tray (Windows/Linux)
        update-manager.ts      nightly update state machine
        update-release.ts      nightly GitHub release parsing
        ligatures.ts           terminal font ligature probing
      preload/
      renderer/
        src/
          ai/ assistant/ history/ settings/ sftp/ terminal/ terminal-snapshot/ remote-editor/
    e2e/                       Playwright Electron suites
    scripts/                   build, security audit, packaged smoke, nightly versioning
    resources/
    electron-builder.yml
packages/
  command-parser/              pure shell splitting and risk metadata
  domain/                      serializable domain types and pure state transitions
  keybindings/                 shortcut resolution
  protocol/                    Zod runtime schemas and inferred DTO types
  test-support/                shared fixtures and helpers
docs/
  architecture.md
  requirements-matrix.md
  architecture-decisions/
```

Layout rules:

- `packages/domain` contains serializable domain types and pure state transitions only.
- `packages/protocol` owns runtime schemas and inferred TypeScript DTO types.
- `packages/command-parser` has no React, Electron, provider, terminal, or filesystem dependency.
- `apps/desktop/src/main` is the only production code allowed to touch Node privileged APIs, native
  modules, sockets, the SQLite database, credentials, or unrestricted files.
- `preload` is a small adapter over the validated protocol and transferred ports.
- Renderer stores contain identifiers and serializable view state, never native handles or xterm
  instances.

## 2. Process ownership

| Concern                           | Owner                    | Notes                                                      |
| --------------------------------- | ------------------------ | ---------------------------------------------------------- |
| Window lifecycle and security     | Main                     | Renderer navigation and new windows are denied by default. |
| PTY, SSH, SFTP, WSL processes     | Main                     | One explicit lifecycle owner per resource.                 |
| Vault and decrypted secrets       | Main                     | Secret DTOs are never part of the preload API.             |
| SQLite database                   | Main                     | One connection; WAL; main-process services only.           |
| Provider HTTP and stream decoding | Main                     | Renderer sees provider-neutral events.                     |
| xterm instance and addons         | Renderer                 | Stored outside React state; disposed with its view.        |
| Workspace and transient UI state  | Renderer                 | Persisted through validated main-process services.         |
| Command parsing                   | Pure package in a worker | Bounded input and conservative fallback.                   |
| Runtime schemas                   | Shared protocol package  | Validated on both sides of every trust boundary.           |

## 3. Terminal transport

Session creation and lifecycle commands use request/response IPC. After creation, a dedicated
`MessagePort` is transferred for the terminal's high-frequency data plane.

The port protocol includes:

- `output { sessionId, sequence, chunk }`;
- `input { sessionId, chunk }`;
- `resize { sessionId, cols, rows, revision }`;
- `state { sessionId, sequence, state, detail? }`;
- `ack { sessionId, sequence, bytes }` for flow control;
- `close { sessionId, reason }`.

Binary chunks use transferable `ArrayBuffer` instances. The main process caps outstanding
unacknowledged bytes, coalesces adjacent output, and defines whether overload pauses the source or
terminates the session with a structured error. It never silently drops bytes.

## 4. Session state machine

All backends share this state model:

```text
created -> starting -> awaiting-user? -> running -> closing -> closed
                      \-> failed ----------------------^
running -> exited -> closed
```

`awaiting-user` covers host-key and private-key-passphrase prompts. Every transition is idempotent,
sequenced, and testable. Remote SFTP capability is attached only after an SSH session is ready;
local file browsing is available only for ordinary local shell sessions.

## 5. Runtime validation

A single schema library (Zod) in `packages/protocol` validates:

- session profiles and creation requests;
- IPC invokes, responses, and events;
- MessagePort envelopes;
- settings and persisted files;
- AI stream events;
- command parser input/output;
- structured errors.

The schema layer rejects unknown privileged operations and invalid identifiers before a main service
is called. TypeScript types are inferred from the schemas rather than duplicated.

## 6. Persistence and vault

### 6.1 Storage layout

Main-process-owned, versioned storage under the platform-standard Geared Term directories:

| Artifact           | Engine             | Contents                                                                     |
| ------------------ | ------------------ | ---------------------------------------------------------------------------- |
| `geared-term.db`   | SQLite (WAL)       | Session profiles, vault-encrypted secrets, AI connections, environments      |
| `settings.json`    | Versioned JSON     | Non-secret application preferences                                           |
| `ui-state.json`    | Versioned JSON     | Window and panel state                                                       |
| `known-hosts.json` | Versioned JSON     | Parsed host keys and metadata                                                |
| `vault-auto.json`  | Wrapped key file   | Vault key wrapped for password-free unlock (see ADR 0001)                    |
| `vault-auto.key`   | KEK file           | Key-encryption key encrypted by `safeStorage`, separate from the wrapped key |
| `ai-history/`      | Markdown files     | Human-readable conversation history                                          |
| `themes/`          | JSON files         | User themes                                                                  |
| `debug-logs/`      | Rotated text files | Diagnostics (release builds use the per-user data directory)                 |

Each mutable JSON file keeps write-to-sibling, flush, atomic rename, and a last-known-good backup.
Settings and UI state remain JSON deliberately: they are small documents written frequently (window
bounds churn) and are consumed whole at startup.

### 6.2 SQLite profile store

Structured domain data lives in one embedded SQLite database (`SPEC.md` DATA-006 through DATA-010),
implemented in `apps/desktop/src/main/persistence/profile-database.ts`.

**Engine.** `better-sqlite3`, pinned. It is the synchronous, main-process SQLite binding documented
by Electron, ships prebuilt binaries, and follows the same rebuild-for-Electron-ABI packaging path
already required for `node-pty`. One connection is opened at startup and closed on quit.

**Pragmas.** `journal_mode = WAL`, `synchronous = NORMAL`, `foreign_keys = ON`,
`busy_timeout = 5000`.

**Tables.** `schema_info` (key/value, holds `schema_version`), `secrets` (vault ciphertext rows with
purpose, algorithm, version, nonce, and tag columns), `environments`, `session_profiles`, and
`ai_connections`. Profiles and AI connections reference `secrets.id`; secret values never appear as
row columns. The authoritative DDL is the version-1 schema in the source file.

**Mapping rules.**

- Rows map one-to-one onto the validated protocol records; JSON columns (`facts`, `models`,
  `arguments`) round-trip through the same Zod schemas used at the IPC boundary.
- After every profile/connection mutation, unreferenced secrets are deleted inside the same
  transaction.

**Transactions.** Each public mutation is one `better-sqlite3` transaction: saving a profile upserts
the profile and its referenced secrets and sweeps unreferenced secrets; deleting sweeps; master
password rotation re-encrypts every secret row and replaces vault metadata in one transaction
(VLT-007).

**Migrations.** Migrations are an ordered, forward-only list in code, each wrapped in one
transaction. Before applying a migration the store creates a backup with `VACUUM INTO` next to the
database file. A database whose schema version is newer than the running code, or that fails
`PRAGMA quick_check`, is renamed to a quarantine name (contents preserved), a fresh database is
created, and the user is informed. Nothing is ever deleted or downgraded in place.

**One-time adoption migration.** On first launch with an empty database and an existing
`profile.json`, the store imports its own previous records inside one transaction and then renames
the file to `profile.json.migrated` as a user-recoverable backup. This was a migration of Geared
Term's own format only.

**Testing.** Repository tests run against `:memory:` and temp-file databases and cover round trips
for every record type, credential save/replace/delete with secret sweeps, transaction atomicity
under injected mid-transaction failure, each schema migration, and quarantine behavior.

### 6.3 Vault

The vault uses Node's audited `crypto` primitives in the main process
(`apps/desktop/src/main/vault/vault.ts`):

- PBKDF2-HMAC-SHA256 with versioned, recorded parameters;
- AES-256-GCM with unique nonces and purpose-separated authenticated data;
- the derived vault key lives in a zeroable buffer for the unlocked lifetime;
- each SSH and AI secret is encrypted independently;
- master-password rotation rebuilds all secret rows in one database transaction with compensating
  rollback on failure.

Password-free unlock requires real OS-backed `safeStorage`; the rejected fallbacks and lock
semantics are recorded in [ADR 0001](architecture-decisions/0001-auto-unlock-policy.md).

## 7. Auxiliary windows and background mode

Each auxiliary window is created with the same security boundary as the main window (`SEC-001`) and
is driven by business-named, validated IPC.

- **Settings window** (`settings-window.ts`): single instance; re-opening focuses the existing
  window and can navigate it to a category (General, Appearance, Terminal, Shortcuts, SFTP, AI
  Connections, AI Assistant, Security & Vault, About).
- **Remote editor window** (`remote-editor-window.ts`, `sftp/editor-file.ts`): edits one SFTP
  document loaded through the main process with a byte cap (`SFTP_EDITOR_MAX_BYTES`); saves are
  validated against the current remote state and report `conflict` instead of overwriting blindly.
- **Terminal snapshot editor** (`terminal-snapshot-window.ts`): the disposable viewport draft window
  specified by TERM-023; one window at a time, drafts are discarded on close.
- **Tray and background mode** (`tray.ts`): on Windows and Linux an opt-in
  (`keepRunningInBackground`) keeps the app alive with a tray icon offering Show/Quit when the main
  window is closed; a second launch re-shows the hidden window. macOS has no tray icon and keeps
  standard Dock behavior.
- **Update UI**: the About section of the settings window drives `updates:get-status`,
  `updates:check`, `updates:install`, and `updates:open-release` and renders the shared
  `UpdateStatus` state machine (Section 8).

## 8. Update delivery

Geared Term ships unsigned nightly artifacts to a rolling GitHub `nightly` prerelease
(`.github/workflows/nightly.yml`); each build embeds its commit SHA.

- `update-release.ts` fetches the `nightly` release metadata from the GitHub API and extracts the
  full commit SHA from the release body.
- `update-manager.ts` compares that SHA with the running build. A packaged build checks once at
  startup and then every 24 hours, plus manually from Settings → About; development builds never
  check.
- Status is published to renderers as the validated `UpdateStatus` union
  (`idle | checking | up-to-date | available | downloading | downloaded | error`).
- `update-notification.ts` receives one automatic new-SHA notification per process run and shows a
  localized native prompt. It opens Settings → About on request and queues the prompt until the main
  window is shown if the app is hidden or minimized in the tray.
- Automatic download and in-app install are Windows NSIS-installer builds only (electron-updater
  with a generic publish feed pointing at the release download URL and the `beta` channel,
  `beta.yml`). Portable Windows builds and macOS/Linux builds detect an update and offer the release
  page link for manual download instead.
- Update failures are surfaced as bounded, redacted errors and never interrupt terminal, SFTP, or AI
  sessions.

## 9. Test strategy

| Layer              | Tooling                           | Scope                                                              |
| ------------------ | --------------------------------- | ------------------------------------------------------------------ |
| Pure unit          | Vitest                            | Domain state, parser, schemas, URL building, settings migrations   |
| Main integration   | Vitest in Node/Electron harness   | Vault, SQLite store, PTY, SSH/SFTP, controlled SSH server, AI      |
| Renderer component | Vitest plus DOM testing utilities | Focus, command cards, settings, panel state                        |
| Electron E2E       | Playwright (`apps/desktop/e2e/`)  | Window, preload boundary, terminal workflows, dialogs, tabs        |
| Package smoke      | Packaging scripts                 | Installed/packaged launch and native module execution              |
| Manual             | Versioned checklists              | IME, DPI, fonts, multiple displays, platform chrome, accessibility |

Determinism rules:

- Network tests use local controlled servers and byte-exact fixtures.
- Timeouts use injectable clocks where possible.
- IDs and timestamps use test providers.
- Terminal tests compare byte streams and normalized buffer snapshots, not screenshots alone.
- Secrets in fixtures are synthetic and visibly marked as non-production.

Required verification order:

1. formatting and repository checks;
2. TypeScript `noEmit` typecheck;
3. pure unit and schema tests;
4. main integration tests;
5. renderer tests;
6. platform PTY and SSH/SFTP smoke tests;
7. Electron build;
8. package creation and native module rebuild;
9. packaged-app smoke tests;
10. artifacts are produced only after every prior gate succeeds.

## 10. Risk register

| Risk                              | Detection                                 | Mitigation                                                            | Release blocker                                                |
| --------------------------------- | ----------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------- |
| Native module ABI failure         | Packaged smoke fails                      | Rebuild `node-pty` and `better-sqlite3` for Electron ABI per platform | Any supported artifact cannot start a PTY or open the database |
| xterm font/IME regression         | Manual matrix or buffer/render mismatch   | Font fallback fixtures, IME testing, WebGL fallback                   | Input loss, unreadable CJK, or incorrect cell geometry         |
| Port backpressure bug             | Memory growth, latency, missing sequence  | Credit/ack protocol, stress tests, explicit overload state            | Lost terminal bytes or unbounded growth                        |
| `ssh2` behavior gap               | Controlled-server scenario fails          | Adapter state machine, interoperability fixtures, scoped feature set  | Auth, host trust, PTY, or resize failure                       |
| SFTP blocks terminal              | Latency/stress metrics                    | Separate channels/tasks and bounded transfer events                   | Terminal becomes unresponsive during transfer                  |
| Changed-host handling weakens     | Host-key fixtures fail                    | Fail closed, serialize store changes, show both fingerprints          | Mismatch accepted without explicit approval                    |
| Parser changes command meaning    | Fixture/fuzz failure                      | Shell-specific parsers and whole-block fallback                       | Runnable incorrect candidate                                   |
| Stale command targets wrong tab   | Race E2E failure                          | Session and revision validation in main                               | Any demonstrated cross-session send                            |
| SQLite migration corrupts data    | Migration or interrupted-write test fails | Transactional migrations, `VACUUM INTO` backups, quarantine           | Data loss or a partially migrated database                     |
| Secret leakage                    | Log/IPC/bundle scanning                   | Main-only secrets, redaction, synthetic canary tests                  | Any plaintext secret outside approved memory path              |
| Linux auto-unlock is weak         | `safeStorage` reports basic backend       | Reject the basic backend; no silent fallback (ADR 0001)               | Silent insecure auto-unlock                                    |
| Unsigned update channel is abused | Release tooling or feed changes           | Nightly-only prerelease channel; SHA comparison; Windows installer    | A build can be force-downgraded or fed foreign artifacts       |
