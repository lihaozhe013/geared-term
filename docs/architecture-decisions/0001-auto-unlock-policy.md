# ADR 0001: Password-free unlock policy

- Status: Accepted
- Date: 2026-09-19
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
3. **Platform policy.** Password-free unlock requires `safeStorage.isEncryptionAvailable()`. On
   Linux, the `basic_text` backend is rejected: it is not OS-protected and would silently weaken the
   trust model. No local fallback is offered in this release; the feature reports "No OS key service
   is available" instead (VLT-009).
4. **Lock semantics.** Locking the vault sets a process-local suppression flag so auto-unlock cannot
   silently re-unlock during the same run (VLT-006). A restart may auto-unlock again while the
   feature remains enabled. Disabling removes both files immediately.
5. **Rotation interaction.** Master-password rotation re-wraps the new vault key with a fresh KEK.
   If re-wrapping fails, auto-unlock is disabled rather than left in a state that cannot unlock.
6. **Failure handling.** Unreadable or corrupt auto-unlock material never blocks startup; the
   application falls back to the password path and logs a warning.

## Consequences

- A stolen `vault-auto.key` is useless off-device as long as the OS key service is intact.
- On systems without an OS key service, users keep the password path; no weak fallback exists.
- `AppStorage` accepts a `SafeStorageAdapter` so the behavior is testable without Electron.
