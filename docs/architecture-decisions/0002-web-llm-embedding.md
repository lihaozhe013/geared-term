# ADR 0002: LLM web page embedding boundary

- Status: Accepted
- Date: 2026-09-23
- Relates to: `SPEC.md` WEB-001 through WEB-019, CMD-011 through CMD-021, SEC-001 through SEC-008;
  `docs/web-llm-page-support-requirements.md`

## Context

The product previously exposed AI only through API streaming. A new capability lets users chat with
real LLM websites (first targets: `chatgpt.com` and `chat.deepseek.com`) inside the application,
reusing their existing logins and subscriptions, and turns shell code blocks in their answers into
Copy/Insert/Run candidates. This changes three policy areas that AGENTS.md gates behind a recorded
decision: the process boundary for remote content, the parser execution policy for web-derived
candidates, and the URL/navigation handling around embedded pages. The previous specification listed
third-party web embedding as a non-goal; this ADR replaces that position.

## Decision

1. **Embedding mechanism.** Sites run in a `WebContentsView` docked into the right panel's web pane,
   not an iframe (sites refuse framing) and not a `<webview>` (unsupported by Electron). The view is
   a native surface: the renderer reports a placeholder rectangle, and the main process sets view
   bounds. The view is hidden whenever the web tab is inactive, the window is hidden, or trusted UI
   (dialogs, context menus, the terminal-snapshot window) needs to appear above it.
2. **Session isolation.** Each site gets its own persistent partition (`persist:llm-web-<site>`).
   Remote content never attaches to `session.defaultSession`, which only carries the application's
   own renderers. Partitions have their own permission, navigation, and download handlers; none
   inherit the application CSP because that would break the site. Login state persists per site in
   the partition on disk and can be cleared per site from Settings.
3. **Injection and parser execution policy.** A dedicated sandboxed preload (`preload-web`) with
   context isolation runs per-site adapters in the view's isolated world. It observes rendered code
   blocks, classifies language labels, and runs the pure `packages/command-parser` bundle in that
   context to produce candidates with revisions. This mirrors the existing model where the renderer
   parses and the main process re-validates. The injected context has no terminal, filesystem,
   process, or arbitrary-channel capability: it can only emit schema-validated report events on
   channels the manager accepts from its own tracked `webContents.id`.
4. **Trust boundary for actions.** The embedded page never hosts Copy/Insert/Run affordances.
   Candidates are relayed through the main process (which enforces per-page bounds, byte caps, rate
   limits, and the per-site enhancement toggle) to a trusted command-card strip in the main
   renderer. The payload shown on a card is the payload sent; the main process re-derives the
   revision and re-parses before any PTY/SSH write, reusing the existing `terminal:command-action`
   path unchanged. A malicious or compromised page therefore cannot trigger, alter, or forge a
   terminal action, satisfying WEB-008/WEB-009.
5. **Streaming stability policy.** A block becomes `stable` only after the adapter reports the site
   is not generating and the block's text has not mutated for a quiet period. Run is gated on that
   state plus the parser's own completeness check; stale revisions fail closed on submit. This
   extends CMD-011/012 semantics to a DOM source instead of the AI stream.
6. **Navigation, popups, downloads.** The manager allows navigation only to the site adapter's
   declared origins (including its authentication endpoints). Cross-origin links open in the system
   browser through the existing validated `https:` allowlist. `window.open` is denied except for
   adapter-declared authentication origins, which open as managed child windows in the same
   partition so OAuth logins (e.g. DeepSeek via Google/GitHub) complete without leaving the
   isolation boundary. Downloads are denied in this release.
7. **Adapter health and degradation.** Each adapter probes expected page structures and reports an
   opaque health result. Failed probes or excessive adapter errors move the site to `unavailable` or
   `broken`, which stops candidate relay and shows the status in the pane toolbar. A site update
   therefore degrades to normal browsing; it cannot silently produce misaligned Run buttons.
8. **Observability.** A dedicated redacted log category records site identifiers, status
   transitions, block counts, language labels, parse outcome classes, and action counts. Command
   text, page text, terminal content, and credentials are never logged (WEB-018).

## Consequences

- Third-party web content enters the application boundary as data only; the existing validated IPC
  and main-process re-validation carry the entire trust story, so no new privileged path is opened.
- Site redesigns will break adapters. The per-site status model contains the blast radius, and the
  probe/degrade rule trades maintenance for safety: a broken adapter disables enhancement rather
  than guessing.
- The native view is always above panel DOM. The hidden-while-overlaying rule is required for
  dialogs and menus to stay usable, and bounds synchronization adds layout work the API assistant
  panel does not have.
- Parser execution moves partly into a sandboxed remote view. The parser is pure, size-bounded, and
  re-validated in main, so this enlarges attack surface less than a permissive in-page bridge would.
- Two persistent partitions add disk-state lifecycle (clear-data UI, quarantine, uninstall) that the
  default session never had to expose per-site.
