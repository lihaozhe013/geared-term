import { describe, expect, it } from 'vitest';
import { pickSupportedSequences } from './ligatures';
import { EXTENDED_TERMINAL_LIGATURE_SEQUENCES } from '@geared-term/protocol';

describe('pickSupportedSequences', () => {
  it('keeps only sequences reported by the font', () => {
    const supported = pickSupportedSequences(
      (sequence) => sequence === '=>' || sequence === '->>' || sequence === '->>>',
      ['<', '=>', '9', '=>', '->>', '->>>']
    );
    expect(supported).toEqual(['->>>', '->>', '=>']);
  });

  it('survives failing probes and normalizes the corpus', () => {
    const supported = pickSupportedSequences(
      (sequence) => {
        if (sequence === '/\\') throw new Error('bad probe');
        return sequence.length > 2;
      },
      ['***', '/\\', '=>>', 'x']
    );
    expect(supported).toEqual(['***', '=>>']);
  });

  it('extends the default corpus with font-specific sequences', () => {
    const supported = pickSupportedSequences(() => true, EXTENDED_TERMINAL_LIGATURE_SEQUENCES);
    expect(supported).toContain('=<');
    expect(supported).toContain('|->');
  });
});
