import {
  DEFAULT_TERMINAL_LIGATURE_SEQUENCES,
  normalizeLigatureSequences
} from '@geared-term/protocol';

export type LigatureJoinerHandler = (text: string) => [number, number][];

const REGEXP_SPECIAL_CHARACTERS = /[.*+?^${}()|[\]\\]/g;

function escapeSequence(sequence: string): string {
  return sequence.replace(REGEXP_SPECIAL_CHARACTERS, '\\$&');
}

/**
 * Builds an xterm.js character joiner handler for the given ligature
 * sequences. Ranges are string indexes into the provided row segment, end
 * exclusive, as expected by `Terminal.registerCharacterJoiner`.
 */
export function buildLigatureJoiner(sequences: readonly string[]): LigatureJoinerHandler {
  const normalized = normalizeLigatureSequences(sequences);
  if (normalized.length === 0) {
    return () => [];
  }
  const matcher = new RegExp(normalized.map(escapeSequence).join('|'), 'g');
  return (text: string): [number, number][] => {
    if (!text) return [];
    const ranges: [number, number][] = [];
    matcher.lastIndex = 0;
    for (let match = matcher.exec(text); match; match = matcher.exec(text)) {
      ranges.push([match.index, match.index + match[0].length]);
    }
    return ranges;
  };
}

export function defaultLigatureSequences(): string[] {
  return normalizeLigatureSequences(DEFAULT_TERMINAL_LIGATURE_SEQUENCES);
}

const sequenceCache = new Map<string, Promise<string[]>>();

/**
 * Resolves the ligature sequences the terminal font actually supports, as
 * parsed by the main process from the font files. Returns an empty array when
 * the font carries no ligatures; rejects only when inspection failed, which
 * callers treat as a reason to fall back to the default table.
 */
export function loadLigatureSequences(fontFamily: string): Promise<string[]> {
  const key = fontFamily.trim().toLowerCase();
  const cached = sequenceCache.get(key);
  if (cached) return cached;
  const pending = window.geared.getTerminalLigatureSequences(fontFamily);
  const tracked = pending.then((sequences) => {
    if (sequences.length === 0) sequenceCache.delete(key);
    return sequences;
  });
  // Failed lookups are retried on the next request instead of being cached.
  pending.catch(() => sequenceCache.delete(key));
  sequenceCache.set(key, tracked);
  return tracked;
}
