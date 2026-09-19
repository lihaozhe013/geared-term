import { describe, expect, it } from 'vitest';
import {
  extractSnapshot,
  formatSnapshotForPrompt,
  snapshotMaxBytes,
  type SnapshotBuffer,
  type SnapshotTerminal
} from './snapshot';

function makeTerminal(
  lines: string[],
  overrides: Partial<SnapshotTerminal> = {}
): SnapshotTerminal {
  const buffer: SnapshotBuffer = {
    type: 'normal',
    viewportY: Math.max(0, lines.length - 4),
    baseY: Math.max(0, lines.length - 4),
    height: lines.length,
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

describe('terminal snapshot extraction', () => {
  it('prefers a non-empty selection over the viewport', () => {
    const terminal = makeTerminal(['a', 'b', 'c', 'd', 'e', 'f'], {
      hasSelection: () => true,
      getSelection: () => 'selected\r\ntext'
    });
    const snapshot = extractSnapshot(terminal, { precedingLines: 0 });
    expect(snapshot?.source).toBe('selection');
    expect(snapshot?.text).toBe('selected\ntext');
    expect(snapshot?.lineStart).toBeNull();
  });

  it('extracts the viewport with bounds', () => {
    const terminal = makeTerminal(['a', 'b', 'c', 'd', 'e', 'f']);
    const snapshot = extractSnapshot(terminal, { precedingLines: 0 });
    expect(snapshot?.text).toBe('c\nd\ne\nf');
    expect(snapshot?.source).toBe('viewport');
    expect(snapshot?.lineStart).toBe(2);
    expect(snapshot?.lineEnd).toBe(5);
    expect(snapshot?.truncated).toBe(false);
  });

  it('includes a bounded number of preceding lines and clamps at the top', () => {
    const terminal = makeTerminal(['a', 'b', 'c', 'd', 'e', 'f']);
    const snapshot = extractSnapshot(terminal, { precedingLines: 10 });
    expect(snapshot?.text).toBe('a\nb\nc\nd\ne\nf');
    expect(snapshot?.source).toBe('viewport+preceding');
    expect(snapshot?.lineStart).toBe(0);
  });

  it('ignores scrollback on the alternate screen', () => {
    const terminal = makeTerminal(['a', 'b', 'c', 'd', 'e', 'f']);
    (terminal.buffer.active as SnapshotBuffer).type = 'alternate';
    (terminal.buffer.active as SnapshotBuffer).viewportY = 0;
    const snapshot = extractSnapshot(terminal, { precedingLines: 50 });
    expect(snapshot?.source).toBe('viewport');
    expect(snapshot?.alternateScreen).toBe(true);
    expect(snapshot?.text).toBe('a\nb\nc\nd');
  });

  it('strips style escape sequences but keeps content', () => {
    const terminal = makeTerminal(['[32mgreen[0m normal', 'plain']);
    (terminal.buffer.active as SnapshotBuffer).viewportY = 0;
    const snapshot = extractSnapshot(terminal, { precedingLines: 0 });
    expect(snapshot?.text).toBe('green normal\nplain');
  });

  it('trims trailing blank lines but keeps internal ones', () => {
    const terminal = makeTerminal(['one', '', 'two', '   ']);
    (terminal.buffer.active as SnapshotBuffer).viewportY = 0;
    const snapshot = extractSnapshot(terminal, { precedingLines: 0 });
    expect(snapshot?.text).toBe('one\n\ntwo');
  });

  it('truncates at a line boundary within the byte limit', () => {
    const terminal = makeTerminal(
      Array.from({ length: 100 }, (_, index) => `line-${String(index).padStart(3, '0')}`),
      { rows: 100 }
    );
    (terminal.buffer.active as SnapshotBuffer).viewportY = 0;
    const snapshot = extractSnapshot(terminal, { precedingLines: 0, maxBytes: 100 });
    expect(snapshot?.truncated).toBe(true);
    expect(snapshot?.text.split('\n').length).toBeLessThan(100);
    expect(snapshot?.text.length).toBeLessThanOrEqual(100);
  });

  it('enforces the default 256 KiB limit', () => {
    const terminal = makeTerminal(['x'.repeat(200_000), 'y'.repeat(200_000)], { rows: 2 });
    (terminal.buffer.active as SnapshotBuffer).viewportY = 0;
    const snapshot = extractSnapshot(terminal, { precedingLines: 0 });
    expect(snapshot?.truncated).toBe(true);
    expect(snapshot?.text.length).toBeLessThanOrEqual(snapshotMaxBytes);
  });

  it('returns null for an empty terminal', () => {
    const terminal = makeTerminal(['', '', '', '']);
    (terminal.buffer.active as SnapshotBuffer).viewportY = 0;
    expect(extractSnapshot(terminal, { precedingLines: 0 })).toBeNull();
  });

  it('keeps every viewport line when rows cover the buffer', () => {
    const terminal = makeTerminal(['a', 'b', 'c', 'd', 'e', 'f'], { rows: 6 });
    (terminal.buffer.active as SnapshotBuffer).viewportY = 0;
    const snapshot = extractSnapshot(terminal, { precedingLines: 0 });
    expect(snapshot?.text).toBe('a\nb\nc\nd\ne\nf');
    expect(snapshot?.lineEnd).toBe(5);
  });

  it('formats the prompt block as a delimited untrusted observation', () => {
    const terminal = makeTerminal(['a', 'b', 'c', 'd', 'e', 'f'], {
      hasSelection: () => true,
      getSelection: () => 'ls -la'
    });
    const snapshot = extractSnapshot(terminal, { precedingLines: 0 });
    const formatted = formatSnapshotForPrompt(snapshot!);
    expect(formatted).toContain('--- BEGIN UNTRUSTED TERMINAL SNAPSHOT ---');
    expect(formatted).toContain('source: selection');
    expect(formatted).toContain('ls -la');
    expect(formatted).toContain('--- END UNTRUSTED TERMINAL SNAPSHOT ---');
  });
});
