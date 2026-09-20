import { load } from 'font-ligatures';
import {
  DEFAULT_TERMINAL_LIGATURE_SEQUENCES,
  EXTENDED_TERMINAL_LIGATURE_SEQUENCES,
  normalizeLigatureSequences,
  type TerminalLigatureRequest
} from '@geared-term/protocol';

type FontLigatures = Awaited<ReturnType<typeof load>>;

/**
 * Sequences that only appear in some coding fonts; they are probed against the
 * real font tables but excluded from the blind fallback table.
 */
const PROBE_SEQUENCES: readonly string[] = [
  ...DEFAULT_TERMINAL_LIGATURE_SEQUENCES,
  ...EXTENDED_TERMINAL_LIGATURE_SEQUENCES
];

const FAILURE_RETRY_MS = 30_000;

type CacheEntry = {
  sequences: string[];
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();

export function pickSupportedSequences(
  hasLigature: (sequence: string) => boolean,
  corpus: readonly string[]
): string[] {
  const supported: string[] = [];
  for (const sequence of normalizeLigatureSequences(corpus)) {
    try {
      if (hasLigature(sequence)) supported.push(sequence);
    } catch {
      // an unreadable candidate must not abort the remaining probes
    }
  }
  return supported;
}

function probesWithLigature(font: FontLigatures, sequence: string): boolean {
  if (hasSubstitution(font, sequence)) return true;
  // Some contextual rules only fire when lookahead characters exist inside
  // the probed string, so retry once with a trailing space.
  return hasSubstitution(font, `${sequence} `);
}

/**
 * `outputGlyphs` keeps the input length (ligature glyphs come with a
 * placeholder), so substitutions are detected via the reported ranges.
 */
function hasSubstitution(font: FontLigatures, text: string): boolean {
  return font.findLigatures(text).contextRanges.length > 0;
}

function primaryFontFamily(fontFamily: string): string {
  const [primary] = fontFamily.split(',');
  return (primary ?? fontFamily).replace(/["']/g, '').trim();
}

export async function parseTerminalLigatureSequences(fontFamily: string): Promise<string[]> {
  const family = primaryFontFamily(fontFamily);
  if (!family) return [];
  const font = await load(family);
  return pickSupportedSequences((sequence) => probesWithLigature(font, sequence), PROBE_SEQUENCES);
}

export async function resolveTerminalLigatureSequences(
  request: TerminalLigatureRequest
): Promise<string[]> {
  const key = request.fontFamily.trim().toLowerCase();
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && (cached.sequences.length > 0 || cached.expiresAt > now)) {
    return cached.sequences;
  }
  const sequences = await parseTerminalLigatureSequences(request.fontFamily).catch(
    () => [] as string[]
  );
  cache.set(key, {
    sequences,
    expiresAt: sequences.length > 0 ? Number.POSITIVE_INFINITY : now + FAILURE_RETRY_MS
  });
  return sequences;
}

export function clearTerminalLigatureCache(): void {
  cache.clear();
}
