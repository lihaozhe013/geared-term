# ADR 0011: Default General preferences and destructive command confirmation

- Status: Accepted
- Date: 2026-10-05
- Relates to: `SPEC.md` APP-026, CMD-020–021, SET-015

## Context

New settings start with all three General preferences enabled: split assistant command blocks, allow
Run for commands classified as risky, and keep the app resident after its main window closes. The
risky-command preference changes which assistant commands can be submitted from their Run action.
Destructive command classification is a warning aid and is not a shell sandbox.

## Decision

- Keep all three General preferences enabled for new settings. Existing persisted values remain
  authoritative.
- When the assistant offers Run for a command classified as destructive, require a separate
  confirmation for that command before invoking the existing validated main-process action.
  Declining the prompt sends nothing to the terminal.
- Keep the main process's existing command revision, parser, exact-payload, run-eligibility, and
  `allowRiskyRun` checks unchanged. Copy and Insert remain available under their current rules.
- Keep the existing background tray behavior and explicit Quit action; macOS continues to use normal
  Dock behavior without a tray.

## Security review

The default allows users to submit destructive assistant suggestions more readily, so a per-command
confirmation is required before the renderer invokes Run. The main process still reparses the exact
payload and validates its revision, eligibility, and persisted preference. The risk classifier is
not a security boundary; a missed classification does not make the shell safe. This change adds no
IPC operation, preload capability, secret access, URL handling, filesystem scope, process spawn, or
parser execution path.

## Consequences

- New installations show all three General checkboxes as enabled.
- Destructive Run actions prompt each time, while ordinary Run actions retain one-click behavior.
- Disabling the risky-command preference continues to reject destructive Run requests in the main
  process.
