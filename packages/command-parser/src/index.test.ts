import { describe, expect, it } from 'vitest';
import { commandRevision, parseCommandBlock, splitCommandBlock } from './index';

describe('conservative command parsing', () => {
  it('recognizes explicit shell fences', () => {
    const result = parseCommandBlock('```bash\nprintf hello\n```');
    expect(result.shell).toBe('bash');
    expect(result.runAllowed).toBe(true);
    expect(result.exactText).toBe('printf hello');
    expect(result.stability).toBe('stable');
    expect(result.revision).toBe(commandRevision(result.exactText));
  });

  it('withholds execution for data fences', () => {
    const result = parseCommandBlock('```json\n{"ok": true}\n```');
    expect(result.runAllowed).toBe(false);
    expect(result.fallbackReason).toBe('data-fence');
    expect(result.stability).toBe('unsafe');
  });

  it('withholds execution for incomplete syntax', () => {
    const result = parseCommandBlock('```bash\nprintf "unfinished\n```');
    expect(result.complete).toBe(false);
    expect(result.runAllowed).toBe(false);
  });

  it('splits only top-level statements and preserves quoted separators', () => {
    expect(splitCommandBlock('echo "a;b"; printf two\nls | sort', 'bash')).toEqual({
      parts: ['echo "a;b"', 'printf two', 'ls | sort'],
      complete: true,
      splitAllowed: true
    });
  });

  it('falls back to one block when conditional semantics would be lost', () => {
    expect(splitCommandBlock('build && deploy', 'bash')).toEqual({
      parts: ['build && deploy'],
      complete: true,
      splitAllowed: false,
      fallbackReason: 'ambiguous'
    });
  });

  it('does not split incomplete blocks', () => {
    expect(splitCommandBlock('Write-Output "unfinished', 'powershell')).toEqual({
      parts: ['Write-Output "unfinished'],
      complete: false,
      splitAllowed: false,
      fallbackReason: 'incomplete'
    });
  });
});
