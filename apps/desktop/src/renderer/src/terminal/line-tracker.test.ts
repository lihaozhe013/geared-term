import { describe, expect, it } from 'vitest';
import { createLineTracker, extractCdFromScreenLine, observeKeystrokes } from './line-tracker';

describe('observeKeystrokes', () => {
  it('reconstructs lines split across chunks and applies backspaces', () => {
    let tracker = createLineTracker();
    tracker = observeKeystrokes(tracker, 'cd /tm').tracker;
    const second = observeKeystrokes(tracker, 'p\u007fx\r');
    expect(second.lines).toEqual([{ text: 'cd /tmx', edited: false }]);
  });

  it('marks lines edited by tab completion or escape sequences', () => {
    const tracker = createLineTracker();
    const result = observeKeystrokes(tracker, 'cd proj\u001b[Cect\r');
    // The buffer diverges from the real command once editing sequences arrive;
    // the caller recovers the final text from the screen echo when `edited`.
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]?.edited).toBe(true);
    expect(result.lines[0]?.text.startsWith('cd proj')).toBe(true);
  });

  it('drops the line on Ctrl+C without flagging the next one', () => {
    const tracker = createLineTracker();
    const cleared = observeKeystrokes(tracker, 'cd \u0003');
    expect(cleared.lines).toEqual([]);
    const next = observeKeystrokes(cleared.tracker, 'ls\r');
    expect(next.lines).toEqual([{ text: 'ls', edited: false }]);
  });

  it('recovers after an edited line and never emits empty lines', () => {
    let tracker = createLineTracker();
    tracker = observeKeystrokes(tracker, 'cd /tmp\u001b[A').tracker;
    tracker = observeKeystrokes(tracker, '\r').tracker;
    expect(tracker.edited).toBe(false);
    const result = observeKeystrokes(tracker, 'ls -la\r\r');
    expect(result.lines).toEqual([{ text: 'ls -la', edited: false }]);
  });
});

describe('extractCdFromScreenLine', () => {
  it('extracts the command after the prompt', () => {
    expect(extractCdFromScreenLine('zero@box:~/proj$ cd Composer')).toBe('cd Composer');
    expect(extractCdFromScreenLine('root@box:~# cd "my dir"')).toBe('cd "my dir"');
  });

  it('ignores cd occurrences inside words', () => {
    expect(extractCdFromScreenLine('zero@box:~/code$ git status')).toBeNull();
    expect(extractCdFromScreenLine('xecd /tmp')).toBeNull();
  });

  it('returns null for a parameterless cd (the buffer fallback parses it)', () => {
    expect(extractCdFromScreenLine('user@box:~$ cd')).toBeNull();
  });
});
