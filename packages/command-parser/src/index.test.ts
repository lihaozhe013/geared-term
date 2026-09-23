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

describe('multi-line structures stay intact (acceptance A-E)', () => {
  it('A: splits annotated package commands into independent statements', () => {
    const block = [
      '# Update package index',
      'sudo apt update',
      '',
      '# Install ffmpeg',
      'sudo apt install -y ffmpeg',
      '',
      'ffmpeg -version'
    ].join('\n');
    const split = splitCommandBlock(block, 'bash');
    expect(split.splitAllowed).toBe(true);
    expect(mergeCommentParts(split.parts)).toEqual([
      '# Update package index\nsudo apt update',
      '# Install ffmpeg\nsudo apt install -y ffmpeg',
      'ffmpeg -version'
    ]);
    expect(mergeCommentParts(split.parts).map((part) => commandRisk(part, 'bash'))).toEqual([
      'destructive',
      'destructive',
      'normal'
    ]);
  });

  it('B: keeps a backslash-continued docker invocation as one statement', () => {
    const block = 'docker run \\\n  --rm \\\n  -v "$PWD:/work" \\\n  ubuntu:latest';
    const split = splitCommandBlock(block, 'bash');
    expect(split.splitAllowed).toBe(true);
    expect(split.parts).toEqual([block]);
  });

  it('C: keeps a heredoc from the command through the terminator as one statement', () => {
    const block = [
      'cat > /etc/foo.conf <<EOF',
      'alpha=1',
      "beta=don't quote me",
      'EOF',
      'systemctl restart foo'
    ].join('\n');
    const split = splitCommandBlock(block, 'bash');
    expect(split.splitAllowed).toBe(true);
    expect(split.parts).toEqual([
      "cat > /etc/foo.conf <<EOF\nalpha=1\nbeta=don't quote me\nEOF",
      'systemctl restart foo'
    ]);
    const candidate = parseCommandBlock('```bash\n' + block + '\n```');
    expect(candidate.complete).toBe(true);
    expect(candidate.stability).toBe('stable');
  });

  it('C: an unterminated heredoc is incomplete and cannot run', () => {
    const result = parseCommandBlock('```bash\ncat <<EOF\nnever closed\n```');
    expect(result.complete).toBe(false);
    expect(result.runAllowed).toBe(false);
    expect(result.stability).toBe('incomplete');
  });

  it('C: <<- strips leading tabs when matching the terminator', () => {
    const block = 'cat <<-HEREDOC\n\tone\n\tHEREDOC';
    const split = splitCommandBlock(block, 'bash');
    expect(split.parts).toEqual([block]);
    expect(split.complete).toBe(true);
  });

  it('D: keeps PowerShell multi-line pipelines and here-strings unsplit', () => {
    const pipeline = [
      'Get-Process |',
      '  Where-Object CPU -gt 100 |',
      '  Sort-Object CPU -Descending'
    ].join('\n');
    expect(splitCommandBlock(pipeline, 'powershell').parts).toEqual([pipeline]);
    const hereString = '$json = @\'\n{"a": "it\'s fine"}\n\'@\nWrite-Output $json';
    const split = splitCommandBlock(hereString, 'powershell');
    expect(split.splitAllowed).toBe(true);
    expect(split.parts).toEqual(['$json = @\'\n{"a": "it\'s fine"}\n\'@', 'Write-Output $json']);
  });

  it('D: PowerShell backtick continuation keeps one statement', () => {
    const block = 'New-Item -ItemType Directory `\n  -Path ./out';
    expect(splitCommandBlock(block, 'powershell').parts).toEqual([block]);
  });

  it('E: content still growing on a continuation line is incomplete', () => {
    const result = parseCommandBlock('```bash\ndocker run \\\n```');
    expect(result.complete).toBe(false);
    expect(result.runAllowed).toBe(false);
  });
});

describe('compound statements degrade to whole blocks', () => {
  it('does not split if/then/fi bodies and keeps the block runnable', () => {
    const block = 'if ! command -v node >/dev/null; then\n  echo missing\nfi\nsudo apt-get update';
    const split = splitCommandBlock(block, 'bash');
    expect(split.splitAllowed).toBe(false);
    expect(split.fallbackReason).toBe('compound');
    expect(split.parts).toEqual([block]);
    expect(split.complete).toBe(true);
    const candidate = parseCommandBlock('```bash\n' + block + '\n```');
    expect(candidate.stability).toBe('stable');
    expect(candidate.runAllowed).toBe(true);
  });

  it('treats an unterminated compound as incomplete', () => {
    const result = parseCommandBlock('```bash\nif [ -f x ]; then\ncd /tmp\n```');
    expect(result.complete).toBe(false);
    expect(result.runAllowed).toBe(false);
  });

  it('keeps for loops and case statements intact', () => {
    const loop = 'for i in 1 2 3; do\n  echo $i\ndone';
    expect(splitCommandBlock(loop, 'bash').parts).toEqual([loop]);
    const caseBlock = 'case $x in\n  a) ls;;\n  *) pwd;;\nesac';
    const split = splitCommandBlock(caseBlock, 'bash');
    expect(split.splitAllowed).toBe(false);
    expect(split.fallbackReason).toBe('compound');
    expect(split.complete).toBe(true);
  });

  it('keeps function definitions and brace groups intact', () => {
    const fn = 'deploy() {\n  git pull\n  systemctl restart app\n}\ndeploy';
    const split = splitCommandBlock(fn, 'bash');
    expect(split.splitAllowed).toBe(true);
    expect(split.parts).toEqual(['deploy() {\n  git pull\n  systemctl restart app\n}', 'deploy']);
  });

  it('ignores compound keywords inside words, quotes, and comments', () => {
    expect(splitCommandBlock('# done with setup\necho done', 'bash').parts).toEqual([
      '# done with setup',
      'echo done'
    ]);
    expect(splitCommandBlock('echo "if"\nsleep 1', 'bash').parts).toEqual(['echo "if"', 'sleep 1']);
    expect(splitCommandBlock('bash -c "for x in a; do echo $x; done"\nls', 'bash').parts).toEqual([
      'bash -c "for x in a; do echo $x; done"',
      'ls'
    ]);
  });

  it('does not mistake here-strings or shifts for heredocs', () => {
    const here = 'grep -q x <<<"y\nvalue" 2>/dev/null\nls';
    const hereSplit = splitCommandBlock(here, 'bash');
    expect(hereSplit.parts).toEqual(['grep -q x <<<"y\nvalue" 2>/dev/null', 'ls']);
    const arithmetic = 'echo $((1 << 2))\nls';
    expect(splitCommandBlock(arithmetic, 'bash').parts).toEqual(['echo $((1 << 2))', 'ls']);
  });

  it('handles apostrophes inside comments without marking the block incomplete', () => {
    const result = parseCommandBlock("```bash\n# don't forget\ncd /tmp\n```");
    expect(result.complete).toBe(true);
    expect(result.stability).toBe('stable');
  });

  it('fish blocks degrade on unclosed structures', () => {
    const block = 'if test -f x\n  echo hi\nend\nls';
    const split = splitCommandBlock(block, 'fish');
    expect(split.splitAllowed).toBe(false);
    expect(split.fallbackReason).toBe('compound');
  });
});
