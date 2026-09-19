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
  fallbackReason?: 'ambiguous' | 'incomplete' | 'oversized';
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

function hasUnbalancedSyntax(value: string, shell: SupportedShell): boolean {
  let quote: 'single' | 'double' | null = null;
  let escaped = false;
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;

  for (const character of value) {
    if (escaped) {
      escaped = false;
      continue;
    }

    if (character === '\\' && quote !== 'single') {
      escaped = true;
      continue;
    }

    if (character === "'" && quote !== 'double') {
      quote = quote === 'single' ? null : 'single';
      continue;
    }

    if (character === '"' && quote !== 'single') {
      quote = quote === 'double' ? null : 'double';
      continue;
    }

    if (quote) {
      continue;
    }

    if (character === '{') braceDepth += 1;
    if (character === '}') braceDepth -= 1;
    if (character === '[') bracketDepth += 1;
    if (character === ']') bracketDepth -= 1;
    if (character === '(') parenDepth += 1;
    if (character === ')') parenDepth -= 1;
  }

  const hasUnclosedPowerShellString =
    shell === 'powershell' && /@(['"])|<</.test(value) && value.split(/\r?\n/).length > 1;
  return (
    Boolean(quote) ||
    braceDepth !== 0 ||
    bracketDepth !== 0 ||
    parenDepth !== 0 ||
    hasUnclosedPowerShellString
  );
}

export function splitCommandBlock(value: string, shell: SupportedShell): CommandSplitResult {
  if (byteLength(value) > maxInputBytes) {
    return { parts: [], complete: false, splitAllowed: false, fallbackReason: 'oversized' };
  }
  const input = value.trim();
  if (!input) return { parts: [], complete: true, splitAllowed: true };

  let start = 0;
  let quote: 'single' | 'double' | null = null;
  let escaped = false;
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;
  let ambiguous = false;
  const parts: string[] = [];
  const pushPart = (end: number): void => {
    const part = input.slice(start, end).trim();
    if (part) parts.push(part);
    start = end + 1;
  };

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (!character) continue;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (shell === 'powershell' && character === '`') {
      escaped = true;
      continue;
    }
    if (character === '\\' && quote !== 'single') {
      escaped = true;
      continue;
    }
    if (character === "'" && quote !== 'double') {
      quote = quote === 'single' ? null : 'single';
      continue;
    }
    if (character === '"' && quote !== 'single') {
      quote = quote === 'double' ? null : 'double';
      continue;
    }
    if (quote) continue;
    if (character === '{') braceDepth += 1;
    if (character === '}') braceDepth -= 1;
    if (character === '[') bracketDepth += 1;
    if (character === ']') bracketDepth -= 1;
    if (character === '(') parenDepth += 1;
    if (character === ')') parenDepth -= 1;
    if (braceDepth < 0 || bracketDepth < 0 || parenDepth < 0) {
      return { parts: [input], complete: false, splitAllowed: false, fallbackReason: 'incomplete' };
    }
    if (braceDepth !== 0 || bracketDepth !== 0 || parenDepth !== 0) continue;
    if (
      (character === '&' && input[index + 1] === '&') ||
      (character === '|' && input[index + 1] === '|')
    ) {
      ambiguous = true;
      index += 1;
      continue;
    }
    if (character === ';' || character === '\n') pushPart(index);
  }

  if (quote || escaped || braceDepth !== 0 || bracketDepth !== 0 || parenDepth !== 0) {
    return { parts: [input], complete: false, splitAllowed: false, fallbackReason: 'incomplete' };
  }
  const trailing = input.slice(start).trim();
  if (trailing) parts.push(trailing);
  if (ambiguous) {
    return { parts: [input], complete: true, splitAllowed: false, fallbackReason: 'ambiguous' };
  }
  return { parts, complete: true, splitAllowed: true };
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
  const complete = normalized.length > 0 && !hasUnbalancedSyntax(normalized, shell);
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
