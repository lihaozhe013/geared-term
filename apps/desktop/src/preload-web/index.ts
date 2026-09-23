/**
 * Sandboxed preload for embedded LLM web views. It runs in an isolated world
 * beside untrusted page content, observes rendered code blocks, and reports
 * parsed command candidates to the main process. It never writes to the page
 * beyond a transient highlight, and exposes nothing to the page's main world.
 */
import { ipcRenderer } from 'electron';
import { LlmWebAdapterReportSchema, LlmWebCandidatesSchema } from '@geared-term/protocol';
import {
  adapterForHost,
  buildGroups,
  collectBlocks,
  findBlockElement,
  probeChatSurface,
  probeGenerating,
  type BlockTimeline
} from './extract';

const scanIntervalMs = 300;
const adapterReportIntervalMs = 3000;

const timeline: BlockTimeline = new WeakMap();
let lastSignature = '';
let dirty = true;
let timer: ReturnType<typeof setTimeout> | undefined;

function emitCandidates(): void {
  const adapter = adapterForHost(window.location.hostname);
  if (!adapter) return;
  const now = Date.now();
  const generating = probeGenerating(adapter, document);
  const groups = buildGroups(adapter, document, now, generating, timeline);
  const signature = JSON.stringify(groups.map((group) => [group.blockId, group.streaming]));
  if (signature === lastSignature && !generating) return;
  lastSignature = signature;
  const payload = LlmWebCandidatesSchema.safeParse({ site: adapter.id, groups });
  if (payload.success) ipcRenderer.send('llm-web:candidates-report', payload.data);
}

function emitAdapterReport(): void {
  const adapter = adapterForHost(window.location.hostname);
  if (!adapter) return;
  const payload = LlmWebAdapterReportSchema.safeParse({
    site: adapter.id,
    adapterVersion: adapter.version,
    chatSurface: probeChatSurface(adapter, document),
    generating: probeGenerating(adapter, document),
    blockCount: collectBlocks(adapter, document).length
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
    try {
      emitCandidates();
    } catch {
      // Adapter failure degrades to "no candidates"; the page keeps working.
    }
  }, scanIntervalMs);
}

function revealBlock(blockId: string): void {
  const adapter = adapterForHost(window.location.hostname);
  if (!adapter) return;
  const element = findBlockElement(adapter, document, blockId);
  if (!element) return;
  element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const previous = element.style.outline;
  element.style.outline = '2px solid #6c8cff';
  setTimeout(() => {
    element.style.outline = previous;
  }, 1200);
}

function start(): void {
  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });
  window.addEventListener('scroll', scheduleScan, { passive: true });
  setInterval(() => {
    try {
      scheduleScan();
      emitAdapterReport();
    } catch {
      // Ignore probe failures; the main process degrades the site on timeout.
    }
  }, adapterReportIntervalMs);
  ipcRenderer.on('llm-web:reveal-block', (_event, blockId: unknown) => {
    if (typeof blockId === 'string') revealBlock(blockId);
  });
  scheduleScan();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
