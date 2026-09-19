export type SnapshotSource = 'selection' | 'viewport' | 'viewport+preceding';

export type TerminalSnapshot = {
  text: string;
  source: SnapshotSource;
  truncated: boolean;
  /** Inclusive buffer line bounds; null when the source is a selection. */
  lineStart: number | null;
  lineEnd: number | null;
  charCount: number;
  alternateScreen: boolean;
};

export type SnapshotOptions = {
  precedingLines: number;
  maxBytes?: number;
};

export type SnapshotBufferLine = {
  translateToString(trimRight?: boolean): string;
};

export type SnapshotBuffer = {
  type: 'normal' | 'alternate';
  viewportY: number;
  baseY: number;
  height: number;
  getLine(line: number): SnapshotBufferLine | undefined;
};

export type SnapshotTerminal = {
  rows: number;
  buffer: { active: SnapshotBuffer };
  hasSelection(): boolean;
  getSelection(): string;
};

export const snapshotMaxBytes = 256 * 1024;

const controlPattern = /?\x1b\[[0-9;?]*[ -/]*[@-~]|?\x1b\][^\x07]*(|\x1b\\)||\r/g;

function stripStyles(text: string): string {
  return text.replace(controlPattern, '');
}

/**
 * Extracts bounded context from the xterm buffer (never the DOM or a PTY log):
 * a non-empty selection wins; otherwise the viewport plus a bounded number of
 * preceding scrollback lines (none on the alternate screen).
 */
export function extractSnapshot(
  terminal: SnapshotTerminal,
  options: SnapshotOptions
): TerminalSnapshot | null {
  if (terminal.hasSelection()) {
    const text = stripStyles(terminal.getSelection());
    if (text.length === 0) return null;
    const bounded = enforceLimit(text, options.maxBytes ?? snapshotMaxBytes);
    return {
      text: bounded.text,
      source: 'selection',
      truncated: bounded.truncated,
      lineStart: null,
      lineEnd: null,
      charCount: bounded.text.length,
      alternateScreen: terminal.buffer.active.type === 'alternate'
    };
  }

  const buffer = terminal.buffer.active;
  const alternate = buffer.type === 'alternate';
  const lastLine = buffer.viewportY + terminal.rows - 1;
  let firstLine = lastLine;
  if (!alternate && options.precedingLines > 0) {
    firstLine = Math.max(0, buffer.viewportY - Math.floor(options.precedingLines));
  } else {
    firstLine = Math.max(0, buffer.viewportY);
  }

  const lines: string[] = [];
  for (let line = firstLine; line <= lastLine; line += 1) {
    lines.push(stripStyles(buffer.getLine(line)?.translateToString(true) ?? ''));
  }
  while (lines.length > 0 && lines.at(-1)?.length === 0) {
    lines.pop();
  }
  if (lines.length === 0) return null;

  const text = enforceLimit(lines.join('\n'), options.maxBytes ?? snapshotMaxBytes);
  if (text.text.length === 0) return null;
  return {
    text: text.text,
    source: firstLine < buffer.viewportY ? 'viewport+preceding' : 'viewport',
    truncated: text.truncated,
    lineStart: firstLine,
    lineEnd: firstLine + lines.length - 1,
    charCount: text.text.length,
    alternateScreen: alternate
  };
}

function enforceLimit(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const byteLength = Buffer.byteLength(text, 'utf8');
  if (byteLength <= maxBytes) {
    return { text, truncated: false };
  }
  let end = Math.floor(maxBytes);
  // Never split a UTF-8 code point in half.
  while (end > 0 && (text.charCodeAt(end) & 0xc0) === 0x80) {
    end -= 1;
  }
  const cut = text.slice(0, end);
  const lastNewline = cut.lastIndexOf('\n');
  const bounded = lastNewline > 0 ? cut.slice(0, lastNewline) : cut;
  return { text: bounded, truncated: true };
}

/** Wraps snapshot text as a clearly delimited untrusted observation block. */
export function formatSnapshotForPrompt(snapshot: TerminalSnapshot): string {
  const bounds =
    snapshot.lineStart === null
      ? 'selection'
      : `buffer lines ${snapshot.lineStart}-${snapshot.lineEnd}`;
  return [
    '--- BEGIN UNTRUSTED TERMINAL SNAPSHOT ---',
    `source: ${snapshot.source} (${bounds}${snapshot.truncated ? ', truncated' : ''})`,
    snapshot.text,
    '--- END UNTRUSTED TERMINAL SNAPSHOT ---'
  ].join('\n');
}
