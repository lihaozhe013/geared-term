/**
 * Pure admission control for candidate and adapter reports arriving from
 * embedded LLM web views. The manager layers sender-identity checks on top;
 * this module keeps the limits and state machine unit-testable.
 */
import type { LlmWebAdapterReport, LlmWebCandidates, LlmWebSiteId } from '@geared-term/protocol';

export type RelaySettings = {
  llmWebEnabled: boolean;
  llmWebCommandEnhancement: boolean;
  llmWebEnhancementOffSites: LlmWebSiteId[];
};

export type CandidateDecision =
  | { action: 'forward'; candidates: LlmWebCandidates }
  | { action: 'clear' }
  | { action: 'drop'; reason: 'disabled' | 'rate' | 'size' };

const candidateMinIntervalMs = 150;
const candidateByteBudget = 2 * 1024 * 1024;

export function enhancementActiveFor(settings: RelaySettings, site: LlmWebSiteId): boolean {
  return (
    settings.llmWebEnabled &&
    settings.llmWebCommandEnhancement &&
    !settings.llmWebEnhancementOffSites.includes(site)
  );
}

export class CandidateRelay {
  private lastAcceptedAt = 0;
  private clearedWhileDisabled = false;

  public reset(): void {
    this.lastAcceptedAt = 0;
    this.clearedWhileDisabled = false;
  }

  /** Takes an already schema-validated report; sender and site identity must
   *  be checked by the caller before invoking this. */
  public accept(
    candidates: LlmWebCandidates,
    settings: RelaySettings,
    site: LlmWebSiteId,
    now: number
  ): CandidateDecision {
    if (!enhancementActiveFor(settings, site)) {
      if (candidates.groups.length === 0 || this.clearedWhileDisabled)
        return { action: 'drop', reason: 'disabled' };
      this.clearedWhileDisabled = true;
      return { action: 'clear' };
    }
    this.clearedWhileDisabled = false;
    if (now - this.lastAcceptedAt < candidateMinIntervalMs) {
      return { action: 'drop', reason: 'rate' };
    }
    if (JSON.stringify(candidates).length > candidateByteBudget) {
      return { action: 'drop', reason: 'size' };
    }
    this.lastAcceptedAt = now;
    return { action: 'forward', candidates };
  }
}

export type AdapterState = {
  report: LlmWebAdapterReport;
  at: number;
};

const adapterFreshMs = 8000;

export class AdapterHealth {
  private readonly states = new Map<LlmWebSiteId, AdapterState>();

  public record(report: LlmWebAdapterReport, now: number): void {
    this.states.set(report.site, { report, at: now });
  }

  public clear(site: LlmWebSiteId): void {
    this.states.delete(site);
  }

  /** Returns the adapter report for a site, dropping it once stale: silence
   *  from an injected adapter means the structure is no longer recognized. */
  public get(site: LlmWebSiteId, now: number): AdapterState | undefined {
    const state = this.states.get(site);
    if (!state) return undefined;
    if (now - state.at > adapterFreshMs) {
      this.states.delete(site);
      return undefined;
    }
    return state;
  }
}
