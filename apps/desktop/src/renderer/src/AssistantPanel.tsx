import { useEffect, useRef, useState } from 'react';
import {
  parseCommandBlock,
  splitCommandBlock,
  type CommandCandidate,
  type SupportedShell
} from '@geared-term/command-parser';
import type { AiConnectionRecord, AiStreamEvent, EnvironmentRecord } from '@geared-term/protocol';

type Message = {
  role: 'user' | 'assistant';
  content: string;
};

type AssistantPanelProps = {
  targetSessionId?: string;
  environmentTargetKey?: string;
  splitCommandPresentation?: boolean;
};

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
          Copy
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
          Insert
        </button>
        <button
          type="button"
          className="toolbar-button command-run"
          onClick={() => void execute('run')}
          disabled={disabled || !runAllowed}
          title={
            runAllowed
              ? 'Insert and submit once'
              : 'Run is disabled until a stable shell block is available'
          }
        >
          Run
        </button>
      </div>
    </div>
  );
}

export function AssistantPanel({
  targetSessionId,
  environmentTargetKey,
  splitCommandPresentation = false
}: AssistantPanelProps): React.JSX.Element {
  const [connections, setConnections] = useState<AiConnectionRecord[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [name, setName] = useState('Local model');
  const [protocol, setProtocol] = useState<'responses' | 'chat-completions'>('chat-completions');
  const [baseUrl, setBaseUrl] = useState('http://127.0.0.1:11434/v1');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [composer, setComposer] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [reasoning, setReasoning] = useState('');
  const [source, setSource] = useState<string | undefined>();
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attachedEnvironment, setAttachedEnvironment] = useState<EnvironmentRecord | null>(null);
  const streamRef = useRef<{ cancel: () => void } | null>(null);

  useEffect(() => {
    void window.geared
      .listAiConnections()
      .then((saved) => {
        setConnections(saved);
        const first = saved[0];
        if (first) {
          setSelectedId(first.id);
          setName(first.name);
          setProtocol(first.protocol);
          setBaseUrl(first.baseUrl);
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

  const handleSelect = (id: string): void => {
    const connection = connections.find((item) => item.id === id);
    setSelectedId(id);
    if (!connection) return;
    setName(connection.name);
    setProtocol(connection.protocol);
    setBaseUrl(connection.baseUrl);
    setModel(connection.defaultModel);
    setApiKey('');
    setError(null);
  };

  const saveConnection = async (): Promise<void> => {
    try {
      const saved = await window.geared.saveAiConnection({
        id: selectedId || undefined,
        name,
        protocol,
        baseUrl,
        model,
        ...(apiKey ? { apiKey } : {})
      });
      setConnections(saved);
      const latest = saved.at(-1);
      if (latest) {
        setSelectedId(latest.id);
        setModel(latest.defaultModel);
      }
      setApiKey('');
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save AI connection');
    }
  };

  const receiveEvent = (event: AiStreamEvent): void => {
    if (event.kind === 'delta') {
      setMessages((current) => {
        const last = current.at(-1);
        if (!last || last.role !== 'assistant')
          return [...current, { role: 'assistant', content: event.text }];
        return [...current.slice(0, -1), { ...last, content: last.content + event.text }];
      });
    } else if (event.kind === 'reasoning') {
      setReasoning((current) => current + event.text);
    } else if (event.kind === 'source') {
      setSource(event.title ? `${event.title} — ${event.url}` : event.url);
    } else if (event.kind === 'error') {
      setError(event.message);
      setStreaming(false);
    } else if (event.kind === 'complete') {
      setStreaming(false);
      streamRef.current = null;
    }
  };

  const handleCommandError = (message: string): void => setError(message);

  const send = (): void => {
    const text = composer.trim();
    if (!text || !selectedId || !model || streaming) return;
    const nextMessages: Message[] = [...messages, { role: 'user', content: text }];
    const requestMessages = attachedEnvironment
      ? [
          {
            role: 'system' as const,
            content: `Environment context for ${attachedEnvironment.targetKey}:\n${JSON.stringify(
              {
                ...attachedEnvironment.facts,
                notes: attachedEnvironment.notes,
                instructions: attachedEnvironment.instructions
              },
              null,
              2
            )}`
          },
          ...nextMessages
        ]
      : nextMessages;
    setMessages([...nextMessages, { role: 'assistant', content: '' }]);
    setComposer('');
    setReasoning('');
    setSource(undefined);
    setError(null);
    setStreaming(true);
    const streamId = crypto.randomUUID();
    streamRef.current = window.geared.streamAi(
      { streamId, connectionId: selectedId, model, messages: requestMessages },
      (event) => {
        const parsed = event as AiStreamEvent;
        receiveEvent(parsed);
      }
    );
  };

  return (
    <aside className="assistant-panel" aria-label="AI assistant">
      <div className="assistant-header">
        <div>
          <p className="eyebrow">PROVIDER-NEUTRAL STREAM</p>
          <h2>Assistant</h2>
        </div>
        {streaming ? (
          <button
            type="button"
            className="toolbar-button"
            onClick={() => {
              streamRef.current?.cancel();
              streamRef.current = null;
              setStreaming(false);
            }}
          >
            Stop
          </button>
        ) : null}
      </div>

      <div className="assistant-config">
        <label>
          Connection
          <select value={selectedId} onChange={(event) => handleSelect(event.target.value)}>
            <option value="">New connection</option>
            {connections.map((connection) => (
              <option key={connection.id} value={connection.id}>
                {connection.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Name
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          Protocol
          <select
            value={protocol}
            onChange={(event) => setProtocol(event.target.value as typeof protocol)}
          >
            <option value="chat-completions">Chat Completions</option>
            <option value="responses">Responses</option>
          </select>
        </label>
        <label>
          Base URL
          <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
        </label>
        <label>
          Model
          <input
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder="model-name"
          />
        </label>
        <label>
          API key <span className="muted">(optional; stored in vault)</span>
          <input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            autoComplete="off"
          />
        </label>
        <button type="button" className="primary-button" onClick={() => void saveConnection()}>
          Save connection
        </button>
      </div>

      <div className="assistant-messages" aria-live="polite">
        {attachedEnvironment ? (
          <details className="assistant-context">
            <summary>Environment context attached</summary>
            <p>
              {attachedEnvironment.targetKey}: {attachedEnvironment.facts.os ?? 'unknown OS'} ·{' '}
              {attachedEnvironment.facts.hostname ?? 'unknown host'}
            </p>
          </details>
        ) : null}
        {messages.length === 0 ? (
          <p className="muted">Configure a connection, then ask a question.</p>
        ) : null}
        {messages.map((message, index) => (
          <div className={`assistant-message ${message.role}`} key={`${message.role}-${index}`}>
            <small>{message.role === 'user' ? 'You' : 'Assistant'}</small>
            <p>{message.content || (streaming && message.role === 'assistant' ? '…' : '')}</p>
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
          </div>
        ))}
        {reasoning ? (
          <details className="assistant-reasoning">
            <summary>Reasoning summary</summary>
            <p>{reasoning}</p>
          </details>
        ) : null}
        {source ? <p className="assistant-source">Source: {source}</p> : null}
      </div>

      {error ? <p className="terminal-line error">{error}</p> : null}
      <form
        className="assistant-composer"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <textarea
          value={composer}
          onChange={(event) => setComposer(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          placeholder="Ask the assistant…"
          rows={3}
        />
        <button
          type="submit"
          className="primary-button"
          disabled={streaming || !selectedId || !model}
        >
          Send
        </button>
      </form>
    </aside>
  );
}
