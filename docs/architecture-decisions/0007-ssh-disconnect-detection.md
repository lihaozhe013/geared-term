# ADR 0007: SSH disconnect detection and failure presentation

Status: Accepted

## Context

An SSH socket can remain half-open after a network interruption or when the remote machine sleeps or
loses power. In that state `ssh2` may not emit `close` promptly. When the connection did close, the
SSH manager reported a normal `closed` state, and the renderer removed tabs after an `exited` state.
Users therefore could lose the final screen without seeing why the session stopped.

## Decision

- Send SSH keepalives every 10 seconds and disconnect after two unanswered probes.
- Emit one `failed` state with a validated failure code for transport, authentication, host-key,
  shell-request, and unexpected remote-channel failures. Log detailed errors in the SSH domain log;
  do not send them through the renderer message port.
- Treat a remote exit report as a normal exit. Treat user-requested closure as intentional.
- Keep a failed SSH tab and its final terminal output available. Mark the tab and show a localized
  inline notice with an action to close the tab. Do not reconnect automatically.

## Consequences

The expected silent-loss detection time is about 30 seconds after the last successful response.
Operating-system sleep can pause timers, so detection occurs after the application resumes and its
event loop runs again. Short network interruptions may end the connection after the probe limit.

The optional failure code extends the existing validated terminal state message. No new IPC channel
or secret-bearing renderer data is introduced.

## Validation

The controlled SSH integration suite covers abrupt disconnects, dropped keepalive responses,
unexpected shell-channel closure, normal remote exit, and user-requested closure. Renderer tests
cover failure-state retention, tab status, and localized error copy.
