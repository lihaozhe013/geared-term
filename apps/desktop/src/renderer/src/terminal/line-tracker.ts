import type { Terminal } from '@xterm/xterm';

export type SubmittedLine = {
  text: string;
  edited: boolean;
};

export type LineTracker = {
  buffer: string;
  edited: boolean;
};

const MAX_LINE_LENGTH = 1024;

export function createLineTracker(): LineTracker {
  return { buffer: '', edited: false };
}

/**
 * Reconstructs submitted shell lines from user keystrokes (WindTerm-style cd
 * following). Tab completion and escape-prefixed editing (history recall,
 * arrow keys) mark the line `edited`: the buffer no longer matches the real
 * command, so the caller should recover it from the terminal screen echo.
 */
export function observeKeystrokes(
  tracker: LineTracker,
  data: string
): { tracker: LineTracker; lines: SubmittedLine[] } {
  let line = tracker.buffer;
  let edited = tracker.edited;
  const lines: SubmittedLine[] = [];
  for (const character of data) {
    const code = character.codePointAt(0) ?? 0;
    if (character === '\r' || character === '\n') {
      const text = line.trim();
      if (text) lines.push({ text: line.slice(0, MAX_LINE_LENGTH), edited });
      line = '';
      edited = false;
    } else if (code === 0x7f || code === 0x08) {
      line = line.slice(0, -1);
    } else if (code === 0x03) {
      line = '';
      edited = false;
    } else if (code === 0x09 || code === 0x1b) {
      // Tab completion / edit sequences: trust the screen echo instead.
      edited = true;
    } else if (code >= 0x20) {
      if (line.length < MAX_LINE_LENGTH) line += character;
      else edited = true;
    }
  }
  return { tracker: { buffer: line, edited }, lines };
}

/** Reads the terminal row under the cursor, where the echoed command lives. */
export function readEchoedCommandLine(terminal: Terminal): string | null {
  const buffer = terminal.buffer.active;
  const line = buffer.getLine(buffer.baseY + buffer.cursorY);
  return line ? line.translateToString(true) : null;
}

/**
 * Extracts the `cd ...` command from a screen row. Commands sit at the end of
 * the row (prompt first); the last standalone `cd` token wins, so `cd` inside
 * prompt text or longer words is ignored. Returns null when the row holds no
 * usable cd command.
 */
export function extractCdFromScreenLine(row: string): string | null {
  const text = row.trimEnd();
  for (let index = text.length - 3; index >= 0; index -= 1) {
    if (text[index] !== 'c' || text[index + 1] !== 'd' || !/\s/u.test(text[index + 2] ?? '')) {
      continue;
    }
    const before = index === 0 ? undefined : text[index - 1];
    if (before !== undefined && !/[\s$>%#!]/u.test(before)) continue;
    const command = text.slice(index).trim();
    return command.length > 2 ? command : null;
  }
  return null;
}

/** Absolute-path rows on the hidden alternate screen: the quiet `pwd` output. */
export function readAlternateScreenPath(
  terminal: Terminal,
  alternateActive: boolean
): string | null {
  if (!alternateActive) return null;
  const buffer = terminal.buffer.active;
  for (let y = 0; y < terminal.rows; y += 1) {
    const row = buffer
      .getLine(buffer.baseY + y)
      ?.translateToString(true)
      .trim();
    if (row && row.startsWith('/') && !row.includes(' ')) return row;
  }
  return null;
}
