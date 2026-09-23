# ADR 0004: Bundle a pinned ConPTY runtime on Windows x64

- Status: Accepted
- Date: 2026-09-23
- Relates to: local terminal transport and Windows packaging

## Context

On the affected Windows installation, Windows Error Reporting recorded `conhost.exe` crashing with
exception `0xc0000005`. A few seconds later, PowerShell Core failed fast while querying its console
buffer after the console pipe closed with Win32 error 233 (`0xE9`). The visible result was a
`pwsh.exe - System Warning` dialog reporting “Unknown Hard Error”. Geared Term currently uses the
system ConPTY through `node-pty` 1.1.0.

WezTerm documented and reproduced the same OpenCode and PowerShell failure, then reported that the
matching Microsoft Windows Terminal ConPTY runtime fixed it:
https://github.com/wezterm/wezterm/issues/7774. The Microsoft pair is distributed in the official
Windows Terminal `v1.24.10921.0` release as NuGet package version `1.24.260402001`.

## Decision

1. Keep `node-pty` pinned at 1.1.0 and bundle Microsoft's x64 `conpty.dll` and `OpenConsole.exe`
   from `Microsoft.Windows.Console.ConPTY` 1.24.260402001. Their package source, SHA-256 digests,
   Authenticode signer thumbprints, and MIT license are recorded in
   `apps/desktop/resources/conpty/win32-x64/README.md` and `manifest.json`.
2. Set `useConptyDll: true` for every local Windows x64 session. PowerShell, cmd, and WSL therefore
   use the same pinned backend. Keep other operating systems and Windows ARM64 on their current
   backend.
3. Before Windows x64 development startup and in Electron `afterPack`, verify both binary digests
   and stage the pair under `conpty/` beside every x64 `conpty.node` load location. Missing or
   modified files fail staging or packaging.
4. On natural PTY exit, mark and retire the session before renderer port cleanup can run. Catch PTY
   write and resize errors, report a terminal failure state, and log the operation and error.
5. Keep the public IPC and MessagePort schemas unchanged.

## Security review

- Local shell requests continue to pass through `LocalTerminalRequestSchema`; no command, argument,
  environment, or filesystem capability was added to the renderer or preload API.
- The bundled executable and DLL are from Microsoft's official release package. Both source files
  had valid Microsoft Authenticode signatures when acquired, and their exact SHA-256 digests are
  pinned in the repository. Build hooks only copy these fixed files into the app's native-module
  runtime directory.
- `OpenConsole.exe` and `conpty.dll` are shipped together beside the native binding because the
  native ConPTY implementation locates the DLL relative to `conpty.node`. The backend is selected
  only for Windows x64, and no downloaded or renderer-supplied path is used for these assets.
- The existing shell spawn boundary remains the same. The only spawn-option change selects
  node-pty's local ConPTY DLL backend; it does not alter shell resolution or user-provided arguments.
- Updating the Microsoft runtime requires reviewing its release, license, Authenticode signatures,
  and hashes, then repeating the packaged smoke and affected-machine exit checks.

## Verification and release gate

Unit coverage checks Windows x64 backend selection, natural-exit cleanup, and write/resize errors
during shutdown. Windows x64 packaged smoke verifies hashes beside every loadable native binding,
starts cmd, and measures the PowerShell prompt through the packaged app's xterm UI. The latest run
verified the hashes and cmd; PowerShell prompt times were 5.387, 0.444, and 0.468 seconds. The
median (0.468 seconds) and maximum (5.387 seconds) passed the 3-second median and 8-second maximum
limits. The first PowerShell launch includes a cold-start delay; subsequent launches were under
500 ms. The node-pty issue reporting roughly 3.5 seconds with a raw PTY listener does not account
for terminal-generated responses, which the packaged UI smoke now supplies through xterm:
https://github.com/microsoft/node-pty/issues/894.

The WSL command worked when launched directly through `wsl.exe`, but the packaged interactive WSL
session has not been verified. Run that check in the packaged UI before release.

The manual OpenCode acceptance remains outstanding: on the affected Windows machine, run `opencode`,
enter `/exit`, and confirm the PowerShell prompt returns with the terminal tab open. Confirm no
hard-error dialog and no corresponding new `conhost.exe` crash or `pwsh.exe` FailFast event before
releasing the fix.
