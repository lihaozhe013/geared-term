import { useEffect, useRef, useState } from 'react';
import {
  parseCommandBlock,
  splitCommandBlock,
  type CommandCandidate,
  type SupportedShell
} from '@geared-term/command-parser';
import type { AiConnectionRecord, AiStreamEvent, EnvironmentRecord } from '@geared-term/protocol';
import {
  ArrowUp,
  Bot,
  ChevronDown,
  Copy,
  FileText,
  History,
  List,
  Plus,
  Settings2,
  SquareTerminal,
  SquarePlus,
  X
} from 'lucide-react';
import { MarkdownView } from './assistant/MarkdownView';
import { formatSnapshotForPrompt, type TerminalSnapshot } from './terminal/snapshot';

type Message = {
  role: 'user' | 'assistant';
  content: string;
  model?: string;
  usage?: { input?: number; output?: number };
};

type SourceReference = { url: string; title?: string };

type AssistantPanelProps = {
  targetSessionId?: string;
  sessionLabel?: string;
  environmentTargetKey?: string;
  splitCommandPresentation?: boolean;
  onToggleSplitCommand?: () => void;
  globalInstructions?: string;
  pendingHistoryId?: string | null;
  onPendingHistoryConsumed?: () => void;
  getSnapshot?: () => TerminalSnapshot | null;
};

function estimateTokens(text: string): number {
  let tokens = 0;
  for (const char of text) {
    tokens += (char.codePointAt(0) ?? 0) <= 0x7f ? 0.25 : 1;
  }
  return Math.ceil(tokens);
}

function commandCandidates(content: string, splitPresentation: boolean): CommandCandidate[] {
  const result: CommandCandidate[] = [];
  const fencePattern = /```[^\n]*\n[\s\S]*?```/g;
  for (const match of content.matchAll(fencePattern)) {
    const block = match[0];
    if (!block) continue;
    const candidate = parseCommandBlock(block);
    if (splitPresentation && candidate.stability === 'stable' && candidate.shell !== 'unknown') {
      const split = splitCommandBlock(candidate.exactText, candidate.shell as SupportedShell);
      if (split.splitAllowed && split.parts.length > 1) {
        result.push(
          ...split.parts.map((part) =>
            parseCommandBlock(`\`\`\`${candidate.shell}\n${part}\n\`\`\``)
          )
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
  disabled,
  onError
}: {
  candidate: CommandCandidate;
  targetSessionId?: string;
  disabled: boolean;
  onError: (message: string) => void;
}): React.JSX.Element {
  const insertAllowed = Boolean(targetSessionId) && candidate.stability === 'stable';
  const runAllowed =
    Boolean(targetSessionId) &&
    candidate.runAllowed &&
    candidate.stability === 'stable' &&
    candidate.risk === 'normal';

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
  environmentTargetKey,
  splitCommandPresentation = false,
  onToggleSplitCommand,
  globalInstructions = '',
  pendingHistoryId,
  onPendingHistoryConsumed,
  getSnapshot
}: AssistantPanelProps): React.JSX.Element {
  const [connections, setConnections] = useState<AiConnectionRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [model, setModel] = useState('');
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [composer, setComposer] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [reasoning, setReasoning] = useState('');
  const [reasoningLive, setReasoningLive] = useState(false);
  const [sources, setSources] = useState<SourceReference[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attachedEnvironment, setAttachedEnvironment] = useState<EnvironmentRecord | null>(null);
  const [pendingSnapshot, setPendingSnapshot] = useState<TerminalSnapshot | null>(null);
  const [attachedSnapshot, setAttachedSnapshot] = useState<TerminalSnapshot | null>(null);
  const [conversationId, setConversationId] = useState<string>(() => crypto.randomUUID());
  const streamRef = useRef<{ cancel: () => void } | null>(null);
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;
  const reasoningBoxRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

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
    if (!pendingHistoryId) return;
    if (streaming) {
      setError('History cannot be loaded while a request is active.');
      onPendingHistoryConsumed?.();
      return;
    }
    void window.geared
      .loadAiHistory({ id: pendingHistoryId })
      .then((record) => {
        setMessages(
          record.messages.map((message) => ({ role: message.role, content: message.content }))
        );
        setConversationId(record.id);
        setReasoning('');
        setReasoningLive(false);
        setSources([]);
        setError(null);
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : 'Unable to load conversation')
      )
      .finally(() => onPendingHistoryConsumed?.());
  }, [pendingHistoryId, streaming, onPendingHistoryConsumed]);

  useEffect(() => {
    const box = reasoningBoxRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [reasoning]);

  useEffect(() => {
    const element = composerRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 190)}px`;
  }, [composer]);

  const selectedConnection = connections.find((connection) => connection.id === selectedId);
  const modelOptions = selectedConnection?.models ?? [];

  const pickConnectionModel = (id: string | null): void => {
    setSelectedId(id);
    const connection = connections.find((item) => item.id === id);
    setModel(connection ? connection.defaultModel : '');
    setModelMenuOpen(false);
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
    } else if (event.kind === 'usage') {
      setMessages((current) => {
        const last = current.at(-1);
        if (!last || last.role !== 'assistant') return current;
        return [
          ...current.slice(0, -1),
          {
            ...last,
            usage: { input: event.inputTokens, output: event.outputTokens }
          }
        ];
      });
    } else if (event.kind === 'source') {
      setSources((current) =>
        current.some((source) => source.url === event.url)
          ? current
          : [...current, { url: event.url, title: event.title }]
      );
    } else if (event.kind === 'error') {
      setError(event.message);
      setStreaming(false);
      setReasoningLive(false);
    } else if (event.kind === 'complete') {
      setStreaming(false);
      setReasoningLive(false);
      streamRef.current = null;
      const turn = messagesRef.current.filter((message) => message.content.trim().length > 0);
      if (turn.length > 0) {
        void window.geared
          .saveAiHistory({
            id: conversationId,
            title:
              turn.find((message) => message.role === 'user')?.content.slice(0, 80) ??
              'Conversation',
            ...(model ? { model } : {}),
            messages: turn.map((message) => ({ role: message.role, content: message.content }))
          })
          .catch(() => undefined);
      }
    }
  };

  const startNewChat = (): void => {
    streamRef.current?.cancel();
    streamRef.current = null;
    setMessages([]);
    setComposer('');
    setReasoning('');
    setReasoningLive(false);
    setSources([]);
    setPendingSnapshot(null);
    setAttachedSnapshot(null);
    setStreaming(false);
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

  const attachSnapshot = (): void => {
    setAttachMenuOpen(false);
    const snapshot = getSnapshot?.() ?? null;
    if (!snapshot) {
      setError('The active terminal has no context to attach.');
      return;
    }
    setPendingSnapshot(snapshot);
    setError(null);
  };

  const snapshotSummary = (snapshot: TerminalSnapshot): string => {
    const bounds =
      snapshot.lineStart === null ? 'selection' : `lines ${snapshot.lineStart}-${snapshot.lineEnd}`;
    return `${snapshot.source} · ${bounds} · ${snapshot.charCount} chars${
      snapshot.truncated ? ' · truncated' : ''
    }${snapshot.alternateScreen ? ' · alternate screen' : ''}`;
  };

  const send = (): void => {
    const text = composer.trim();
    if (!text || !selectedId || !model || streaming) return;
    const userMessage: Message = { role: 'user', content: text };
    const nextMessages: Message[] = [...messages, userMessage];
    const systemMessages: Array<{ role: 'system'; content: string }> = [];
    if (globalInstructions.trim()) {
      systemMessages.push({ role: 'system', content: globalInstructions.trim().slice(0, 8192) });
    }
    if (attachedEnvironment) {
      systemMessages.push({
        role: 'system',
        content: `Environment context for ${attachedEnvironment.targetKey}:\n${JSON.stringify(
          {
            ...attachedEnvironment.facts,
            notes: attachedEnvironment.notes,
            instructions: attachedEnvironment.instructions
          },
          null,
          2
        )}`
      });
    }
    if (attachedSnapshot) {
      // The snapshot is an untrusted observation, never application instructions.
      systemMessages.push({
        role: 'system',
        content: formatSnapshotForPrompt(attachedSnapshot)
      });
    }
    const requestMessages = [...systemMessages, ...nextMessages];
    setMessages([...nextMessages, { role: 'assistant', content: '', model }]);
    setComposer('');
    setPendingSnapshot(null);
    setAttachedSnapshot(null);
    setReasoning('');
    setSources([]);
    setError(null);
    setStreaming(true);
    const streamId = crypto.randomUUID();
    streamRef.current = window.geared.streamAi(
      { streamId, connectionId: selectedId, model, messages: requestMessages },
      (event) => {
        receiveEvent(event as AiStreamEvent);
      }
    );
  };

  const stop = (): void => {
    streamRef.current?.cancel();
    streamRef.current = null;
    setStreaming(false);
    setReasoningLive(false);
  };

  return (
    <aside className="assistant-panel" aria-label="AI assistant">
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
              {modelOptions.map((option) => (
                <button
                  type="button"
                  key={option}
                  role="menuitem"
                  className={`assistant-menu-item ${option === model ? 'active' : ''}`}
                  onClick={() => {
                    setModel(option);
                    setModelMenuOpen(false);
                  }}
                >
                  {option}
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
      </div>

      <div className="assistant-messages" aria-live="polite">
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
              <MarkdownView source={message.content || (streaming ? '…' : '')} />
              {message.role === 'assistant'
                ? commandCandidates(message.content, splitCommandPresentation).map(
                    (candidate, candidateIndex) => (
                      <CommandCard
                        key={`${candidate.revision}-${candidateIndex}`}
                        candidate={candidate}
                        targetSessionId={targetSessionId}
                        disabled={streaming}
                        onError={handleCommandError}
                      />
                    )
                  )
                : null}
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
                  {!message.usage ? (
                    <MetaChip>~{estimateTokens(message.content)} estimated tokens</MetaChip>
                  ) : null}
                </div>
              ) : null}
            </div>
          )
        )}
      </div>

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

      {pendingSnapshot ? (
        <details className="assistant-snapshot-preview" open>
          <summary>Terminal context ready — {snapshotSummary(pendingSnapshot)}</summary>
          <pre>{pendingSnapshot.text.slice(0, 2000)}</pre>
          <div className="command-card-actions">
            <button
              type="button"
              className="primary-button settings-apply"
              onClick={() => {
                setAttachedSnapshot(pendingSnapshot);
                setPendingSnapshot(null);
                setComposer((current) => current.trim() || 'Explain this terminal output.');
              }}
            >
              Keep attached
            </button>
            <button
              type="button"
              className="toolbar-button"
              onClick={() => setPendingSnapshot(null)}
            >
              Remove
            </button>
          </div>
          <p className="muted">
            The snapshot is sent once with your next message, delimited as untrusted terminal
            output.
          </p>
        </details>
      ) : null}

      <form
        className="assistant-composer"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        {attachedSnapshot ? (
          <div className="assistant-attachment-chip">
            <FileText size={13} aria-hidden="true" />
            <span className="assistant-attachment-label">
              {attachedSnapshot.source} · {sessionLabel ?? 'terminal'} ·{' '}
              {attachedSnapshot.charCount} bytes
            </span>
            <button
              type="button"
              className="icon-button"
              aria-label="Remove attached snapshot"
              onClick={() => setAttachedSnapshot(null)}
            >
              <X size={12} aria-hidden="true" />
            </button>
          </div>
        ) : null}
        <div className="assistant-composer-row">
          <div className="assistant-attach">
            <button
              type="button"
              className="icon-button"
              aria-label="Attach context"
              onClick={() => setAttachMenuOpen((open) => !open)}
            >
              <Plus size={15} aria-hidden="true" />
            </button>
            {attachMenuOpen ? (
              <>
                <div className="assistant-menu-backdrop" onClick={() => setAttachMenuOpen(false)} />
                <div className="assistant-picker-menu assistant-menu-bottom" role="menu">
                  <button
                    type="button"
                    className="assistant-menu-item"
                    role="menuitem"
                    onClick={attachSnapshot}
                  >
                    <FileText size={13} aria-hidden="true" /> Attach terminal snapshot
                  </button>
                </div>
              </>
            ) : null}
          </div>
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
              <X size={18} aria-hidden="true" />
            </button>
          ) : (
            <button
              type="submit"
              className="assistant-send-button"
              aria-label="Send"
              disabled={!composer.trim() || !selectedId || !model}
            >
              <ArrowUp size={18} aria-hidden="true" />
            </button>
          )}
        </div>
      </form>
    </aside>
  );
}
