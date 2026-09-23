/**
 * Pure DOM extraction helpers for embedded LLM chat pages. Kept free of
 * Electron imports so adapter behavior is unit-testable against saved page
 * fixtures with jsdom.
 */
import type { CommandCandidate } from '@geared-term/command-parser';
import {
  commandRevision,
  mergeCommentParts,
  parseCommandBlock,
  splitCommandBlock
} from '@geared-term/command-parser';
import type { LlmWebCandidateGroup, LlmWebCommandRow, LlmWebSiteId } from '@geared-term/protocol';

export type SiteAdapter = {
  id: LlmWebSiteId;
  version: string;
  hosts: string[];
  composerSelectors: string[];
  generatingSelectors: string[];
  messageSelectors: string[];
};

export const ADAPTERS: SiteAdapter[] = [
  {
    id: 'chatgpt',
    version: '1',
    hosts: ['chatgpt.com', 'chat.openai.com'],
    composerSelectors: ['#prompt-textarea', '[data-testid="composer"]', 'textarea[aria-label]'],
    generatingSelectors: [
      '[data-testid="stop-button"]',
      'button[aria-label*="Stop" i]',
      '.result-streaming'
    ],
    messageSelectors: ['[data-message-author-role="assistant"]']
  },
  {
    id: 'deepseek',
    version: '1',
    hosts: ['chat.deepseek.com'],
    composerSelectors: ['textarea[placeholder]', 'div[contenteditable="true"]'],
    generatingSelectors: ['button[aria-label*="Stop" i]', 'button[aria-label*="停止"]'],
    messageSelectors: ['.markdown', '[class*="message-content"]']
  }
];

export const quietMs = 1500;
export const maxGroups = 64;
export const maxTextBytes = 256 * 1024;

export function adapterForHost(host: string): SiteAdapter | undefined {
  const hostname = host.toLowerCase();
  return ADAPTERS.find((adapter) => adapter.hosts.includes(hostname));
}

export function isCodeBlockTag(element: Element): boolean {
  return element.tagName === 'PRE' || element.tagName === 'CODE';
}

export function blockLanguage(element: HTMLElement): string {
  const code = isCodeBlockTag(element) ? element.querySelector('code') : null;
  const classes = [code?.getAttribute('class'), element.getAttribute('class')]
    .filter((value): value is string => typeof value === 'string')
    .join(' ');
  return classes.match(/(?:^|\s)language-([\w+-]+)(?:\s|$)/u)?.[1]?.toLowerCase() ?? '';
}

export function blockText(element: HTMLElement): string {
  const code = element.querySelector('code') ?? element;
  return code.textContent ?? '';
}

export function collectBlocks(adapter: SiteAdapter, root: ParentNode): HTMLElement[] {
  const scopes = adapter.messageSelectors.flatMap((selector) =>
    Array.from(root.querySelectorAll(selector))
  );
  const blocks = new Set<HTMLElement>();
  for (const scope of scopes) {
    if (isCodeBlockTag(scope)) {
      blocks.add(scope as HTMLElement);
      continue;
    }
    for (const element of Array.from(scope.querySelectorAll('pre'))) blocks.add(element);
  }
  return [...blocks]
    .filter((element) => element.isConnected)
    .sort((left, right) =>
      left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
    );
}

export function probeChatSurface(adapter: SiteAdapter, root: ParentNode): boolean {
  return adapter.composerSelectors.some((selector) => Boolean(root.querySelector(selector)));
}

export function probeGenerating(adapter: SiteAdapter, root: ParentNode): boolean {
  return adapter.generatingSelectors.some((selector) => Boolean(root.querySelector(selector)));
}

function rowFrom(candidate: CommandCandidate, rowId: string): LlmWebCommandRow {
  return {
    rowId,
    shell: candidate.shell,
    exactText: candidate.exactText,
    revision: candidate.revision,
    stability: candidate.stability,
    risk: candidate.risk,
    confidence: candidate.confidence,
    runAllowed: candidate.runAllowed
  };
}

export function rowsForBlock(
  blockId: string,
  text: string,
  lang: string
): { rows: LlmWebCommandRow[]; wholeBlock: boolean } {
  const candidate = parseCommandBlock(`\`\`\`${lang}\n${text}\n\`\`\``);
  if (candidate.stability !== 'stable' || candidate.shell === 'unknown') {
    return { rows: [rowFrom(candidate, `${blockId}:0`)], wholeBlock: true };
  }
  const split = splitCommandBlock(candidate.exactText, candidate.shell);
  if (!split.splitAllowed) {
    return { rows: [rowFrom(candidate, `${blockId}:0`)], wholeBlock: true };
  }
  const merged = mergeCommentParts(split.parts);
  if (merged.length === 0) {
    return { rows: [rowFrom(candidate, `${blockId}:0`)], wholeBlock: true };
  }
  const rows = merged.map((part, index) =>
    rowFrom(parseCommandBlock(`\`\`\`${candidate.shell}\n${part}\n\`\`\``), `${blockId}:${index}`)
  );
  return { rows, wholeBlock: merged.length === 1 };
}

export function blockIdFor(text: string, occurrence: number): string {
  return `${commandRevision(text.trim())}:${occurrence}`;
}

export type BlockTimeline = WeakMap<HTMLElement, { text: string; lang: string; changedAt: number }>;

/** Resolves a blockId back to its current element using the same scan order,
 *  truncation, and per-revision occurrence counting as buildGroups. */
export function findBlockElement(
  adapter: SiteAdapter,
  root: ParentNode,
  blockId: string
): HTMLElement | undefined {
  if (!/^[0-9a-f]{16}:\d+$/u.test(blockId)) return undefined;
  const occurrences = new Map<string, number>();
  for (const element of collectBlocks(adapter, root)) {
    let text = blockText(element);
    if (new TextEncoder().encode(text).byteLength > maxTextBytes)
      text = text.slice(0, maxTextBytes);
    if (!text.trim()) continue;
    const revision = commandRevision(text.trim());
    const occurrence = occurrences.get(revision) ?? 0;
    occurrences.set(revision, occurrence + 1);
    if (`${revision}:${occurrence}` === blockId) return element;
  }
  return undefined;
}

/**
 * Produces the full candidate snapshot for a page. Callers own the timeline
 * (per-element last-change records) so repeated scans with an unchanged DOM
 * and no generation produce a stable signature.
 */
export function buildGroups(
  adapter: SiteAdapter,
  root: ParentNode,
  now: number,
  generating: boolean,
  timeline: BlockTimeline
): LlmWebCandidateGroup[] {
  const occurrences = new Map<string, number>();
  const groups: LlmWebCandidateGroup[] = [];
  for (const element of collectBlocks(adapter, root)) {
    let text = blockText(element);
    const lang = blockLanguage(element);
    if (new TextEncoder().encode(text).byteLength > maxTextBytes)
      text = text.slice(0, maxTextBytes);
    if (!text.trim()) continue;
    const stored = timeline.get(element);
    if (!stored || stored.text !== text || stored.lang !== lang) {
      timeline.set(element, { text, lang, changedAt: now });
    }
    const state = timeline.get(element)!;
    const revision = commandRevision(text.trim());
    const occurrence = occurrences.get(revision) ?? 0;
    occurrences.set(revision, occurrence + 1);
    const blockId = blockIdFor(text, occurrence);
    const { rows, wholeBlock } = rowsForBlock(blockId, text, lang);
    const streaming = generating || now - state.changedAt < quietMs;
    groups.push({ blockId, streaming, wholeBlock, rows });
    if (groups.length >= maxGroups) break;
  }
  return groups;
}
