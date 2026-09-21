const STORAGE_KEY = 'geared.debug-input';

/**
 * Opt-in tracing for the terminal input path (keydown quirks, keypress
 * delivery, focus-state changes), used to diagnose bugs that only reproduce
 * interactively. Turn it on by setting the `geared.debug-input` localStorage
 * key to `1`; output goes to the devtools console because the structured
 * log writer only exists in the main process.
 */
export function inputDiagnosticsEnabled(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function logInputDiagnostic(message: string, details?: Record<string, unknown>): void {
  if (!inputDiagnosticsEnabled()) return;
  console.debug(`[geared:input] ${message}`, details ?? {});
}
