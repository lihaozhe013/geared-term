const CONTROL_CHARACTERS = /[\u0000-\u0008\u000a-\u001f\u007f]/u;

/**
 * Quotes a remote path for POSIX shells using single quotes. File names that
 * contain terminal control characters are rejected instead of injected.
 */
export function quoteRemotePath(remotePath: string): string {
  if (remotePath.length === 0) throw new Error('Remote path is empty');
  if (CONTROL_CHARACTERS.test(remotePath)) {
    throw new Error('File name contains unsupported terminal control characters');
  }
  return `'${remotePath.replaceAll("'", "'\\''")}'`;
}

/** Builds `command '<quoted path>'` after validating both halves. */
export function buildRemoteFileCommand(command: string, remotePath: string): string {
  if (!/^[^\s]+$/u.test(command) || command.includes("'") || CONTROL_CHARACTERS.test(command)) {
    throw new Error('Remote file command must be a single executable name');
  }
  return `${command} ${quoteRemotePath(remotePath)}`;
}
