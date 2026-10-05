# ADR 0001: Password-free unlock policy

- Status: Accepted
- Date: 2026-10-05
- Relates to: `SPEC.md` VLT-006, VLT-008, VLT-009

## Context

Password-free unlock lets users start Geared Term without typing the master password. The
requirement is opt-in, must explain its device-local trust model, and must store the key-encryption
key (KEK) separately from the wrapped vault key. OS-protected storage is preferred; a local fallback
may only be offered with an explicit warning.

## Decision

1. **Enablement.** Password-free unlock is off by default. While the vault is unlocked, the user can
   enable it from the credential-vault box in the profile editor. The UI displays the trust model:
   the vault key is protected by the OS account only, and anyone with access to that user profile
   can read saved secrets.
2. **Key material.** Enabling generates a random 32-byte KEK. The KEK is encrypted by Electron
   `safeStorage` and written to `vault-auto.key` (mode 0600). The vault key is wrapped with the KEK
   (AES-256-GCM, purpose-bound AAD `geared-term:v1:auto-unlock-wrap`) and written to
   `vault-auto.json` (mode 0600). KEK and wrapped key live in separate files, satisfying VLT-008.
3. **Platform policy.** Password-free unlock requires a successful encrypt-and-decrypt probe with a
   random, non-secret value. On Linux, use Electron's asynchronous `safeStorage` API so key-service
   initialization completes before support is decided. New encryption must produce the OS-protected
   `v11` or `v12` format; reject `v10` `basic_text` output and unknown formats. For compatibility,
   permit decryption of legacy `v10` material only after a fresh probe verifies the current provider
   encrypts and decrypts with an OS-protected format. Other platforms keep their synchronous
   platform-backed `safeStorage` implementation and use the same probe. No local fallback is offered
   (VLT-009).
4. **Lock semantics.** Locking the vault sets a process-local suppression flag so auto-unlock cannot
   silently re-unlock during the same run (VLT-006). A restart may auto-unlock again while the
   feature remains enabled. Disabling removes both files immediately.
5. **Rotation interaction.** Master-password rotation re-wraps the new vault key with a fresh KEK.
   If re-wrapping fails, auto-unlock is disabled rather than left in a state that cannot unlock.
6. **Failure handling.** Unreadable or corrupt auto-unlock material never blocks startup; the
   application falls back to the password path and logs a warning. The settings view can retry a
   failed support check after the key service is unlocked and refreshes on focus and vault changes.
   If support cannot be confirmed, enabling remains disabled and the user receives a localized
   explanation.
7. **Vault lifecycle.** Auto-unlock operations await key-service work before copying the vault key.
   A vault generation check cancels writes if the vault is locked or rotated while an enable
   operation is pending. Temporary KEK and vault-key buffers are zeroed after use.

## Security review

The change adds no preload methods or IPC channels. Linux key material uses Electron's asynchronous
OS key providers, and encrypted output is checked for an OS-protected version tag before it is
stored or decrypted. The explicit weak-backend rejection remains in place, and no key material or
probe plaintext is sent to the renderer or diagnostics. The main process checks that the same
unlocked vault generation is still active immediately before it writes the two existing mode-0600
files.

## Consequences

- A stolen `vault-auto.key` is useless off-device as long as the OS key service is intact.
- On systems without an OS key service, users keep the password path; no weak fallback exists.
- `AppStorage` accepts a `SafeStorageAdapter` so the behavior is testable without Electron.
