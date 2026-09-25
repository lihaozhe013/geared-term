# ADR 0006: Update check preferences and in-app notices

- Status: Accepted
- Date: 2026-09-25
- Relates to: SPEC.md UPD-003, UPD-004, UPD-007

## Context

Automatic update checks currently show a blocking native prompt, and a dismissed nightly can be
announced again after restart. The update settings also need an opt-out that leaves manual checks
available. Windows installer checks must not start downloads without a user action.

## Decision

1. Persist `autoCheckUpdates` in the versioned settings record, defaulting to `true` when reading
   existing records. Users can change it in Settings → About; manual checks remain available.
2. Replace the native prompt with a themed, non-modal card in the main renderer. Only automatic
   checks can create a notice. The card remains until the user opens About or dismisses it.
3. Store the last dismissed or viewed full nightly SHA in `update-notice.json` under the app user
   data directory. Keep an unhandled notice in main-process memory so it can be queried after a
   renderer reload; the next automatic check reconstructs it after an app restart.
4. Disable `electron-updater` automatic downloads. A validated `updates:download` operation starts a
   download only for a packaged Windows NSIS installer with an available update.
5. Keep portable Windows, macOS, and Linux updates on manual release-page downloads. Homebrew
   installs receive the upgrade command as display text and the application never executes it.

## Security review

The preload exposes only typed update operations. Notice query and dismissal are restricted to the
main window; starting a download is restricted to the Settings window. The dismissal request accepts
only a full commit SHA, and the download operation accepts no URL, path, command, or artifact name.
The persisted notice record is schema-validated and remains within the application user data
directory. Homebrew guidance is rendered as text and is not passed to a process-spawning API.

## Consequences

Existing settings remain valid because the new boolean has a default and the settings schema version
does not change. Dismissal state is isolated from renderer-owned settings writes. A newly published
nightly SHA can be announced while the same dismissed SHA stays quiet across restarts. Windows users
must explicitly start a download before the existing progress and install flow becomes active.
