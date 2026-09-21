/** Structural view of the xterm API needed for extraction, so the module is
 *  unit-testable without a DOM or the real Terminal class. */
export type ChatSourceTerminal = {
  rows: number;
  buffer: {
    active: {
      type: 'normal' | 'alternate';
      viewportY: number;
      getLine(line: number): { translateToString(trimRight?: boolean): string } | undefined;
    };
  };
  hasSelection(): boolean;
  getSelection(): string;
};

export const chatTextMaxBytes = 256 * 1024;

// CSI, OSC (BEL- or ST-terminated), other two-byte escapes, and bare CRs.
const controlPattern = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b[@-_]|\r/g;

function stripControlSequences(text: string): string {
  return text.replace(controlPattern, '');
}

/** Selection text for "add selection to chat", or null without a selection. */
export function extractSelectionText(terminal: ChatSourceTerminal): string | null {
  if (!terminal.hasSelection()) return null;
  const text = stripControlSequences(terminal.getSelection());
  return text.length > 0 ? truncateToUtf8Bytes(text, chatTextMaxBytes).text : null;
}

/** Visible viewport text for "add screen snapshot to chat", trailing blank
 *  lines trimmed; null when the screen is empty. Reads the xterm buffer,
 *  never the DOM (SPEC TERM-017). */
export function extractViewportText(terminal: ChatSourceTerminal): string | null {
  const buffer = terminal.buffer.active;
  const firstLine = buffer.viewportY;
  const lastLine = buffer.viewportY + terminal.rows - 1;
  const lines: string[] = [];
  for (let line = firstLine; line <= lastLine; line += 1) {
    lines.push(stripControlSequences(buffer.getLine(line)?.translateToString(true) ?? ''));
  }
  while (lines.length > 0 && lines.at(-1)?.length === 0) {
    lines.pop();
  }
  if (lines.length === 0) return null;
  const text = truncateToUtf8Bytes(lines.join('\n'), chatTextMaxBytes).text;
  return text.length > 0 ? text : null;
}

/** Wraps terminal text in a fenced code block; the fence grows past any
 *  backtick run inside the payload (CommonMark fence-length rule). */
export function formatChatInsert(text: string): string {
  let longest = 0;
  for (const match of text.matchAll(/`{3,}/g)) {
    longest = Math.max(longest, match[0].length);
  }
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}terminal\n${text}\n${fence}`;
}

function codePointUtf8Length(code: number): number {
  if (code < 0x80) return 1;
  if (code < 0x800) return 2;
  if (code < 0x10000) return 3;
  return 4;
}

function truncateToUtf8Bytes(text: string, maxBytes: number): { text: string; truncated: boolean } {
  let bytes = 0;
  let end = 0;
  for (const char of text) {
    const length = codePointUtf8Length(char.codePointAt(0) ?? 0);
    if (bytes + length > maxBytes) {
      const cut = text.slice(0, end);
      const lastNewline = cut.lastIndexOf('\n');
      return { text: lastNewline > 0 ? cut.slice(0, lastNewline) : cut, truncated: true };
    }
    bytes += length;
    end += char.length;
  }
  return { text, truncated: false };
}
