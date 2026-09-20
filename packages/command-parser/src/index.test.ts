import { describe, expect, it } from 'vitest';
import {
  commandRevision,
  commandRisk,
  mergeCommentParts,
  parseCommandBlock,
  splitCommandBlock
} from './index';

describe('conservative command parsing', () => {
  it('recognizes explicit shell fences', () => {
    const result = parseCommandBlock('```bash\nprintf hello\n```');
    expect(result.shell).toBe('bash');
    expect(result.runAllowed).toBe(true);
    expect(result.exactText).toBe('printf hello');
    expect(result.stability).toBe('stable');
    expect(result.revision).toBe(commandRevision(result.exactText));
    expect(result.risk).toBe('normal');
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

  it('folds comment-only parts into the command that follows them', () => {
    const split = splitCommandBlock(
      '# install\nyay -S neovim-git\n# or\nparu -S neovim-git',
      'bash'
    );
    expect(split.parts).toEqual(['# install', 'yay -S neovim-git', '# or', 'paru -S neovim-git']);
    expect(mergeCommentParts(split.parts)).toEqual([
      '# install\nyay -S neovim-git',
      '# or\nparu -S neovim-git'
    ]);
  });

  it('drops trailing comment-only parts and keeps non-comment blocks intact', () => {
    expect(mergeCommentParts(['# note', 'ls', '# done'])).toEqual(['# note\nls']);
    expect(mergeCommentParts(['echo one'])).toEqual(['echo one']);
    expect(mergeCommentParts([])).toEqual([]);
  });

  it('marks destructive commands for Insert-only handling', () => {
    expect(commandRisk('rm -rf ./build', 'bash')).toBe('destructive');
    expect(parseCommandBlock('```powershell\nRemove-Item -Recurse -Force .\\build\n```').risk).toBe(
      'destructive'
    );
  });
});
