# macOS local network issue: investigation and current status

As of October 8, 2026, there is **no verified release fix** for a local network
failure reproduced on one arm64 Mac running macOS 27.0.1 (26A434). The manually
installed Geared Term `0.1.1-beta.48` DMG can start local shells and reach a
public HTTPS endpoint, but a Finder-launched instance cannot reach a local
network host through either PTY commands or built-in SSH. The system explicitly
reports a Local Network Privacy block for the app's main process. This is a
confirmed failure on the tested host, not evidence that every macOS installation
is affected or that macOS 27 is the sole cause.

The investigation has not changed source code, release configuration, signatures,
Info.plist, system security settings, or NetworkExtension policy. A proposed
UUID/usage-description fix remains untested. The previous Homebrew installation
was removed before the manual DMG reproduction, so Homebrew is not required for
the failure.

## Tested artifact and controls

| Item | Recorded value |
| --- | --- |
| Host | macOS 27.0.1 (26A434), arm64 |
| Official arm64 DMG | `0.1.1-beta.48` |
| DMG SHA-256 | `327ed2e7b933e0f9904efd70d1f9a64b245a91e9fac2e0b1011f11378fe71582` |
| Embedded release commit | `34a9e0b7e75f228cbca5af9b09e537e158b48265` |
| Installation | `/Applications/Geared Term.app`, bundle ID `dev.gearedterm.desktop` |
| Test target | Numeric local address `10.42.0.1`, including TCP port 22 |

The release asset, embedded commit, current checkout, and local tags were
recorded separately; they are not assumed to be identical. Tests used the same
route query, numeric-IP ping, TCP port 22 probe, SSH debug connection, and public
HTTPS request. An SSH exit caused by strict rejection of an unknown host key
occurred *after* a successful network connection and is not counted as a LAN
failure. The SSH debug probe did not accept an unknown host key or send
credentials; the separate built-in SSH test used the existing app connection.

| Context | Local network result | Public HTTPS | Relevant observation |
| --- | --- | --- | --- |
| System commands in genuine Terminal.app | Ping 3/3, TCP 22 and SSH transport succeed | HTTP 200 | The target and route are available to the same user. |
| Installed beta.48 launched by Finder | Ping, TCP 22 and SSH fail with `No route to host`; built-in SSH logs `EHOSTUNREACH` | HTTP 200 | Reproduced with fresh app PIDs and the expected `/Applications` path. |
| Existing `pnpm dev` process | PTY probes and built-in SSH reach the target | HTTP 200 | Uses bare Electron and a different checkout/identity, so this is not a controlled version comparison. |
| Same installed beta.48 executable launched directly by Terminal.app | PTY probes reach the target | HTTP 200 | Binary, installation path and signature are unchanged; only launch context differs. |
| Terminal-origin beta.48, built-in SSH | Initially blocked; succeeds after the user allows Terminal's Local Network prompt | Not retested for this row | System attribution follows Terminal for this attempt. |
| Fresh Finder launch after allowing Terminal | PTY probes and built-in SSH still fail | HTTP 200 | Terminal authorization did not repair the Finder launch. |
| Fresh Geared Term application data, Finder launch | PTY ping, TCP 22 and SSH still fail | HTTP 200 | Stored app profiles, vault and settings are not necessary to reproduce the failure. Built-in SSH was not retested in this clean state. |

The route remained on the local interface. Recorded app paths did not show App
Translocation. The clean-data test moved the existing per-user Geared Term data
intact to a restricted backup outside the repository, then let the app create a
new empty data directory. It did not reset the operating system's Local Network
authorization record; the NetworkExtension policy file hash was identical before
and after. The temporary Terminal workaround is therefore context-dependent,
not a release fix.

## Runtime and package evidence

At the Finder failure, `UserEventAgent` reported a local network block for the
Geared Term main PID. It found `dev.gearedterm.desktop` by PID but
`com.github.Electron` by the main executable UUID. The recorded UUID was
`4C4C44B0-5555-3144-A1E7-5FEA7A92AB65`, which is also present in the
project's bare Electron executable. This attribution sequence repeated for PTY
probes and built-in SSH. A subsequent `nehelper` message said that Electron was
allowed by preference, but the actual socket attempts still failed; that line
must not be read as proof that Geared Term was allowed. System Settings showed an
Electron entry allowed and no Geared Term entry. Private NetworkExtension fields
also differed between the two identities, but their exact enforcement semantics
are undocumented and do not prove an explicit user denial.

When the same installed executable was started from Terminal.app, its first
built-in SSH block was attributed to Terminal. The user accepted Terminal's
Local Network prompt; retrying SSH in the same app process established a remote
connection. A later Finder launch again produced the Geared-Term-by-PID,
Electron-by-UUID block. This is strong evidence that responsible-process identity
and permission history matter on this host, but it does not isolate whether UUID
reuse, ad hoc signature identity, an OS cache, or a macOS bug is the decisive
cause.

The installed main executable is arm64, ad hoc signed, and has no Team ID. Its
designated requirement is a code hash rather than a certificate-backed stable
identity. The bundle passes deep strict code-signature verification and is not
sandboxed. Its Info.plist has no `NSLocalNetworkUsageDescription`. The actually
loaded `node-pty` module and corresponding helper are arm64, mode `0755`, ad hoc
signed, and pass strict verification. Local shells start successfully, and
built-in SSH fails without using the PTY helper. A broken native helper, missing
execute permission, or PTY startup failure does not explain this LAN-specific
result. A historical helper spawn failure was a separate earlier symptom.

The user had run an attribute-clearing command before the first installed-bundle
snapshot. No `com.apple.quarantine` attribute remained on the 993 enumerated
bundle entries, although the downloaded DMG itself retained browser quarantine.
The original quarantine/removal/restoration experiment therefore cannot be
performed faithfully on this installation. The continued failure after attribute
clearance shows that clearance was insufficient here; it does not establish that
quarantine never matters. Gatekeeper assessment on this machine reported
`override=security disabled`, so its acceptance cannot be used as evidence that
normal distribution policy passed.

## What the history and other reports establish

Ad hoc macOS signing entered this project's release workflow on September 24,
2026. The host upgraded to macOS 27.0.1 on September 29. A later packaging
change prepared `node-pty` helper permissions before signing, but did not change
LAN logic. Electron 44.4.3, `node-pty` 1.1.0, and electron-builder 26.15.3
remained fixed across the relevant project revisions. Prior beta.46 and beta.47
main executables also carried the bare Electron UUID. The last known successful
LAN use and version are unknown, and the retained beta.41 artifact was built
*after* the OS upgrade. No controlled old-version-versus-new-version runtime
comparison has established the regression boundary. Earlier self-signed
versions working does not identify which later change caused the failure.

Apple documents the role of responsible code, signatures and executable UUIDs
in [Local Network Privacy](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy),
and separately recommends distinct build UUIDs for distinct main executables in
[TN3178](https://developer.apple.com/documentation/technotes/tn3178-checking-for-and-resolving-build-uuid-problems).
[TN3127](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements)
explains why an ad hoc code-hash requirement can change between application
versions. These sources make the observed identity mismatch worth testing; they
do not prove UUID reuse alone caused this failure.

macOS 27 remains a serious candidate. [Apple DTS](https://developer.apple.com/forums/thread/814226)
confirmed a Local Network Privacy bug in an earlier macOS 27 beta, and
[Warp](https://github.com/warpdotdev/warp/issues/14189#issuecomment-5252529958)
reported recovery after a later beta update. Reports from
[Claude Code](https://github.com/anthropics/claude-code/issues/95738) and
[Chromium](https://issues.chromium.org/issues/509555633) describe related LAN
failures, including a report on 27.0.1 (26A434). They involve different
processes and conditions; the Chromium report also mentions macOS 26. These
reports corroborate that the platform can exhibit similar failures, not that
this host's exact cause is an OS regression or that every ad hoc app is affected.

Other projects suggest testable remedies: [PyInstaller changed its launcher
UUID generation](https://github.com/pyinstaller/pyinstaller/pull/9057), while
[Azahar](https://github.com/azahar-emu/azahar/pull/2428) and
[ZenNotes](https://github.com/ZenNotes/zennotes/commit/27cc8f1b72851db0f5c1ef27058816af89c0fff2)
added a Local Network usage description. A [Hermes follow-up](https://github.com/NousResearch/hermes-agent/issues/81563#issuecomment-5309147670)
reported that adding a description and changing signing did not, by itself,
restore access in its existing state. None establishes a verified Geared Term
fix.

## Current conclusion and release acceptance

- **Confirmed:** macOS Local Network Privacy blocks the Finder-launched beta.48
  release on this host. The target is reachable from Terminal; external HTTPS
  works; the installed app and native helper signatures verify; clearing app
  data or quarantine did not restore Finder-launched LAN access.
- **Best-supported explanation:** responsible-code attribution and persisted
  authorization disagree for the repackaged Electron app. Shared main UUID,
  ad hoc version-specific signing identity, and a macOS 27 policy or cache bug
  are plausible contributing factors.
- **Unverified:** UUID collision as the sole cause, missing usage description
  as the sole cause, an OS regression specific to build 26A434, and a
  certificate-backed signature as a sufficient fix. The current evidence does
  not justify declaring macOS 27 solely responsible or the issue permanently
  unfixable.

The only verified temporary workaround on the affected machine is launching
the installed executable directly from genuine Terminal.app and granting
Terminal Local Network access when prompted. Finder launch remains blocked.
This workaround changes permission attribution and should not be presented as
a corrected release. The tested launch command is:

```sh
"/Applications/Geared Term.app/Contents/MacOS/Geared Term"
```

The issue remains open until a manually installed DMG,
launched from Finder, can use PTY ping/TCP/SSH and built-in SSH to reach the LAN
target, with system attribution consistently naming Geared Term. Denying and
re-allowing its permission should produce the expected block and recovery, and
the bundle and actual native helper must still pass signature checks.

The next discriminating test is the unchanged beta.48 DMG in a clean user or VM
snapshot on the same OS build, recording the first prompt and connection. A
future controlled build comparison should vary the main UUID and
`NSLocalNetworkUsageDescription` independently while holding signing method,
installed path, payload, and network target constant as far as possible. UUID
editing itself requires re-signing, so the controls must be re-signed the same
way. A same-artifact comparison across OS versions would be needed to establish
a macOS 27 regression. This investigation did not have a clean account or VM
available and did not perform a global permission reset. Apple's per-entry Local
Network reset UI starts in macOS 27.2, later than the tested host.
