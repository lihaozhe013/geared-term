import { useEffect, useRef, useState } from 'react';
import type { AiConnectionRecord, AiConnectionInput } from '@geared-term/protocol';
import { Bot, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { translate } from '../i18n';
import { Row, Section } from './primitives';
import type { Translate } from './sections';

type Draft = {
  id?: string;
  name: string;
  protocol: 'responses' | 'chat-completions';
  baseUrl: string;
  model: string;
  apiKey: string;
};

function draftFrom(record: AiConnectionRecord): Draft {
  return {
    id: record.id,
    name: record.name,
    protocol: record.protocol,
    baseUrl: record.baseUrl,
    model: record.defaultModel,
    apiKey: ''
  };
}

const EMPTY_DRAFT: Draft = {
  name: 'New connection',
  protocol: 'chat-completions',
  baseUrl: 'http://127.0.0.1:11434/v1',
  model: '',
  apiKey: ''
};

export function AiConnectionsSection({ t }: { t: Translate }): React.JSX.Element {
  const [connections, setConnections] = useState<AiConnectionRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [dirty, setDirty] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const connectionsRef = useRef<AiConnectionRecord[]>([]);
  connectionsRef.current = connections;

  useEffect(() => {
    void window.geared
      .listAiConnections()
      .then((saved) => {
        setConnections(saved);
        if (saved[0]) {
          setSelectedId(saved[0].id);
          setDraft(draftFrom(saved[0]));
        }
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : 'Unable to load AI connections')
      );
  }, []);

  const patch = (value: Partial<Draft>): void => {
    setDraft((current) => ({ ...current, ...value }));
    setDirty(true);
    setStatus(null);
  };

  const select = (id: string | null): void => {
    if (dirty && !window.confirm(t('unsavedChanges'))) return;
    const record = connectionsRef.current.find((item) => item.id === id);
    setSelectedId(id);
    setDraft(record ? draftFrom(record) : EMPTY_DRAFT);
    setDirty(false);
    setDiscovered([]);
    setStatus(null);
    setError(null);
  };

  const save = async (): Promise<void> => {
    const input: AiConnectionInput = {
      ...(draft.id ? { id: draft.id } : {}),
      name: draft.name.trim() || 'Untitled connection',
      protocol: draft.protocol,
      baseUrl: draft.baseUrl.trim(),
      model: draft.model.trim() || 'default',
      ...(draft.apiKey ? { apiKey: draft.apiKey } : {})
    };
    try {
      const saved = await window.geared.saveAiConnection(input);
      setConnections(saved);
      const record = saved.find((item) => item.id === input.id) ?? saved.at(-1);
      if (record) {
        setSelectedId(record.id);
        setDraft({ ...draftFrom(record), apiKey: '' });
      }
      setDirty(false);
      setStatus(t('savedStatus'));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save AI connection');
    }
  };

  const remove = async (): Promise<void> => {
    if (!draft.id) return;
    if (!window.confirm(`Delete the connection "${draft.name}"?`)) return;
    try {
      const saved = await window.geared.deleteAiConnection(draft.id);
      setConnections(saved);
      const record = saved[0];
      setSelectedId(record ? record.id : null);
      setDraft(record ? draftFrom(record) : EMPTY_DRAFT);
      setDirty(false);
      setDiscovered([]);
      setStatus(null);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to delete AI connection');
    }
  };

  const test = async (): Promise<void> => {
    setDiscovering(true);
    setStatus(null);
    setError(null);
    try {
      const result = draft.id
        ? await window.geared.discoverAiModels({
            connectionId: draft.id,
            ...(draft.model ? { model: draft.model } : {})
          })
        : await window.geared.discoverAiModels({
            protocol: draft.protocol,
            baseUrl: draft.baseUrl.trim(),
            ...(draft.model ? { model: draft.model } : {}),
            ...(draft.apiKey ? { apiKey: draft.apiKey } : {})
          });
      setDiscovered(result.models);
      setStatus(`${t('connectionVerified')} ${result.models.length} models`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Connection test failed');
    } finally {
      setDiscovering(false);
    }
  };

  const selected = connections.find((item) => item.id === selectedId);

  return (
    <div className="connection-layout">
      <div className="connection-list" aria-label={t('groupAiConnections')}>
        <div className="connection-list-header">
          <span>{t('groupAiConnections')}</span>
          <button
            type="button"
            className="icon-button"
            aria-label={t('addConnection')}
            onClick={() => select(null)}
          >
            <Plus size={14} aria-hidden="true" />
          </button>
        </div>
        {connections.map((connection) => (
          <button
            type="button"
            key={connection.id}
            className={`settings-nav-item ${connection.id === selectedId ? 'active' : ''}`}
            onClick={() => select(connection.id)}
          >
            <Bot size={14} aria-hidden="true" />
            <span className="connection-list-name">{connection.name}</span>
          </button>
        ))}
        {connections.length === 0 ? <p className="settings-hint">{t('noConnections')}</p> : null}
      </div>
      <div className="connection-editor">
        <Section title={draft.name || t('newConnection')}>
          <div className="settings-card">
            <p className="settings-card-title">
              {t('connectionName')} · {t('protocol')}
            </p>
            <Row label={t('connectionName')}>
              <input
                className="settings-input"
                value={draft.name}
                onChange={(event) => patch({ name: event.target.value.slice(0, 160) })}
                spellCheck={false}
              />
            </Row>
            <Row label={t('protocol')}>
              <select
                className="settings-select"
                value={draft.protocol}
                onChange={(event) => patch({ protocol: event.target.value as Draft['protocol'] })}
              >
                <option value="chat-completions">{t('protocolChat')}</option>
                <option value="responses">{t('protocolResponses')}</option>
              </select>
            </Row>
            <Row label={t('baseUrl')}>
              <input
                className="settings-input"
                value={draft.baseUrl}
                onChange={(event) => patch({ baseUrl: event.target.value.slice(0, 2048) })}
                placeholder="https://api.example.com/v1"
                spellCheck={false}
              />
            </Row>
          </div>
          <div className="settings-card">
            <p className="settings-card-title">{t('apiKey')}</p>
            <Row
              label={t('apiKey')}
              hint={
                selected?.apiKeyRef
                  ? draft.apiKey
                    ? t('keyWillStore')
                    : t('keyStored')
                  : draft.apiKey
                    ? t('keyWillStore')
                    : t('noKeyStored')
              }
            >
              <input
                className="settings-input"
                type="password"
                value={draft.apiKey}
                onChange={(event) => patch({ apiKey: event.target.value.slice(0, 4096) })}
                autoComplete="off"
              />
            </Row>
            <div className="settings-actions-row">
              <button
                type="button"
                className="toolbar-button"
                onClick={() => void test()}
                disabled={discovering}
              >
                <RefreshCw size={13} aria-hidden="true" />{' '}
                {discovering ? t('testing') : t('testConnection')}
              </button>
            </div>
          </div>
          <div className="settings-card">
            <p className="settings-card-title">{t('defaultModel')}</p>
            <Row label={t('defaultModel')}>
              <input
                className="settings-input"
                value={draft.model}
                onChange={(event) => patch({ model: event.target.value.slice(0, 256) })}
                placeholder="model-name"
                spellCheck={false}
              />
            </Row>
            {discovered.length > 0 ? (
              <div className="chip-row">
                {discovered.map((model) => (
                  <button
                    type="button"
                    key={model}
                    className="chip"
                    onClick={() => patch({ model })}
                  >
                    ＋ {model}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="settings-actions-row">
              <button
                type="button"
                className="toolbar-button"
                onClick={() => void test()}
                disabled={discovering}
              >
                <RefreshCw size={13} aria-hidden="true" />{' '}
                {discovering ? t('discovering') : t('discoverModels')}
              </button>
            </div>
          </div>
          {status ? <p className="settings-status status-ok">{status}</p> : null}
          {error ? <p className="settings-status status-error">{error}</p> : null}
          <div className="settings-actions-row connection-footer">
            {draft.id && dirty ? (
              <button
                type="button"
                className="toolbar-button"
                onClick={() => {
                  if (draft.id) select(draft.id);
                }}
              >
                {t('revertChanges')}
              </button>
            ) : null}
            <button
              type="button"
              className="primary-button settings-apply"
              onClick={() => void save()}
            >
              {t('saveConnection')}
            </button>
            {draft.id ? (
              <button
                type="button"
                className="toolbar-button danger-button"
                onClick={() => void remove()}
              >
                <Trash2 size={13} aria-hidden="true" /> {t('deleteConnection')}
              </button>
            ) : null}
          </div>
        </Section>
      </div>
    </div>
  );
}
