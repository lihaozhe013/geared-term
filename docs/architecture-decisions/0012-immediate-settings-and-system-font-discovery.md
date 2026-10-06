# ADR 0012: Immediate settings updates and system font discovery

- Status: Accepted
- Date: 2026-10-05
- Relates to: SPEC SET-016–017 and SEC-001–005

## Context

Ordinary preference controls should reflect a user's choice immediately and retain it across windows
and restarts. The existing complete-settings save request permits overlapping renderer updates to
overwrite one another. Font family fields also need searchable system choices without giving
renderers access to font files.

## Decision

- Add a strict sparse settings patch schema and `settings:patch` IPC. Merge each patch into the
  latest validated record in a main-process serial queue; missing fields remain untouched, and array
  fields are replaced as a whole. Keep the existing complete `settings:save` API for compatibility
  and serialize it through the same queue.
- Apply and broadcast each successful update after its atomic persistence succeeds. A persistence
  failure leaves the last confirmed in-memory settings unchanged and can be retried from Settings.
- Apply ordinary General, Appearance, Terminal, Shortcuts, default-provider, and update-check
  preferences immediately. Keep SFTP remote-file commands and global AI instructions behind their
  existing explicit buttons. AI connection editing and vault operations keep their existing flows.
- Persist window-effect changes immediately and keep the launch-backing restart notice. New-session
  defaults affect future sessions only.
- Add `settings:system-fonts`, callable only from the Settings window. Main scans its platform's
  standard font directories through `font-finder`, caches successful TTF/OTF family-name results,
  and returns names only. The request contains no path and the response contains no file metadata. A
  failed scan is not cached, so Settings can retry it.
- Use the shared fuzzy-search component for UI font, terminal primary font, and terminal fallback
  fonts. Search is temporary; choosing a discovered family, choosing the system-default UI font, or
  explicitly confirming a custom name is the only action that changes a font setting.

## Security review

- The settings patch is validated by a strict protocol schema in preload and main, rejects empty
  patches and unknown fields, and is accepted only from the main or Settings window. It cannot
  invoke an unrelated privileged operation. Existing complete saves remain compatible.
- Font listing accepts only an empty request, is restricted to Settings, and traverses only the
  scanner's fixed platform font directories. No renderer-supplied filesystem path, file contents, or
  absolute font path crosses IPC. The new capability does not spawn a process or change the existing
  permission blocker, navigation rules, CSP, or preload sandbox.
- The immediate `allowRiskyRun` preference continues to be checked by the existing main-process
  command action validation; existing destructive-command confirmations remain in place.

## Consequences

- Ordinary preference controls no longer need Apply or Save. SFTP command and AI instruction drafts
  remain unchanged until the user uses their existing buttons.
- Settings updates from main and auxiliary windows are ordered and merged on the latest persisted
  record, preventing stale full-record snapshots from dropping unrelated changes.
- Fonts that cannot be discovered remain selectable by custom name. Font files in formats other than
  TTF and OTF are outside the initial system scan.

## Verification

- Protocol and main-process tests cover sparse validation, patch merging, ordered writes, retry
  after failure, and system-font result caching and retry.
- Playwright covers immediate application to an open terminal, fallback-font updates, persistence
  across restart, cross-window writes, font IPC ownership, and the retained SFTP/AI save actions.
