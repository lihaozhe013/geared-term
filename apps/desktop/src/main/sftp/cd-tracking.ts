import { posix } from 'node:path';

export type CdTarget =
  | { kind: 'path'; path: string }
  | { kind: 'home'; suffix: string | null }
  | { kind: 'previous' }
  | { kind: 'unresolvable' };

export type CdFollowState = {
  home: string | null;
  directory: string;
  previous: string | null;
};

export type CdEffect =
  { kind: 'unchanged' } | { kind: 'move'; directory: string } | { kind: 'unsynced' };

const MAX_LINE_LENGTH = 1024;

/**
 * Reconstructs submitted shell lines from the raw input stream. Backspaces are
 * applied; any escape sequence disqualifies the pending line because the real
 * command text cannot then be reconstructed safely.
 */
export function observeInput(
  buffer: string,
  invalid: boolean,
  data: string
): { buffer: string; invalid: boolean; lines: string[] } {
  let line = buffer;
  let disqualified = invalid;
  const lines: string[] = [];
  for (const character of data) {
    const code = character.codePointAt(0) ?? 0;
    if (code === 0x1b) {
      disqualified = true;
      line = '';
    } else if (character === '\r' || character === '\n') {
      if (!disqualified && line.trim()) lines.push(line);
      line = '';
      disqualified = false;
    } else if (code === 0x7f || code === 0x08) {
      line = line.slice(0, -1);
    } else if (code >= 0x20) {
      if (line.length < MAX_LINE_LENGTH) line += character;
      else disqualified = true;
    }
  }
  return { buffer: line, invalid: disqualified, lines };
}

type Operator = ';' | '&&' | '||' | '|' | '&';

type Segment = { tokens: string[]; operator: Operator | null };

export function splitSegments(line: string): Segment[] {
  const segments: Segment[] = [];
  let tokens: string[] = [];
  let current = '';
  let quote: "'" | '"' | null = null;
  let escaped = false;
  const flushToken = (): void => {
    if (current.length > 0) {
      tokens.push(current);
      current = '';
    }
  };
  const endSegment = (operator: Operator): void => {
    flushToken();
    if (tokens.length > 0) segments.push({ tokens, operator });
    tokens = [];
  };
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index] as string;
    const next = line[index + 1];
    if (!quote && escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (!quote && character === '\\') {
      current += character;
      escaped = true;
      continue;
    }
    if (quote) {
      current += character;
      if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      current += character;
      continue;
    }
    if (character === ';') {
      endSegment(';');
      continue;
    }
    if (character === '|') {
      const doubled = next === '|';
      if (doubled) index += 1;
      endSegment(doubled ? '||' : '|');
      continue;
    }
    if (character === '&') {
      const doubled = next === '&';
      if (doubled) index += 1;
      endSegment(doubled ? '&&' : '&');
      continue;
    }
    if (/\s/u.test(character)) {
      flushToken();
      continue;
    }
    current += character;
  }
  flushToken();
  if (tokens.length > 0) segments.push({ tokens, operator: null });
  return segments;
}

function decodeToken(token: string): string | null {
  let result = '';
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < token.length; index += 1) {
    const character = token[index] as string;
    if (quote === "'") {
      if (character === "'") quote = null;
      else result += character;
      continue;
    }
    if (quote === '"') {
      if (character === '"') quote = null;
      else if (character === '$' || character === '`') return null;
      else if (character === '\\' && index + 1 < token.length) {
        index += 1;
        result += token[index];
      } else result += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === '\\') {
      index += 1;
      result += token[index] ?? '';
      continue;
    }
    if (character === '$' || character === '`') return null;
    result += character;
  }
  return quote ? null : result;
}

/** Extracts the directory target when the submitted line actually moves `cd`. */
export function parseCdCommand(line: string): CdTarget | undefined {
  const segments = splitSegments(line);
  let target: CdTarget | undefined;
  for (const [index, segment] of segments.entries()) {
    if (segment.tokens[0] !== 'cd') continue;
    const previousOperator = index > 0 ? (segments[index - 1] as Segment).operator : null;
    // `cd x | y` runs cd in a subshell pipeline member: it never moves the shell.
    if (previousOperator === '|' || segment.operator === '|' || segment.operator === '&') {
      continue;
    }
    if (segment.tokens.length === 1) {
      target = { kind: 'home', suffix: null };
      continue;
    }
    if (segment.tokens.length > 2) {
      target = { kind: 'unresolvable' };
      continue;
    }
    const argument = decodeToken(segment.tokens[1] as string);
    if (argument === null || argument === '') {
      target = { kind: 'unresolvable' };
    } else if (argument === '-') {
      target = { kind: 'previous' };
    } else if (argument === '~') {
      target = { kind: 'home', suffix: null };
    } else if (argument.startsWith('~/')) {
      target = { kind: 'home', suffix: argument.slice(2) };
    } else {
      target = { kind: 'path', path: argument };
    }
  }
  return target;
}

export function applyCdSubmission(
  state: CdFollowState,
  line: string
): { state: CdFollowState; effect: CdEffect } {
  const target = parseCdCommand(line);
  if (!target) return { state, effect: { kind: 'unchanged' } };
  if (target.kind === 'unresolvable')
    return { state: { ...state, previous: state.directory }, effect: { kind: 'unsynced' } };
  if (target.kind === 'home') {
    if (!state.home) return { state, effect: { kind: 'unsynced' } };
    const directory = target.suffix
      ? posix.normalize(posix.join(state.home, target.suffix))
      : state.home;
    return {
      state: { ...state, previous: state.directory, directory },
      effect: { kind: 'move', directory }
    };
  }
  if (target.kind === 'previous') {
    if (state.previous === null) return { state, effect: { kind: 'unsynced' } };
    return {
      state: { ...state, previous: state.directory, directory: state.previous },
      effect: { kind: 'move', directory: state.previous }
    };
  }
  const directory = target.path.startsWith('/')
    ? posix.normalize(target.path)
    : posix.normalize(posix.join(state.directory, target.path));
  return {
    state: { ...state, previous: state.directory, directory },
    effect: { kind: 'move', directory }
  };
}

/** A successful listing is authoritative: it re-anchors the tracked directory. */
export function noteListed(state: CdFollowState, directory: string): CdFollowState {
  return state.home ? { ...state, directory } : { home: directory, directory, previous: null };
}
