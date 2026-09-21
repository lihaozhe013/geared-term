import { Fragment, useEffect, useRef, useState } from 'react';
import {
  mergeCommentParts,
  parseCommandBlock,
  splitCommandBlock,
  type CommandCandidate,
  type SupportedShell
} from '@geared-term/command-parser';
import type {
  AiActivityLabel,
  AiConnectionRecord,
  AiResponsesModelDefaults,
  AiResponsesReasoningEffort,
  AiStreamEvent,
  EnvironmentRecord,
  SettingsRecord
} from '@geared-term/protocol';
import {
  ArrowDown,
  ArrowUp,
  Bot,
  ChevronDown,
  Copy,
  CircleCheck,
  CircleX,
  Globe,
  History,
  List,
  Loader2,
  Plus,
  Settings2,
  SquareTerminal,
  SquarePlus,
  X
} from 'lucide-react';
import { MarkdownView } from './assistant/MarkdownView';
import { buildHistoryEntry } from './assistant/history-save';
import { translate } from './i18n';

type Message = {
  role: 'user' | 'assistant';
  content: string;
  model?: string;
  usage?: { input?: number; output?: number; reasoning?: number };
  reasoning?: string;
  sources?: SourceReference[];
  continuation?: { connectionId: string; model: string; items: Array<Record<string, unknown>> };
  durationMs?: number;
};

type SourceReference = { url: string; title?: string };

type ConsentRequest = {
  endpoint: string;
  identity: string;
  categories: string[];
};

type ActivityStep = {
  id: string;
  label: AiActivityLabel;
  detail?: string;
  state: 'running' | 'done' | 'failed';
  startedAt: number;
  endedAt?: number;
};

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total}s`;
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, '0')}s`;
}

function TypingDots(): React.JSX.Element {
  return (
    <span className="typing-dots" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

type AssistantPanelProps = {
  targetSessionId?: string;
  sessionLabel?: string;
  language?: SettingsRecord['language'];
  environmentTargetKey?: string;
  splitCommandPresentation?: boolean;
  allowRiskyRun?: boolean;
  onToggleSplitCommand?: () => void;
  pendingHistoryId?: string | null;
  onPendingHistoryConsumed?: () => void;
  pendingChatText?: string | null;
  onPendingChatTextConsumed?: () => void;
  hidden?: boolean;
};

type ActivityLike = {
  label: AiActivityLabel;
  state: 'running' | 'done' | 'failed';
  detail?: string;
};

function activityStepText(language: SettingsRecord['language'], step: ActivityLike): string {
  const done = step.state !== 'running';
  switch (step.label) {
    case 'connecting':
      return done ? translate(language, 'actDone') : translate(language, 'actConnecting');
    case 'working':
      return done ? translate(language, 'actDone') : translate(language, 'actWorking');
    case 'writing':
      return done ? translate(language, 'actDone') : translate(language, 'actWriting');
    case 'searching-web':
      return done ? translate(language, 'actSearchedWeb') : translate(language, 'actSearchingWeb');
    case 'searching-query':
      return done
        ? translate(language, 'actSearchedQuery').replace('{query}', step.detail ?? '')
        : translate(language, 'actSearchingQuery').replace('{query}', step.detail ?? '');
    case 'reading-source':
      return done
        ? translate(language, 'actReadSource').replace('{source}', step.detail ?? '')
        : translate(language, 'actReadingSource').replace('{source}', step.detail ?? '');
    case 'reading-sources':
      return done
        ? translate(language, 'actReadSources')
        : translate(language, 'actReadingSources');
    case 'queued':
      return translate(language, 'actQueued');
    default:
      return translate(language, 'actWorking');
  }
}

function activitySummaryText(
  language: SettingsRecord['language'],
  summary: { searches: number; reads: number }
): string {
  const parts: string[] = [];
  if (summary.searches > 0) {
    parts.push(
      translate(language, 'activitySearches').replace('{count}', String(summary.searches))
    );
  }
  if (summary.reads > 0) {
    parts.push(translate(language, 'activityPagesRead').replace('{count}', String(summary.reads)));
  }
  const base = translate(language, 'activitySummary');
  return parts.length > 0 ? `${base} · ${parts.join(' · ')}` : base;
}

function estimateTokens(text: string): number {
  let tokens = 0;
  for (const char of text) {
    tokens += (char.codePointAt(0) ?? 0) <= 0x7f ? 0.25 : 1;
  }
  return Math.ceil(tokens);
}

const fencePattern = /```[^\n]*\n[\s\S]*?```/g;

type ContentSegment = { type: 'text' | 'fence'; value: string };

function contentSegments(content: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  let cursor = 0;
  for (const match of content.matchAll(fencePattern)) {
    const index = match.index ?? 0;
    if (index > cursor) segments.push({ type: 'text', value: content.slice(cursor, index) });
    segments.push({ type: 'fence', value: match[0] });
    cursor = index + match[0].length;
  }
  if (cursor < content.length) segments.push({ type: 'text', value: content.slice(cursor) });
  return segments;
}

function commandCandidates(content: string, splitPresentation: boolean): CommandCandidate[] {
  const result: CommandCandidate[] = [];
  for (const match of content.matchAll(fencePattern)) {
    const block = match[0];
    if (!block) continue;
    const candidate = parseCommandBlock(block);
    if (splitPresentation && candidate.stability === 'stable' && candidate.shell !== 'unknown') {
      const split = splitCommandBlock(candidate.exactText, candidate.shell as SupportedShell);
      if (split.splitAllowed && split.parts.length > 1) {
        const merged = mergeCommentParts(split.parts);
        if (!merged.length) continue;
        result.push(
          ...merged.map((part) => parseCommandBlock(`\`\`\`${candidate.shell}\n${part}\n\`\`\``))
        );
        continue;
      }
    }
    result.push(candidate);
  }
  return result;
}

function CommandCard({
  candidate,
  targetSessionId,
  allowRiskyRun,
  disabled,
  onError
}: {
  candidate: CommandCandidate;
  targetSessionId?: string;
  allowRiskyRun: boolean;
  disabled: boolean;
  onError: (message: string) => void;
}): React.JSX.Element {
  const insertAllowed = Boolean(targetSessionId) && candidate.stability === 'stable';
  const runAllowed =
    Boolean(targetSessionId) &&
    candidate.runAllowed &&
    candidate.stability === 'stable' &&
    (candidate.risk === 'normal' || allowRiskyRun);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(candidate.exactText);
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : 'Unable to copy command');
    }
  };

  const execute = async (action: 'insert' | 'run'): Promise<void> => {
    if (!targetSessionId) {
      onError('Select a visible terminal session before using this action.');
      return;
    }
    try {
      await window.geared.executeCommandAction({
        sessionId: targetSessionId,
        action,
        shell: candidate.shell,
        payload: candidate.exactText,
        revision: candidate.revision
      });
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : 'Unable to submit command');
    }
  };

  return (
    <div className="command-card">
      <div className="command-card-header">
        <small>
          {candidate.shell} · {candidate.confidence} confidence
        </small>
        <small>
          {candidate.stability} · {candidate.risk}
        </small>
      </div>
      <pre>{candidate.exactText}</pre>
      <div className="command-card-actions">
        <button
          type="button"
          className="toolbar-button"
          onClick={() => void copy()}
          disabled={disabled}
        >
          <Copy size={12} aria-hidden="true" /> Copy
        </button>
        <button
          type="button"
          className="toolbar-button"
          onClick={() => void execute('insert')}
          disabled={disabled || !insertAllowed}
          title={
            insertAllowed ? 'Insert without submitting' : 'A stable visible terminal is required'
          }
        >
          <SquareTerminal size={12} aria-hidden="true" /> Insert
        </button>
        <button
          type="button"
          className="toolbar-button"
          onClick={() => void execute('run')}
          disabled={disabled || !runAllowed}
          title={
            runAllowed
              ? 'Insert and submit once'
              : 'Run is disabled until a stable shell block is available'
          }
        >
          <SquarePlus size={12} aria-hidden="true" /> Run
        </button>
      </div>
    </div>
  );
}

function MetaChip({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <span className="meta-chip">{children}</span>;
}

export function AssistantPanel({
  targetSessionId,
  sessionLabel,
  language = 'en-US',
  environmentTargetKey,
  splitCommandPresentation = false,
  allowRiskyRun = false,
  onToggleSplitCommand,
  pendingHistoryId,
  onPendingHistoryConsumed,
  pendingChatText,
  onPendingChatTextConsumed,
  hidden = false
}: AssistantPanelProps): React.JSX.Element {
  const [connections, setConnections] = useState<AiConnectionRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [model, setModel] = useState('');
  const [responseOptions, setResponseOptions] = useState<AiResponsesModelDefaults | null>(null);
  const [reasoningMenuOpen, setReasoningMenuOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [composer, setComposer] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [reasoning, setReasoning] = useState('');
  const [reasoningLive, setReasoningLive] = useState(false);
  const [sources, setSources] = useState<SourceReference[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attachedEnvironment, setAttachedEnvironment] = useState<EnvironmentRecord | null>(null);
  const [conversationId, setConversationId] = useState<string>(() => crypto.randomUUID());
  const [activities, setActivities] = useState<ActivityStep[]>([]);
  const [streamStartedAt, setStreamStartedAt] = useState<number | null>(null);
  const [showTimeline, setShowTimeline] = useState(true);
  const [consentRequest, setConsentRequest] = useState<ConsentRequest | null>(null);
  const [, setTick] = useState(0);
  const streamRef = useRef<{ cancel: () => void } | null>(null);
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;
  // Persistence reads these through refs because stream callbacks close over
  // the render in which the request started and would otherwise observe stale
  // reasoning/source state from the previous turn.
  const reasoningRef = useRef('');
  reasoningRef.current = reasoning;
  const sourcesRef = useRef<SourceReference[]>([]);
  sourcesRef.current = sources;
  const reasoningBoxRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesBoxRef = useRef<HTMLDivElement | null>(null);
  const scrollPinnedRef = useRef(true);
  const [scrolledUp, setScrolledUp] = useState(false);
  const pendingRequestRef = useRef<{
    streamId: string;
    connectionId: string;
    model: string;
    targetKey?: string;
    messages: Array<{
      role: 'user' | 'assistant';
      content: string;
      continuation?: { connectionId: string; model: string; items: Array<Record<string, unknown>> };
    }>;
    prompt: string;
    responseOptions?: AiResponsesModelDefaults;
  } | null>(null);

  useEffect(() => {
    void window.geared
      .listAiConnections()
      .then((saved) => {
        setConnections(saved);
        const first = saved[0];
        if (first) {
          setSelectedId(first.id);
          setModel(first.defaultModel);
        }
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : 'Unable to load AI connections')
      );
    return () => streamRef.current?.cancel();
  }, []);

  useEffect(() => {
    const connection = connections.find((item) => item.id === selectedId);
    const profile = connection?.models.find((item) => item.model === model);
    setResponseOptions(
      profile?.responses ?? {
        reasoningEffort: 'default',
        verbosity: 'default',
        reasoningSummary: true,
        webSearch: false
      }
    );
    setReasoningMenuOpen(false);
  }, [connections, model, selectedId]);

  useEffect(() => {
    if (!environmentTargetKey) {
      setAttachedEnvironment(null);
      return;
    }
    void window.geared
      .listEnvironments()
      .then((saved) =>
        setAttachedEnvironment(
          saved.find((record) => record.targetKey === environmentTargetKey && record.attachToAi) ??
            null
        )
      )
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : 'Unable to load AI environment context')
      );
  }, [environmentTargetKey]);

  useEffect(() => {
    return window.geared.onEnvironmentUpdated((record) => {
      if (record.targetKey !== environmentTargetKey) return;
      setAttachedEnvironment(record.attachToAi ? record : null);
    });
  }, [environmentTargetKey]);

  useEffect(() => {
    if (!pendingHistoryId) return;
    if (streaming) {
      setError('History cannot be loaded while a request is active.');
      onPendingHistoryConsumed?.();
      return;
    }
    void window.geared
      .loadAiHistory({ id: pendingHistoryId })
      .then((record) => {
        scrollPinnedRef.current = true;
        setScrolledUp(false);
        setMessages(
          record.messages.map((message) => ({
            role: message.role,
            content: message.content,
            reasoning: message.reasoning,
            usage: message.usage
              ? {
                  input: message.usage.inputTokens,
                  output: message.usage.outputTokens,
                  reasoning: message.usage.reasoningTokens
                }
              : undefined,
            sources: message.sources,
            continuation: message.continuation
          }))
        );
        setConversationId(record.id);
        const lastAssistant = [...record.messages]
          .reverse()
          .find((message) => message.role === 'assistant');
        setReasoning(lastAssistant?.reasoning ?? '');
        setReasoningLive(false);
        setSources(lastAssistant?.sources ?? []);
        setError(null);
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : 'Unable to load conversation')
      )
      .finally(() => onPendingHistoryConsumed?.());
  }, [pendingHistoryId, streaming, onPendingHistoryConsumed]);

  // Terminal "add to chat" appends fenced terminal text after whatever the
  // user already typed; safe during streaming because the composer stays
  // editable, only the send button is gated.
  useEffect(() => {
    if (!pendingChatText) return;
    setComposer((current) => (current ? `${current}\n\n${pendingChatText}` : pendingChatText));
    onPendingChatTextConsumed?.();
    const frame = requestAnimationFrame(() => {
      const element = composerRef.current;
      if (!element) return;
      element.focus();
      element.selectionStart = element.selectionEnd = element.value.length;
    });
    return () => cancelAnimationFrame(frame);
  }, [pendingChatText, onPendingChatTextConsumed]);

  useEffect(() => {
    const box = reasoningBoxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [reasoning]);

  useEffect(() => {
    const element = composerRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 132)}px`;
    element.style.overflowY = element.scrollHeight > 132 ? 'auto' : 'hidden';
  }, [composer]);

  useEffect(() => {
    if (!streaming) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [streaming]);

  // Follow new output only while pinned to the bottom; scrolling up locks the
  // view until the user returns to the bottom or uses the jump button.
  useEffect(() => {
    if (!scrollPinnedRef.current) return;
    const box = messagesBoxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [messages, reasoning, activities]);

  const handleMessagesScroll = (): void => {
    const box = messagesBoxRef.current;
    if (!box) return;
    const distance = box.scrollHeight - box.scrollTop - box.clientHeight;
    const pinned = distance < 48;
    scrollPinnedRef.current = pinned;
    setScrolledUp(!pinned && messagesRef.current.length > 0);
  };

  const jumpToLatest = (): void => {
    const box = messagesBoxRef.current;
    if (!box) return;
    scrollPinnedRef.current = true;
    setScrolledUp(false);
    box.scrollTop = box.scrollHeight;
  };

  const selectedConnection = connections.find((connection) => connection.id === selectedId);
  const modelOptions = selectedConnection?.models ?? [];

  const reasoningEfforts: AiResponsesReasoningEffort[] = [
    'default',
    'none',
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
    'max'
  ];

  // Mirrors the reference activity model: exactly one running step at a time;
  // a new running step auto-closes the previous one.
  const upsertActivity = (
    id: string,
    label: AiActivityLabel,
    detail?: string,
    state: 'running' | 'done' = 'running'
  ): void => {
    const now = Date.now();
    setActivities((current) => {
      const closed = current.map((step) =>
        step.state === 'running' && step.id !== id
          ? { ...step, state: 'done' as const, endedAt: now }
          : step
      );
      const index = closed.findIndex((step) => step.id === id);
      if (index >= 0) {
        const existing = closed[index] as ActivityStep;
        return closed.map((step, position) =>
          position === index
            ? {
                ...step,
                label,
                detail,
                state,
                startedAt: now,
                endedAt: state === 'done' ? now : undefined
              }
            : step
        );
      }
      return [
        ...closed,
        {
          id,
          label,
          detail,
          state,
          startedAt: now,
          ...(state === 'done' ? { endedAt: now } : {})
        }
      ];
    });
  };

  const closeRunningActivities = (state: 'done' | 'failed'): void => {
    const now = Date.now();
    setActivities((current) =>
      current.map((step) => (step.state === 'running' ? { ...step, state, endedAt: now } : step))
    );
  };

  const persistConversation = (conversation: Message[]): void => {
    if (!conversation.some((message) => message.content.trim().length > 0)) return;
    window.geared
      .saveAiHistory(
        buildHistoryEntry({
          id: conversationId,
          ...(model ? { model } : {}),
          reasoning: reasoningRef.current,
          sources: sourcesRef.current,
          messages: conversation
        })
      )
      .catch((reason: unknown) => {
        console.error('[assistant] failed to save chat history', reason);
      });
  };

  const receiveEvent = (event: AiStreamEvent): void => {
    if (event.kind === 'delta') {
      setMessages((current) => {
        const last = current.at(-1);
        if (!last || last.role !== 'assistant')
          return [...current, { role: 'assistant', content: event.text, model }];
        return [...current.slice(0, -1), { ...last, content: last.content + event.text }];
      });
    } else if (event.kind === 'reasoning') {
      setReasoning((current) => current + event.text);
      setReasoningLive(true);
      setMessages((current) => {
        const last = current.at(-1);
        if (!last || last.role !== 'assistant') return current;
        return [
          ...current.slice(0, -1),
          { ...last, reasoning: `${last.reasoning ?? ''}${event.text}` }
        ];
      });
    } else if (event.kind === 'activity') {
      upsertActivity(event.id, event.label, event.detail, event.state);
    } else if (event.kind === 'usage') {
      setMessages((current) => {
        const last = current.at(-1);
        if (!last || last.role !== 'assistant') return current;
        return [
          ...current.slice(0, -1),
          {
            ...last,
            usage: {
              input: event.inputTokens,
              output: event.outputTokens,
              reasoning: event.reasoningTokens
            }
          }
        ];
      });
    } else if (event.kind === 'continuation') {
      // The stream event carries the `kind` discriminator, which is not part of
      // AiContinuationMetadata and would fail strict schema validation when the
      // stored value is echoed back in the next request or saved to history.
      const { kind: _kind, ...continuation } = event;
      setMessages((current) => {
        const last = current.at(-1);
        if (!last || last.role !== 'assistant') return current;
        return [...current.slice(0, -1), { ...last, continuation }];
      });
    } else if (event.kind === 'source') {
      setSources((current) =>
        current.some((source) => source.url === event.url)
          ? current
          : [...current, { url: event.url, title: event.title }]
      );
      setMessages((current) => {
        const last = current.at(-1);
        if (!last || last.role !== 'assistant') return current;
        if (last.sources?.some((source) => source.url === event.url)) return current;
        return [
          ...current.slice(0, -1),
          { ...last, sources: [...(last.sources ?? []), { url: event.url, title: event.title }] }
        ];
      });
      upsertActivity(`read:${event.url}`, 'reading-source', event.title ?? event.url);
    } else if (event.kind === 'consent-required') {
      setConsentRequest({
        endpoint: event.endpoint,
        identity: event.identity,
        categories: event.categories
      });
      setStreaming(false);
      setReasoningLive(false);
      closeRunningActivities('done');
      streamRef.current = null;
    } else if (event.kind === 'error') {
      setError(event.message);
      setStreaming(false);
      setReasoningLive(false);
      closeRunningActivities('failed');
      persistConversation(messagesRef.current);
    } else if (event.kind === 'complete') {
      setStreaming(false);
      setReasoningLive(false);
      closeRunningActivities('done');
      const startedAt = streamStartedAt;
      setMessages((current) => {
        const last = current.at(-1);
        if (!last || last.role !== 'assistant' || startedAt === null) return current;
        return [...current.slice(0, -1), { ...last, durationMs: Date.now() - startedAt }];
      });
      setShowTimeline(false);
      streamRef.current = null;
      persistConversation(messagesRef.current);
    }
  };

  const startNewChat = (): void => {
    streamRef.current?.cancel();
    streamRef.current = null;
    scrollPinnedRef.current = true;
    setScrolledUp(false);
    setMessages([]);
    setComposer('');
    setReasoning('');
    setReasoningLive(false);
    setSources([]);
    setActivities([]);
    setStreamStartedAt(null);
    setStreaming(false);
    setConsentRequest(null);
    pendingRequestRef.current = null;
    const profile = selectedConnection?.models.find((item) => item.model === model);
    setResponseOptions(
      profile?.responses ?? {
        reasoningEffort: 'default',
        verbosity: 'default',
        reasoningSummary: true,
        webSearch: false
      }
    );
    setConversationId(crypto.randomUUID());
    setError(null);
  };

  const openHistory = (): void => {
    if (streaming) {
      setError('History cannot be loaded while a request is active.');
      return;
    }
    void window.geared.openHistoryWindow();
  };

  const handleCommandError = (message: string): void => setError(message);

  const acceptConsent = async (): Promise<void> => {
    const consent = consentRequest;
    const pending = pendingRequestRef.current;
    if (!consent || !pending) return;
    try {
      const saved = await window.geared.acceptAiEndpoint({
        connectionId: pending.connectionId,
        identity: consent.identity
      });
      setConnections(saved);
      const retry = { ...pending, streamId: crypto.randomUUID() };
      pendingRequestRef.current = retry;
      setConsentRequest(null);
      startStream(retry);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save endpoint consent');
    }
  };

  const startStream = (request: NonNullable<typeof pendingRequestRef.current>): void => {
    setReasoning('');
    setSources([]);
    setActivities([]);
    setStreamStartedAt(Date.now());
    setShowTimeline(true);
    setError(null);
    setStreaming(true);
    try {
      streamRef.current = window.geared.streamAi(request, (event) => {
        receiveEvent(event as AiStreamEvent);
      });
    } catch (reason) {
      // A rejected request never reaches the main process, so no error event
      // would arrive to end the stream; fail visibly instead of spinning.
      streamRef.current = null;
      setStreaming(false);
      setReasoningLive(false);
      closeRunningActivities('failed');
      setError(reason instanceof Error ? reason.message : 'Unable to start AI stream');
    }
  };

  const send = (): void => {
    const text = composer.trim();
    if (!text || !selectedId || !model || streaming) return;
    const historyMessages = messages
      .filter((message) => message.content.trim().length > 0)
      .map((message) => ({
        role: message.role,
        content: message.content,
        ...(message.continuation ? { continuation: message.continuation } : {})
      }))
      .slice(-99);
    const request = {
      streamId: crypto.randomUUID(),
      connectionId: selectedId,
      model,
      ...(environmentTargetKey ? { targetKey: environmentTargetKey } : {}),
      messages: historyMessages,
      prompt: text,
      ...(selectedConnection?.protocol === 'responses' && responseOptions
        ? { responseOptions }
        : {})
    };
    pendingRequestRef.current = request;
    scrollPinnedRef.current = true;
    setScrolledUp(false);
    const nextMessages: Message[] = [
      ...messages,
      { role: 'user', content: text },
      { role: 'assistant', content: '', model }
    ];
    setMessages(nextMessages);
    setComposer('');
    setConsentRequest(null);
    persistConversation(nextMessages);
    startStream(request);
  };

  const stop = (): void => {
    streamRef.current?.cancel();
    streamRef.current = null;
    setStreaming(false);
    setReasoningLive(false);
    closeRunningActivities('done');
    setShowTimeline(false);
    persistConversation(messagesRef.current);
  };

  // After a search closes and before the first answer token, the model is
  // digesting results; mirror the reference copy by showing "Reading sources…".
  const runningStep = [...activities].reverse().find((step) => step.state === 'running');
  const headlineStep =
    runningStep &&
    (runningStep.label === 'searching-web' || runningStep.label === 'searching-query') &&
    sources.length > 0
      ? { ...runningStep, label: 'reading-sources' as const, detail: undefined }
      : runningStep;
  const activitySummary = ((): { searches: number; reads: number } => {
    const done = activities.filter((step) => step.state !== 'running');
    return {
      searches: done.filter(
        (step) => step.label === 'searching-web' || step.label === 'searching-query'
      ).length,
      reads: done.filter(
        (step) => step.label === 'reading-source' || step.label === 'reading-sources'
      ).length
    };
  })();

  return (
    <aside className="assistant-panel" aria-label="AI assistant" hidden={hidden}>
      <div className="assistant-header">
        <Bot size={16} aria-hidden="true" className="assistant-header-icon" />
        <div className="assistant-header-titles">
          <span className="assistant-header-title">AI Assistant</span>
          {sessionLabel ? <span className="assistant-header-subtitle">{sessionLabel}</span> : null}
        </div>
        <div className="assistant-header-actions">
          <button
            type="button"
            className="icon-button"
            aria-label="New chat"
            title="New chat"
            onClick={startNewChat}
          >
            <Plus size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Chat history"
            title="Chat history"
            onClick={openHistory}
          >
            <History size={14} aria-hidden="true" />
          </button>
          {onToggleSplitCommand ? (
            <button
              type="button"
              className={`icon-button ${splitCommandPresentation ? 'active' : ''}`}
              aria-label="Split command blocks"
              aria-pressed={splitCommandPresentation}
              title="Split command blocks"
              onClick={onToggleSplitCommand}
            >
              <List size={14} aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            className="icon-button"
            aria-label="AI settings"
            title="AI settings"
            onClick={() => void window.geared.openSettings('ai-connections')}
          >
            <Settings2 size={14} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="assistant-model-row">
        <button
          type="button"
          className="assistant-picker-button"
          onClick={() => setModelMenuOpen((open) => !open)}
          title="Switch model for this chat"
        >
          <span className="assistant-picker-label">{model || 'No model selected'}</span>
          <ChevronDown size={13} aria-hidden="true" />
        </button>
        {modelMenuOpen ? (
          <>
            <div className="assistant-menu-backdrop" onClick={() => setModelMenuOpen(false)} />
            <div className="assistant-picker-menu" role="menu">
              {modelOptions.length === 0 ? (
                <p className="settings-hint">No models on this connection yet.</p>
              ) : null}
              {connections.length > 1 ? (
                <>
                  <p className="assistant-menu-heading">Connections</p>
                  {connections.map((connection) => (
                    <button
                      type="button"
                      key={connection.id}
                      role="menuitem"
                      className={`assistant-menu-item ${connection.id === selectedId ? 'active' : ''}`}
                      onClick={() => {
                        setSelectedId(connection.id);
                        setModel(connection.defaultModel);
                        setModelMenuOpen(false);
                      }}
                    >
                      {connection.name}
                    </button>
                  ))}
                  <div className="assistant-menu-separator" />
                </>
              ) : null}
              {connections.length > 1 ? <p className="assistant-menu-heading">Models</p> : null}
              {modelOptions.map((option) => (
                <button
                  type="button"
                  key={option.id}
                  role="menuitem"
                  className={`assistant-menu-item ${option.model === model ? 'active' : ''}`}
                  onClick={() => {
                    setModel(option.model);
                    setModelMenuOpen(false);
                  }}
                >
                  {option.label ? `${option.label} · ${option.model}` : option.model}
                </button>
              ))}
              <div className="assistant-menu-separator" />
              <button
                type="button"
                className="assistant-menu-item"
                onClick={() => {
                  setModelMenuOpen(false);
                  void window.geared.openSettings('ai-connections');
                }}
              >
                Manage connections…
              </button>
            </div>
          </>
        ) : null}
        {selectedConnection?.protocol === 'responses' && responseOptions ? (
          <div className="assistant-reasoning-picker">
            <button
              type="button"
              className="assistant-picker-button"
              onClick={() => setReasoningMenuOpen((open) => !open)}
              title="Reasoning effort for this chat"
            >
              <span className="assistant-picker-label">{responseOptions.reasoningEffort}</span>
              <ChevronDown size={13} aria-hidden="true" />
            </button>
            {reasoningMenuOpen ? (
              <>
                <div
                  className="assistant-menu-backdrop"
                  onClick={() => setReasoningMenuOpen(false)}
                />
                <div className="assistant-picker-menu" role="menu">
                  {reasoningEfforts.map((effort) => (
                    <button
                      type="button"
                      key={effort}
                      role="menuitem"
                      className={`assistant-menu-item ${
                        responseOptions.reasoningEffort === effort ? 'active' : ''
                      }`}
                      onClick={() => {
                        setResponseOptions((current) =>
                          current ? { ...current, reasoningEffort: effort } : current
                        );
                        setReasoningMenuOpen(false);
                      }}
                    >
                      {effort}
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      <div
        className="assistant-messages"
        aria-live="polite"
        ref={messagesBoxRef}
        onScroll={handleMessagesScroll}
      >
        {attachedEnvironment ? (
          <div className="assistant-context-chip">
            Environment context attached · {attachedEnvironment.facts.os ?? 'unknown OS'} ·{' '}
            {attachedEnvironment.facts.hostname ?? 'unknown host'}
          </div>
        ) : null}
        {messages.length === 0 ? (
          <div className="assistant-empty">
            <Bot size={24} aria-hidden="true" />
            <p>Ask about this terminal</p>
          </div>
        ) : null}
        {messages.map((message, index) =>
          message.role === 'user' ? (
            <div className="assistant-message user" key={`user-${index}`}>
              <div className="assistant-message-label">
                <ArrowUp size={12} aria-hidden="true" /> You
              </div>
              <p>{message.content}</p>
              <div className="assistant-meta-row">
                <MetaChip>~{estimateTokens(message.content)} estimated tokens</MetaChip>
              </div>
            </div>
          ) : (
            <div className="assistant-message assistant" key={`assistant-${index}`}>
              <div className="assistant-message-label">
                <Bot size={12} aria-hidden="true" /> AI Assistant
                {message.model ? (
                  <span className="assistant-message-model">{message.model}</span>
                ) : null}
              </div>
              {index === messages.length - 1 && activities.length > 0 ? (
                <div className="assistant-activity">
                  {showTimeline ? (
                    <div className="assistant-activity-timeline">
                      {activities.map((step) => (
                        <div className="assistant-activity-row" key={step.id}>
                          <span className={`activity-step-icon ${step.state}`}>
                            {step.state === 'running' ? (
                              <Loader2 size={12} aria-hidden="true" />
                            ) : step.state === 'failed' ? (
                              <CircleX size={12} aria-hidden="true" />
                            ) : (
                              <CircleCheck size={12} aria-hidden="true" />
                            )}
                          </span>
                          <span className="assistant-activity-label">
                            {activityStepText(
                              language,
                              step.state === 'running' && headlineStep ? headlineStep : step
                            )}
                            {step.state === 'running' ? <TypingDots /> : null}
                          </span>
                          <span className="assistant-activity-elapsed">
                            {formatElapsed((step.endedAt ?? Date.now()) - step.startedAt)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {!streaming ? (
                    <button
                      type="button"
                      className="chip activity-summary-chip"
                      onClick={() => setShowTimeline((value) => !value)}
                    >
                      <Globe size={12} aria-hidden="true" />
                      {activitySummaryText(language, activitySummary)}
                    </button>
                  ) : null}
                </div>
              ) : null}
              {reasoning ? (
                reasoningLive && index === messages.length - 1 ? (
                  <div className="assistant-reasoning-live" ref={reasoningBoxRef}>
                    <p>{reasoning}</p>
                  </div>
                ) : (
                  <details className="assistant-reasoning">
                    <summary>Reasoning summary</summary>
                    <p>{reasoning}</p>
                  </details>
                )
              ) : null}
              {message.content ? (
                contentSegments(message.content).map((segment, segmentIndex) => {
                  if (segment.type === 'text') {
                    return segment.value.trim() ? (
                      <MarkdownView key={`segment-${segmentIndex}`} source={segment.value} />
                    ) : null;
                  }
                  const candidates = commandCandidates(
                    segment.value,
                    splitCommandPresentation
                  ).filter((candidate) => candidate.exactText);
                  if (!candidates.length) {
                    return <MarkdownView key={`segment-${segmentIndex}`} source={segment.value} />;
                  }
                  return (
                    <Fragment key={`segment-${segmentIndex}`}>
                      {candidates.map((candidate, candidateIndex) => (
                        <CommandCard
                          key={`${candidate.revision}-${candidateIndex}`}
                          candidate={candidate}
                          targetSessionId={targetSessionId}
                          allowRiskyRun={allowRiskyRun}
                          disabled={streaming}
                          onError={handleCommandError}
                        />
                      ))}
                    </Fragment>
                  );
                })
              ) : streaming && !activities.some((step) => step.state === 'running') ? (
                <TypingDots />
              ) : null}
              {sources.length > 0 && index === messages.length - 1 ? (
                <div className="assistant-sources">
                  <span className="assistant-sources-label">Sources</span>
                  <div className="chip-row">
                    {sources.map((source) => (
                      <a
                        className="chip"
                        key={source.url}
                        href={source.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        title={source.title ?? source.url}
                      >
                        {source.title ?? source.url}
                      </a>
                    ))}
                  </div>
                </div>
              ) : null}
              {message.content ? (
                <div className="assistant-meta-row">
                  {message.model ? <MetaChip>{message.model}</MetaChip> : null}
                  {message.usage?.input !== undefined ? (
                    <MetaChip>in {message.usage.input}</MetaChip>
                  ) : null}
                  {message.usage?.output !== undefined ? (
                    <MetaChip>out {message.usage.output}</MetaChip>
                  ) : null}
                  {message.usage?.reasoning !== undefined ? (
                    <MetaChip>reasoning {message.usage.reasoning}</MetaChip>
                  ) : null}
                  {message.durationMs !== undefined ? (
                    <MetaChip>{formatElapsed(message.durationMs)}</MetaChip>
                  ) : null}
                  {!message.usage ? (
                    <MetaChip>~{estimateTokens(message.content)} estimated tokens</MetaChip>
                  ) : null}
                </div>
              ) : null}
            </div>
          )
        )}
        <div className="assistant-jump-anchor">
          {scrolledUp ? (
            <button
              type="button"
              className="assistant-jump-latest"
              aria-label="Jump to latest"
              onClick={jumpToLatest}
            >
              <ArrowDown size={14} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      {consentRequest ? (
        <div className="assistant-consent-card" role="dialog" aria-modal="true">
          <div className="assistant-error-head">
            <span>Allow AI context to be sent?</span>
          </div>
          <p>This endpoint has not been approved for this connection:</p>
          <code>{consentRequest.endpoint}</code>
          <ul>
            {consentRequest.categories.map((category) => (
              <li key={category}>{category.replaceAll('-', ' ')}</li>
            ))}
          </ul>
          <div className="command-card-actions">
            <button
              type="button"
              className="primary-button settings-apply"
              onClick={() => void acceptConsent()}
            >
              Allow and send
            </button>
            <button
              type="button"
              className="toolbar-button"
              onClick={() => {
                setConsentRequest(null);
                setError('Endpoint consent was not granted.');
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="assistant-error-card" role="alert">
          <div className="assistant-error-head">
            <span>Request failed</span>
            <button
              type="button"
              className="icon-button"
              aria-label="Dismiss error"
              onClick={() => setError(null)}
            >
              <X size={12} aria-hidden="true" />
            </button>
          </div>
          <p>{error}</p>
        </div>
      ) : null}

      <form
        className="assistant-composer"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <div className="assistant-composer-row">
          <textarea
            ref={composerRef}
            value={composer}
            onChange={(event) => setComposer(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
            placeholder="Ask about this terminal..."
            rows={1}
          />
          {streaming ? (
            <button
              type="button"
              className="assistant-send-button stop"
              aria-label="Stop"
              onClick={stop}
            >
              <X size={15} aria-hidden="true" />
            </button>
          ) : (
            <button
              type="submit"
              className="assistant-send-button"
              aria-label="Send"
              disabled={!composer.trim() || !selectedId || !model}
            >
              <ArrowUp size={15} aria-hidden="true" />
            </button>
          )}
        </div>
      </form>
    </aside>
  );
}
