export type SupportedShell = 'bash' | 'zsh' | 'fish' | 'powershell' | 'cmd' | 'unknown';

export type CommandCandidate = {
  shell: SupportedShell;
  exactText: string;
  revision: string;
  stability: 'stable' | 'incomplete' | 'unsafe';
  risk: 'normal' | 'destructive';
  confidence: 'high' | 'medium' | 'low';
  complete: boolean;
  runAllowed: boolean;
  fallbackReason?: 'data-fence' | 'ambiguous' | 'incomplete' | 'oversized';
};

export type CommandSplitResult = {
  parts: string[];
  complete: boolean;
  splitAllowed: boolean;
  fallbackReason?: 'ambiguous' | 'incomplete' | 'oversized' | 'compound';
};

export function commandRisk(value: string, shell: SupportedShell): 'normal' | 'destructive' {
  const patterns: Record<SupportedShell, RegExp[]> = {
    bash: [
      /(^|\s)sudo\b/i,
      /(^|\s)rm\s+(?:-[a-z]*[rf][a-z]*\s+)+/i,
      /(^|\s)(?:mkfs|shutdown|reboot)\b/i,
      /\bdd\s+if=/i,
      /git\s+reset\s+--hard/i,
      />\s*\/dev\//i
    ],
    zsh: [
      /(^|\s)sudo\b/i,
      /(^|\s)rm\s+(?:-[a-z]*[rf][a-z]*\s+)+/i,
      /(^|\s)(?:mkfs|shutdown|reboot)\b/i,
      /\bdd\s+if=/i,
      /git\s+reset\s+--hard/i,
      />\s*\/dev\//i
    ],
    fish: [
      /(^|\s)sudo\b/i,
      /(^|\s)rm\s+(?:-[a-z]*[rf][a-z]*\s+)+/i,
      /(^|\s)(?:mkfs|shutdown|reboot)\b/i,
      /\bdd\s+if=/i,
      /git\s+reset\s+--hard/i,
      />\s*\/dev\//i
    ],
    powershell: [
      /Remove-Item[\s\S]*-(?:Recurse|Force)/i,
      /(?:Stop-Computer|Restart-Computer|Clear-Disk|Format-Volume)\b/i,
      /Set-ExecutionPolicy\s+Unrestricted/i
    ],
    cmd: [
      /(?:^|\s)(?:del|erase)\s+[\s\S]*\/(?:s|q)/i,
      /(?:^|\s)rmdir\s+[\s\S]*\/s/i,
      /(?:^|\s)(?:format|shutdown)\b/i
    ],
    unknown: []
  };
  return patterns[shell].some((pattern) => pattern.test(value)) ? 'destructive' : 'normal';
}

const maxInputBytes = 256 * 1024;
const shellLabels = new Map<string, SupportedShell>([
  ['sh', 'bash'],
  ['shell', 'bash'],
  ['bash', 'bash'],
  ['zsh', 'zsh'],
  ['fish', 'fish'],
  ['powershell', 'powershell'],
  ['pwsh', 'powershell'],
  ['cmd', 'cmd'],
  ['bat', 'cmd'],
  ['dos', 'cmd']
]);
const dataLabels = new Set(['json', 'yaml', 'yml', 'toml', 'diff', 'text', 'txt', 'python', 'py']);

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function commandRevision(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let first = 2166136261;
  let second = 2246822519;
  for (const byte of bytes) {
    first = Math.imul(first ^ byte, 16777619);
    second = Math.imul(second ^ byte, 3266489917);
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0)
    .toString(16)
    .padStart(8, '0')}`;
}

function shellForLabel(label: string | undefined): SupportedShell | undefined {
  return label ? shellLabels.get(label.toLowerCase()) : undefined;
}

function removeFence(input: string): { body: string; label?: string; fenced: boolean } {
  const match = input.match(/^\s*```([^\s`]*)\s*\n([\s\S]*?)\n?\s*```\s*$/);
  if (!match) {
    return { body: input, fenced: false };
  }

  return { body: match[2] ?? '', label: match[1], fenced: true };
}

type OpaqueRegion = { start: number; end: number };
type CompoundKind = 'if' | 'loop' | 'case' | 'any';

/**
 * Locates bash-family heredoc bodies and PowerShell here-strings so their
 * contents are excluded from quoting, bracket-balance, and split decisions.
 * `dangling` means a started construct never closed, which makes the block
 * incomplete. Matching is conservative: a construct is only recognized in a
 * shape that shells actually accept, and unmatched input falls back to
 * whole-block handling rather than a guessed split.
 */
function findOpaqueSpans(
  value: string,
  shell: SupportedShell
): { regions: OpaqueRegion[]; dangling: boolean } {
  const regions: OpaqueRegion[] = [];
  let dangling = false;
  const scanHeredoc = shell === 'bash' || shell === 'zsh';
  const scanHereString = shell === 'powershell';
  if (!scanHeredoc && !scanHereString) return { regions, dangling };

  const lines: { start: number; text: string }[] = [];
  let cursor = 0;
  while (cursor < value.length) {
    const newline = value.indexOf('\n', cursor);
    const rawEnd = newline === -1 ? value.length : newline;
    let text = value.slice(cursor, rawEnd);
    if (text.endsWith('\r')) text = text.slice(0, -1);
    lines.push({ start: cursor, text });
    if (newline === -1) break;
    cursor = newline + 1;
  }

  let quote: 'single' | 'double' | null = null;
  let escaped = false;
  const pending: { delim: string; stripTabs: boolean }[] = [];
  let bodyStart = -1;
  let hereQuote: string | null = null;
  let hereBodyStart = -1;

  for (const line of lines) {
    if (pending.length > 0) {
      if (bodyStart < 0) bodyStart = line.start;
      const head = pending[0]!;
      const candidate = head.stripTabs ? line.text.replace(/^\t+/, '') : line.text;
      if (candidate === head.delim) {
        pending.shift();
        regions.push({ start: bodyStart, end: line.start + line.text.length });
        bodyStart = -1;
      }
      continue;
    }
    if (hereQuote) {
      if (hereBodyStart < 0) hereBodyStart = line.start;
      if (line.text.startsWith(`${hereQuote}@`)) {
        regions.push({ start: hereBodyStart, end: line.start + line.text.length });
        hereQuote = null;
        hereBodyStart = -1;
      }
      continue;
    }
    const found: { delim: string; stripTabs: boolean }[] = [];
    let j = 0;
    while (j < line.text.length) {
      const character = line.text[j]!;
      if (escaped) {
        escaped = false;
        j += 1;
        continue;
      }
      if (character === '\\' && quote !== 'single') {
        escaped = true;
        j += 1;
        continue;
      }
      if (character === "'" && quote !== 'double') {
        quote = quote === 'single' ? null : 'single';
        j += 1;
        continue;
      }
      if (character === '"' && quote !== 'single') {
        quote = quote === 'double' ? null : 'double';
        j += 1;
        continue;
      }
      if (quote) {
        j += 1;
        continue;
      }
      const previous = j > 0 ? line.text[j - 1]! : '';
      if (character === '#' && (j === 0 || /\s/.test(previous))) break;
      if (
        scanHeredoc &&
        character === '<' &&
        line.text[j + 1] === '<' &&
        line.text[j + 2] !== '<' &&
        !/[<>&|]/.test(previous)
      ) {
        let k = j + 2;
        let stripTabs = false;
        if (line.text[k] === '-') {
          stripTabs = true;
          k += 1;
        }
        let delim = '';
        const marker = line.text[k];
        if (marker === "'" || marker === '"') {
          const close = line.text.indexOf(marker, k + 1);
          if (close > k) {
            delim = line.text.slice(k + 1, close);
            k = close + 1;
          }
        } else {
          let m = k;
          while (m < line.text.length && /[A-Za-z0-9_]/.test(line.text[m]!)) m += 1;
          delim = line.text.slice(k, m);
        }
        if (delim && /[A-Za-z_]/.test(delim)) {
          found.push({ delim, stripTabs });
          j = k;
          continue;
        }
      }
      if (
        scanHereString &&
        character === '@' &&
        (line.text[j + 1] === "'" || line.text[j + 1] === '"') &&
        (j === 0 || /[\s(=,]/.test(previous)) &&
        line.text.slice(j + 2).trim() === ''
      ) {
        hereQuote = line.text[j + 1]!;
        hereBodyStart = -1;
        j = line.text.length;
        continue;
      }
      j += 1;
    }
    if (escaped) escaped = false;
    if (found.length > 0) pending.push(...found);
  }

  if (pending.length > 0 || hereQuote !== null) dangling = true;
  return { regions, dangling };
}

function compoundOpener(word: string, shell: SupportedShell): CompoundKind | null {
  if (shell === 'fish') return word === 'if' || word === 'for' || word === 'while' ? 'any' : null;
  if (word === 'if') return 'if';
  if (word === 'for' || word === 'while' || word === 'until') return 'loop';
  if (word === 'case') return 'case';
  return null;
}

function compoundCloser(word: string, shell: SupportedShell): CompoundKind | null {
  if (shell === 'fish') return word === 'end' ? 'any' : null;
  if (word === 'fi') return 'if';
  if (word === 'done') return 'loop';
  if (word === 'esac') return 'case';
  return null;
}

function lineContinues(value: string, newlineIndex: number): boolean {
  let before = newlineIndex - 1;
  while (
    before >= 0 &&
    (value[before] === ' ' || value[before] === '\t' || value[before] === '\r')
  ) {
    before -= 1;
  }
  if (before >= 0 && value[before] === '|' && !(before >= 1 && value[before - 1] === '|')) {
    return true;
  }
  let after = newlineIndex + 1;
  while (after < value.length && (value[after] === ' ' || value[after] === '\t')) after += 1;
  return after < value.length && value[after] === '|' && value[after + 1] !== '|';
}

type BlockAnalysis = {
  unbalanced: boolean;
  compound: boolean;
  ambiguous: boolean;
  splitPoints: number[];
};

function analyzeBlock(value: string, shell: SupportedShell): BlockAnalysis {
  const { regions, dangling } = findOpaqueSpans(value, shell);
  if (dangling) return { unbalanced: true, compound: false, ambiguous: false, splitPoints: [] };
  const allowsComments = shell !== 'cmd' && shell !== 'unknown';
  const allowsCompound = shell === 'bash' || shell === 'zsh' || shell === 'fish';
  let quote: 'single' | 'double' | null = null;
  let escaped = false;
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;
  const stack: CompoundKind[] = [];
  let compound = false;
  let ambiguous = false;
  let negative = false;
  let atStatementStart = true;
  let regionIndex = 0;
  const splitPoints: number[] = [];

  for (let index = 0; index < value.length; index += 1) {
    const region = regions[regionIndex];
    if (region && index === region.start) {
      index = region.end - 1;
      regionIndex += 1;
      atStatementStart = true;
      // A valid heredoc or here-string opens where quoting is closed except
      // for its own marker; opaque content cannot carry a real open quote.
      quote = null;
      escaped = false;
      continue;
    }
    const character = value[index]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '`' && shell === 'powershell') {
      escaped = true;
      continue;
    }
    if (character === '\\' && quote !== 'single') {
      escaped = true;
      continue;
    }
    if (character === "'" && quote !== 'double') {
      quote = quote === 'single' ? null : 'single';
      atStatementStart = false;
      continue;
    }
    if (character === '"' && quote !== 'single') {
      quote = quote === 'double' ? null : 'double';
      atStatementStart = false;
      continue;
    }
    if (quote) continue;
    if (
      allowsComments &&
      character === '#' &&
      (index === 0 || /[\s;(|&]/.test(value[index - 1]!))
    ) {
      const newline = value.indexOf('\n', index);
      index = (newline === -1 ? value.length : newline) - 1;
      continue;
    }
    if (character === '{') braceDepth += 1;
    if (character === '}') braceDepth -= 1;
    if (character === '[') bracketDepth += 1;
    if (character === ']') bracketDepth -= 1;
    if (character === '(') parenDepth += 1;
    if (character === ')') {
      if (parenDepth === 0 && stack[stack.length - 1] === 'case') {
        atStatementStart = false;
        continue;
      }
      parenDepth -= 1;
    }
    if (braceDepth < 0 || bracketDepth < 0 || parenDepth < 0) {
      negative = true;
      break;
    }
    const flat = braceDepth === 0 && bracketDepth === 0 && parenDepth === 0;
    if (!flat) continue;
    if (character === '(' || character === '{') atStatementStart = true;
    if (
      (character === '&' && value[index + 1] === '&') ||
      (character === '|' && value[index + 1] === '|')
    ) {
      ambiguous = true;
      index += 1;
      atStatementStart = true;
      continue;
    }
    if (character === '|') {
      atStatementStart = true;
      continue;
    }
    if (character === ';' || character === '\n') {
      const nextRegion = regions[regionIndex];
      const heredocGlue =
        character === '\n' && nextRegion !== undefined && index + 1 === nextRegion.start;
      if (
        stack.length === 0 &&
        !heredocGlue &&
        !(character === '\n' && lineContinues(value, index))
      ) {
        splitPoints.push(index);
      }
      atStatementStart = true;
      continue;
    }
    if (atStatementStart && /[A-Za-z_]/.test(character)) {
      let end = index;
      while (end < value.length && /[A-Za-z0-9_]/.test(value[end]!)) end += 1;
      const word = value.slice(index, end);
      index = end - 1;
      atStatementStart = false;
      if (allowsCompound) {
        const opener = compoundOpener(word, shell);
        if (opener) {
          stack.push(opener);
          compound = true;
          continue;
        }
        const closer = compoundCloser(word, shell);
        const top = stack[stack.length - 1];
        if (closer && top !== undefined && (top === 'any' || closer === 'any' || top === closer)) {
          stack.pop();
        }
      }
      continue;
    }
    if (!/\s/.test(character)) atStatementStart = false;
  }

  const unbalanced =
    negative ||
    dangling ||
    Boolean(quote) ||
    escaped ||
    braceDepth !== 0 ||
    bracketDepth !== 0 ||
    parenDepth !== 0 ||
    stack.length > 0;
  return { unbalanced, compound, ambiguous, splitPoints };
}

export function splitCommandBlock(value: string, shell: SupportedShell): CommandSplitResult {
  if (byteLength(value) > maxInputBytes) {
    return { parts: [], complete: false, splitAllowed: false, fallbackReason: 'oversized' };
  }
  const input = value.trim();
  if (!input) return { parts: [], complete: true, splitAllowed: true };
  const analysis = analyzeBlock(input, shell);
  if (analysis.unbalanced) {
    return { parts: [input], complete: false, splitAllowed: false, fallbackReason: 'incomplete' };
  }
  if (analysis.compound) {
    return { parts: [input], complete: true, splitAllowed: false, fallbackReason: 'compound' };
  }
  if (analysis.ambiguous) {
    return { parts: [input], complete: true, splitAllowed: false, fallbackReason: 'ambiguous' };
  }
  const parts: string[] = [];
  let start = 0;
  for (const point of analysis.splitPoints) {
    const part = input.slice(start, point).trim();
    if (part) parts.push(part);
    start = point + 1;
  }
  const trailing = input.slice(start).trim();
  if (trailing) parts.push(trailing);
  return { parts, complete: true, splitAllowed: true };
}

const isCommentOnlyPart = (part: string): boolean =>
  part.split('\n').every((line) => !line.trim() || line.trim().startsWith('#'));

/**
 * Fold comment-only split parts into the command that follows them so a
 * split presentation never surfaces comment-only cards. A trailing run of
 * comments annotates no command and is dropped.
 */
export function mergeCommentParts(parts: string[]): string[] {
  const merged: string[] = [];
  const pending: string[] = [];
  for (const part of parts) {
    if (isCommentOnlyPart(part)) {
      pending.push(part);
      continue;
    }
    merged.push([...pending, part].join('\n'));
    pending.length = 0;
  }
  return merged;
}

export function parseCommandBlock(input: string): CommandCandidate {
  if (byteLength(input) > maxInputBytes) {
    return {
      shell: 'unknown',
      exactText: '',
      revision: commandRevision(''),
      stability: 'incomplete',
      risk: 'normal',
      confidence: 'low',
      complete: false,
      runAllowed: false,
      fallbackReason: 'oversized'
    };
  }

  const { body, label, fenced } = removeFence(input);
  const normalized = body.trim();
  const lowerLabel = label?.toLowerCase();
  if (lowerLabel && dataLabels.has(lowerLabel)) {
    return {
      shell: 'unknown',
      exactText: normalized,
      revision: commandRevision(normalized),
      stability: 'unsafe',
      risk: 'normal',
      confidence: 'high',
      complete: true,
      runAllowed: false,
      fallbackReason: 'data-fence'
    };
  }

  const shell = shellForLabel(label) ?? (fenced ? 'unknown' : 'unknown');
  const complete = normalized.length > 0 && !analyzeBlock(normalized, shell).unbalanced;
  const confidence = shell !== 'unknown' ? 'high' : fenced ? 'medium' : 'low';
  return {
    shell,
    exactText: normalized,
    revision: commandRevision(normalized),
    stability: complete && shell !== 'unknown' ? 'stable' : complete ? 'unsafe' : 'incomplete',
    risk: commandRisk(normalized, shell),
    confidence,
    complete,
    runAllowed: complete && confidence === 'high',
    ...(complete ? {} : { fallbackReason: 'incomplete' as const })
  };
}
