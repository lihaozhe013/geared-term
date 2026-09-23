/**
 * Sandboxed preload for embedded LLM web views. It runs in an isolated world
 * beside untrusted page content, observes rendered code blocks, and reports
 * parsed command candidates to the main process. It never writes to the page
 * beyond a transient highlight, and exposes nothing to the page's main world.
 */
import { ipcRenderer } from 'electron';
import {
  LlmWebAdapterReportSchema,
  LlmWebCandidatesSchema,
  type LlmWebCandidateGroup,
  type LlmWebCommandRow,
  type LlmWebSiteId
} from '@geared-term/protocol';
import {
  commandRevision,
  mergeCommentParts,
  parseCommandBlock,
  splitCommandBlock,
  type CommandCandidate
} from '@geared-term/command-parser';

type SiteAdapter = {
  id: LlmWebSiteId;
  version: string;
  hosts: string[];
  composerSelectors: string[];
  generatingSelectors: string[];
  messageSelectors: string[];
};

const ADAPTERS: SiteAdapter[] = [
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

const scanIntervalMs = 300;
const quietMs = 1500;
const adapterReportIntervalMs = 3000;
const maxGroups = 64;
const maxTextBytes = 256 * 1024;

const blockState = new WeakMap<HTMLElement, { text: string; lang: string; changedAt: number }>();
let lastSignature = '';
let dirty = true;
let timer: ReturnType<typeof setTimeout> | undefined;

function currentAdapter(): SiteAdapter | undefined {
  const host = window.location.hostname;
  return ADAPTERS.find((adapter) => adapter.hosts.includes(host));
}

function isCodeBlockTag(element: Element): boolean {
  return element.tagName === 'PRE' || element.tagName === 'CODE';
}

function blockLanguage(element: HTMLElement): string {
  const code = isCodeBlockTag(element) ? element.querySelector('code') : null;
  const classes = [code?.getAttribute('class'), element.getAttribute('class')]
    .filter((value): value is string => typeof value === 'string')
    .join(' ');
  return classes.match(/(?:^|\s)language-([\w+-]+)(?:\s|$)/u)?.[1]?.toLowerCase() ?? '';
}

function blockText(element: HTMLElement): string {
  const code = element.querySelector('code') ?? element;
  return code.textContent ?? '';
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

function rowsForBlock(
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

function collectBlocks(adapter: SiteAdapter): HTMLElement[] {
  const scopes = adapter.messageSelectors
    .map((selector) => Array.from(document.querySelectorAll(selector)))
    .flat();
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

function probeChatSurface(adapter: SiteAdapter): boolean {
  return adapter.composerSelectors.some((selector) => Boolean(document.querySelector(selector)));
}

function probeGenerating(adapter: SiteAdapter): boolean {
  return adapter.generatingSelectors.some((selector) => Boolean(document.querySelector(selector)));
}

function buildGroups(adapter: SiteAdapter, generating: boolean): LlmWebCandidateGroup[] {
  const now = Date.now();
  const occurrences = new Map<string, number>();
  const groups: LlmWebCandidateGroup[] = [];
  for (const element of collectBlocks(adapter)) {
    let text = blockText(element);
    const lang = blockLanguage(element);
    if (new TextEncoder().encode(text).byteLength > maxTextBytes)
      text = text.slice(0, maxTextBytes);
    if (!text.trim()) continue;
    const stored = blockState.get(element);
    if (!stored || stored.text !== text || stored.lang !== lang) {
      blockState.set(element, { text, lang, changedAt: now });
    }
    const state = blockState.get(element)!;
    const revision = commandRevision(text.trim());
    const occurrence = occurrences.get(revision) ?? 0;
    occurrences.set(revision, occurrence + 1);
    const blockId = `${revision}:${occurrence}`;
    const { rows, wholeBlock } = rowsForBlock(blockId, text, lang);
    const streaming = generating || now - state.changedAt < quietMs;
    groups.push({ blockId, streaming, wholeBlock, rows });
    if (groups.length >= maxGroups) break;
  }
  return groups;
}

function emitCandidates(adapter: SiteAdapter): void {
  const generating = probeGenerating(adapter);
  const groups = buildGroups(adapter, generating);
  const signature = JSON.stringify(groups.map((group) => [group.blockId, group.streaming]));
  if (signature === lastSignature && !generating) return;
  lastSignature = signature;
  const payload = LlmWebCandidatesSchema.safeParse({ site: adapter.id, groups });
  if (payload.success) ipcRenderer.send('llm-web:candidates-report', payload.data);
}

function emitAdapterReport(adapter: SiteAdapter): void {
  const payload = LlmWebAdapterReportSchema.safeParse({
    site: adapter.id,
    adapterVersion: adapter.version,
    chatSurface: probeChatSurface(adapter),
    generating: probeGenerating(adapter),
    blockCount: collectBlocks(adapter).length
  });
  if (payload.success) ipcRenderer.send('llm-web:adapter-report', payload.data);
}

function scheduleScan(): void {
  dirty = true;
  if (timer) return;
  timer = setTimeout(() => {
    timer = undefined;
    if (!dirty) return;
    dirty = false;
    const adapter = currentAdapter();
    if (!adapter) return;
    try {
      emitCandidates(adapter);
    } catch {
      // Adapter failure degrades to "no candidates"; the page keeps working.
    }
  }, scanIntervalMs);
}

function start(): void {
  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });
  window.addEventListener('scroll', () => scheduleScan(), { passive: true });
  setInterval(() => {
    const adapter = currentAdapter();
    if (!adapter) return;
    try {
      dirty = true;
      scheduleScan();
      emitAdapterReport(adapter);
    } catch {
      // Ignore probe failures; the main process degrades the site on timeout.
    }
  }, adapterReportIntervalMs);
  ipcRenderer.on('llm-web:reveal-block', (_event, blockId: unknown) => {
    if (typeof blockId !== 'string' || !/^[0-9a-f]{16}:\d+$/u.test(blockId)) return;
    const [revision] = blockId.split(':');
    for (const element of collectBlocks(currentAdapter() ?? ADAPTERS[0]!)) {
      if (commandRevision(blockText(element).trim()) === revision) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const previous = element.style.outline;
        element.style.outline = '2px solid #6c8cff';
        setTimeout(() => {
          element.style.outline = previous;
        }, 1200);
        return;
      }
    }
  });
  scheduleScan();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
