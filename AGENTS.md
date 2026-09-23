# AGENTS.md

## Rules

1. All code comments, commit messages, and documentation must be written in English; commit messages
   must follow Conventional Commits.
2. Before adding responsibilities to a source file over 1,000 lines, evaluate whether it should be
   split into focused modules.
3. Cross-package imports must use workspace package names (e.g. `@geared-term/protocol`), never
   relative paths that cross package boundaries; within a package, use relative imports (`./` for
   siblings, at most one `../` level) rather than path aliases.

Debug builds write logs into `debug-logs/` (release builds into the per-user data directory):
`debug.log` is a summary of application warnings/errors, and `debug-{feature}.log` hold full
per-domain output with startup and 2 MB size rotation (`*.previous.log` keeps the prior session) —
check the summary file first, then the matching domain file, when debugging.

## Reference documents

- `SPEC.md` is the normative behavior specification; `docs/architecture.md` describes the current
  implementation design; `docs/requirements-matrix.md` records implementation status and evidence.

## Review requirements

- Require an architecture decision record in `docs/architecture-decisions/` for process-boundary
  changes, persistence formats, auto-unlock policy, and parser execution policy.
- Require security review for preload additions, new IPC operations, URL handling, secret access,
  process spawning, filesystem scope, and command execution paths.
- Require packaged smoke evidence when Electron, the Node ABI, `node-pty`, `better-sqlite3`,
  electron-builder, or signing configuration changes.
- Do not mix functional behavior changes and visual redesign in the same commit or review.
