import { describe, expect, it } from 'vitest';
import type { LlmWebAdapterReport, LlmWebCandidates } from '@geared-term/protocol';
import { AdapterHealth, CandidateRelay, enhancementActiveFor } from './relay';

const settings = {
  llmWebEnabled: true,
  llmWebCommandEnhancement: true,
  llmWebEnhancementOffSites: [] as ('chatgpt' | 'deepseek')[]
};

function report(groups: number): LlmWebCandidates {
  return {
    site: 'chatgpt',
    groups: Array.from({ length: groups }, (_unused, index) => ({
      blockId: `${'a'.repeat(16)}:${index}`,
      streaming: false,
      wholeBlock: false,
      rows: [
        {
          rowId: `${'a'.repeat(16)}:${index}:0`,
          shell: 'bash' as const,
          exactText: `echo ${index}`,
          revision: 'b'.repeat(16),
          stability: 'stable' as const,
          risk: 'normal' as const,
          confidence: 'high' as const,
          runAllowed: true
        }
      ]
    }))
  };
}

describe('enhancementActiveFor', () => {
  it('honors global and per-site switches', () => {
    expect(enhancementActiveFor(settings, 'chatgpt')).toBe(true);
    expect(enhancementActiveFor({ ...settings, llmWebEnabled: false }, 'chatgpt')).toBe(false);
    expect(enhancementActiveFor({ ...settings, llmWebCommandEnhancement: false }, 'chatgpt')).toBe(
      false
    );
    expect(
      enhancementActiveFor({ ...settings, llmWebEnhancementOffSites: ['chatgpt'] }, 'chatgpt')
    ).toBe(false);
    expect(
      enhancementActiveFor({ ...settings, llmWebEnhancementOffSites: ['chatgpt'] }, 'deepseek')
    ).toBe(true);
  });
});

describe('CandidateRelay', () => {
  it('forwards enabled reports and rate-limits bursts', () => {
    const relay = new CandidateRelay();
    const forwarded = relay.accept(report(1), settings, 'chatgpt', 1000);
    expect(forwarded.action).toBe('forward');
    const throttled = relay.accept(report(2), settings, 'chatgpt', 1050);
    expect(throttled).toEqual({ action: 'drop', reason: 'rate' });
    const after = relay.accept(report(2), settings, 'chatgpt', 1200);
    expect(after.action).toBe('forward');
  });

  it('clears the trusted UI once when enhancement is disabled with visible rows', () => {
    const relay = new CandidateRelay();
    relay.accept(report(2), settings, 'chatgpt', 1000);
    const disabled = { ...settings, llmWebCommandEnhancement: false };
    expect(relay.accept(report(2), disabled, 'chatgpt', 2000)).toEqual({ action: 'clear' });
    expect(relay.accept(report(2), disabled, 'chatgpt', 3000)).toEqual({
      action: 'drop',
      reason: 'disabled'
    });
    expect(relay.accept(report(0), disabled, 'chatgpt', 4000)).toEqual({
      action: 'drop',
      reason: 'disabled'
    });
  });

  it('drops oversized reports', () => {
    const relay = new CandidateRelay();
    const huge: LlmWebCandidates = {
      site: 'chatgpt',
      groups: Array.from({ length: 24 }, (_unused, index) => ({
        blockId: `${'a'.repeat(16)}:${index}`,
        streaming: false,
        wholeBlock: false,
        rows: Array.from({ length: 16 }, (_inner, row) => ({
          rowId: `${'a'.repeat(16)}:${index}:${row}`,
          shell: 'bash' as const,
          exactText: `x`.repeat(32_000),
          revision: 'b'.repeat(16),
          stability: 'stable' as const,
          risk: 'normal' as const,
          confidence: 'high' as const,
          runAllowed: true
        }))
      }))
    };
    expect(relay.accept(huge, settings, 'chatgpt', 1000)).toEqual({
      action: 'drop',
      reason: 'size'
    });
  });

  it('reset re-arms rate limiting after a site switch', () => {
    const relay = new CandidateRelay();
    expect(relay.accept(report(1), settings, 'chatgpt', 1000).action).toBe('forward');
    relay.reset();
    expect(relay.accept(report(1), settings, 'chatgpt', 1010).action).toBe('forward');
  });
});

describe('AdapterHealth', () => {
  const adapter = (site: 'chatgpt' | 'deepseek', chatSurface: boolean): LlmWebAdapterReport => ({
    site,
    adapterVersion: '1',
    chatSurface,
    generating: false,
    blockCount: 0
  });

  it('serves fresh reports and expires stale ones', () => {
    const health = new AdapterHealth();
    health.record(adapter('chatgpt', true), 1000);
    expect(health.get('chatgpt', 5000)?.report.chatSurface).toBe(true);
    expect(health.get('chatgpt', 9001)).toBeUndefined();
    expect(health.get('chatgpt', 9500)).toBeUndefined();
  });

  it('separates sites and clears on demand', () => {
    const health = new AdapterHealth();
    health.record(adapter('chatgpt', true), 1000);
    health.record(adapter('deepseek', false), 1100);
    expect(health.get('deepseek', 1200)?.report.chatSurface).toBe(false);
    health.clear('chatgpt');
    expect(health.get('chatgpt', 1300)).toBeUndefined();
  });
});
