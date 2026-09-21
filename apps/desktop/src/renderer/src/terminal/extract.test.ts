import { describe, expect, it } from 'vitest';
import {
  chatTextMaxBytes,
  extractSelectionText,
  extractViewportText,
  formatChatInsert,
  type ChatSourceTerminal
} from './extract';

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

function makeTerminal(
  lines: string[],
  overrides: Partial<ChatSourceTerminal> = {}
): ChatSourceTerminal {
  const buffer: ChatSourceTerminal['buffer']['active'] = {
    type: 'normal',
    viewportY: Math.max(0, lines.length - 4),
    getLine: (line) => {
      const text = lines[line];
      return text === undefined
        ? undefined
        : { translateToString: (trimRight) => (trimRight ? text.trimEnd() : text) };
    }
  };
  return {
    rows: 4,
    buffer: { active: buffer },
    hasSelection: () => false,
    getSelection: () => '',
    ...overrides
  };
}

describe('extractSelectionText', () => {
  it('returns the selection text', () => {
    const terminal = makeTerminal(['a', 'b', 'c', 'd'], {
      hasSelection: () => true,
      getSelection: () => 'selected\r\ntext'
    });
    expect(extractSelectionText(terminal)).toBe('selected\ntext');
  });

  it('returns null without a selection', () => {
    expect(extractSelectionText(makeTerminal(['a', 'b', 'c', 'd']))).toBeNull();
  });

  it('returns null for an empty selection', () => {
    const terminal = makeTerminal(['a', 'b', 'c', 'd'], {
      hasSelection: () => true,
      getSelection: () => ''
    });
    expect(extractSelectionText(terminal)).toBeNull();
  });

  it('strips style escape sequences but keeps content', () => {
    const terminal = makeTerminal(['a', 'b', 'c', 'd'], {
      hasSelection: () => true,
      getSelection: () => `${ESC}[32mgreen${ESC}[0m normal\n${ESC}]0;title${BEL}text plain`
    });
    expect(extractSelectionText(terminal)).toBe('green normal\ntext plain');
  });
});

describe('extractViewportText', () => {
  it('extracts the visible viewport rows', () => {
    const terminal = makeTerminal(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(extractViewportText(terminal)).toBe('c\nd\ne\nf');
  });

  it('keeps every viewport line when rows cover the buffer', () => {
    const terminal = makeTerminal(['a', 'b', 'c', 'd', 'e', 'f'], { rows: 6 });
    terminal.buffer.active.viewportY = 0;
    expect(extractViewportText(terminal)).toBe('a\nb\nc\nd\ne\nf');
  });

  it('uses only the current screen on the alternate screen', () => {
    const terminal = makeTerminal(['a', 'b', 'c', 'd', 'e', 'f']);
    terminal.buffer.active.type = 'alternate';
    terminal.buffer.active.viewportY = 0;
    expect(extractViewportText(terminal)).toBe('a\nb\nc\nd');
  });

  it('trims trailing blank lines but keeps internal ones', () => {
    const terminal = makeTerminal(['one', '', 'two', '   '], { rows: 4 });
    expect(extractViewportText(terminal)).toBe('one\n\ntwo');
  });

  it('returns null for an empty terminal', () => {
    expect(extractViewportText(makeTerminal(['', '', '', ''], { rows: 4 }))).toBeNull();
  });

  it('truncates at a line boundary within the byte limit', () => {
    const lines = Array.from({ length: 1_000 }, () => `${'x'.repeat(100)}${'线'.repeat(100)}`);
    const terminal = makeTerminal(lines, { rows: 1_000 });
    const text = extractViewportText(terminal);
    expect(text).not.toBeNull();
    expect(new TextEncoder().encode(text!).byteLength).toBeLessThanOrEqual(chatTextMaxBytes);
    // A multi-byte character must never be split: no replacement characters.
    expect(text).not.toContain('�');
    for (const line of text!.split('\n')) {
      expect(lines).toContain(line);
    }
  });
});

describe('formatChatInsert', () => {
  it('wraps plain text in a terminal code fence', () => {
    expect(formatChatInsert('ls -la')).toBe('```terminal\nls -la\n```');
  });

  it('keeps internal newlines intact', () => {
    expect(formatChatInsert('one\ntwo')).toBe('```terminal\none\ntwo\n```');
  });

  it('lengthens the fence when the payload contains a fence', () => {
    expect(formatChatInsert('```js\ncode()\n```')).toBe('````terminal\n```js\ncode()\n```\n````');
  });
});
