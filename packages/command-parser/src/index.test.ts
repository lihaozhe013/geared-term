import { describe, expect, it } from 'vitest';
import { parseCommandBlock } from './index';

describe('conservative command parsing', () => {
  it('recognizes explicit shell fences', () => {
    const result = parseCommandBlock('```bash\nprintf hello\n```');
    expect(result.shell).toBe('bash');
    expect(result.runAllowed).toBe(true);
    expect(result.exactText).toBe('printf hello');
  });

  it('withholds execution for data fences', () => {
    const result = parseCommandBlock('```json\n{"ok": true}\n```');
    expect(result.runAllowed).toBe(false);
    expect(result.fallbackReason).toBe('data-fence');
  });

  it('withholds execution for incomplete syntax', () => {
    const result = parseCommandBlock('```bash\nprintf "unfinished\n```');
    expect(result.complete).toBe(false);
    expect(result.runAllowed).toBe(false);
  });
});
