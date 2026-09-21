import { useEffect, useRef, useState } from 'react';
import type {
  AiConnectionInput,
  AiConnectionRecord,
  AiModelProfile,
  AiResponsesModelDefaults,
  AiResponsesReasoningEffort,
  AiResponsesVerbosity
} from '@geared-term/protocol';
import { Bot, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Row, Section } from './primitives';
import type { Translate } from './sections';

type DraftModel = {
  id: string;
  model: string;
  label: string;
  responses: AiResponsesModelDefaults;
};

type Draft = {
  id?: string;
  name: string;
  protocol: 'responses' | 'chat-completions';
  baseUrl: string;
  models: DraftModel[];
  defaultModel: string;
  apiKey: string;
};

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

const verbosityValues: AiResponsesVerbosity[] = ['default', 'low', 'medium', 'high'];

function defaultResponses(): AiResponsesModelDefaults {
  return {
    reasoningEffort: 'default',
    verbosity: 'default',
    reasoningSummary: true,
    webSearch: false
  };
}

function draftModelFrom(profile: AiModelProfile): DraftModel {
  return {
    id: profile.id,
    model: profile.model,
    label: profile.label ?? '',
    responses: { ...defaultResponses(), ...(profile.responses ?? {}) }
  };
}

function createEmptyDraft(defaultName: string): Draft {
  return {
    name: defaultName,
    protocol: 'responses',
    baseUrl: 'https://api.openai.com/v1',
    models: [
      {
        id: crypto.randomUUID(),
        model: '',
        label: '',
        responses: defaultResponses()
      }
    ],
    defaultModel: '',
    apiKey: ''
  };
}

function draftFrom(record: AiConnectionRecord): Draft {
  return {
    id: record.id,
    name: record.name,
    protocol: record.protocol,
    baseUrl: record.baseUrl,
    models: record.models.map(draftModelFrom),
    defaultModel: record.defaultModel,
    apiKey: ''
  };
}

export function AiConnectionsSection({ t }: { t: Translate }): React.JSX.Element {
  const [connections, setConnections] = useState<AiConnectionRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(() => createEmptyDraft(t('newConnection')));
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
        setError(reason instanceof Error ? reason.message : t('errLoadConnections'))
      );
  }, []);

  const mutateDraft = (mutator: (current: Draft) => Draft): void => {
    setDraft((current) => mutator(current));
    setDirty(true);
    setStatus(null);
  };

  const patch = (value: Partial<Draft>): void => {
    mutateDraft((current) => ({ ...current, ...value }));
  };

  const select = (id: string | null): void => {
    if (dirty && !window.confirm(t('unsavedChanges'))) return;
    const record = connectionsRef.current.find((item) => item.id === id);
    setSelectedId(id);
    setDraft(record ? draftFrom(record) : createEmptyDraft(t('newConnection')));
    setDirty(false);
    setDiscovered([]);
    setStatus(null);
    setError(null);
  };

  const patchModel = (index: number, value: Partial<DraftModel>): void => {
    mutateDraft((current) => {
      const models = current.models.map((model, modelIndex) =>
        modelIndex === index ? { ...model, ...value } : model
      );
      const changed = current.models[index];
      const nextModel = models[index];
      const defaultModel =
        changed && nextModel && current.defaultModel === changed.model
          ? nextModel.model
          : current.defaultModel || nextModel?.model || '';
      return { ...current, models, defaultModel };
    });
  };

  const addModel = (modelName = ''): void => {
    const model = modelName.trim();
    if (model && draft.models.some((item) => item.model === model)) {
      if (!draft.defaultModel) patch({ defaultModel: model });
      return;
    }
    mutateDraft((current) => ({
      ...current,
      models: [
        ...current.models,
        {
          id: crypto.randomUUID(),
          model,
          label: '',
          responses: defaultResponses()
        }
      ],
      defaultModel: current.defaultModel || model
    }));
  };

  const removeModel = (index: number): void => {
    mutateDraft((current) => {
      const removed = current.models[index];
      const models = current.models.filter((_model, modelIndex) => modelIndex !== index);
      const defaultModel =
        removed?.model === current.defaultModel ? (models[0]?.model ?? '') : current.defaultModel;
      return { ...current, models, defaultModel };
    });
  };

  const changeProtocol = (protocol: Draft['protocol']): void => {
    mutateDraft((current) => ({
      ...current,
      protocol,
      models: current.models.map((model) => ({
        ...model,
        ...(protocol === 'responses' ? { responses: model.responses ?? defaultResponses() } : {})
      }))
    }));
  };

  const save = async (): Promise<void> => {
    const models = draft.models
      .map((model) => ({
        id: model.id.trim() || crypto.randomUUID(),
        model: model.model.trim(),
        ...(model.label.trim() ? { label: model.label.trim() } : {}),
        ...(draft.protocol === 'responses' ? { responses: model.responses } : {})
      }))
      .filter((model) => model.model.length > 0);
    if (models.length === 0) {
      setError(t('errNoModelsToSave'));
      return;
    }
    const defaultModel = models.some((model) => model.model === draft.defaultModel)
      ? draft.defaultModel
      : models[0]?.model;
    if (!defaultModel) {
      setError(t('errNoDefaultModel'));
      return;
    }
    const input: AiConnectionInput = {
      ...(draft.id ? { id: draft.id } : {}),
      name: draft.name.trim() || t('untitledConnection'),
      protocol: draft.protocol,
      baseUrl: draft.baseUrl.trim(),
      models,
      defaultModel,
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
      setError(reason instanceof Error ? reason.message : t('errSaveConnection'));
    }
  };

  const remove = async (): Promise<void> => {
    if (!draft.id) return;
    if (!window.confirm(t('confirmDeleteConnection').replace('{name}', draft.name))) return;
    try {
      const saved = await window.geared.deleteAiConnection(draft.id);
      setConnections(saved);
      const record = saved[0];
      setSelectedId(record ? record.id : null);
      setDraft(record ? draftFrom(record) : createEmptyDraft(t('newConnection')));
      setDirty(false);
      setDiscovered([]);
      setStatus(null);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('errDeleteConnection'));
    }
  };

  const test = async (): Promise<void> => {
    setDiscovering(true);
    setStatus(null);
    setError(null);
    const selectedModel = draft.defaultModel || draft.models.find((item) => item.model)?.model;
    try {
      const result = draft.id
        ? await window.geared.discoverAiModels({
            connectionId: draft.id,
            ...(selectedModel ? { model: selectedModel } : {})
          })
        : await window.geared.discoverAiModels({
            protocol: draft.protocol,
            baseUrl: draft.baseUrl.trim(),
            ...(selectedModel ? { model: selectedModel } : {}),
            ...(draft.apiKey ? { apiKey: draft.apiKey } : {})
          });
      setDiscovered(result.models);
      setStatus(
        `${t('connectionVerified')} ${t('modelsFound').replace('{count}', String(result.models.length))}`
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('errConnectionTest'));
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
                onChange={(event) => changeProtocol(event.target.value as Draft['protocol'])}
              >
                <option value="responses">{t('protocolResponses')}</option>
                <option value="chat-completions">{t('protocolChat')}</option>
              </select>
            </Row>
            <Row label={t('baseUrl')} hint={t('baseUrlHint')}>
              <input
                className="settings-input"
                value={draft.baseUrl}
                onChange={(event) => patch({ baseUrl: event.target.value.slice(0, 2048) })}
                placeholder="https://api.openai.com/v1"
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
            <p className="settings-card-title">{t('models')}</p>
            <p className="settings-hint">{t('modelsHint')}</p>
            <div className="ai-model-list">
              {draft.models.map((model, index) => (
                <div className="ai-model-card" key={model.id}>
                  <div className="ai-model-card-header">
                    <strong>{t('modelNumber').replace('{index}', String(index + 1))}</strong>
                    <button
                      type="button"
                      className="icon-button danger-button"
                      aria-label={`Remove model ${model.model || index + 1}`}
                      onClick={() => removeModel(index)}
                    >
                      <Trash2 size={13} aria-hidden="true" />
                    </button>
                  </div>
                  <Row label={t('modelIdLabel')}>
                    <input
                      className="settings-input"
                      value={model.model}
                      onChange={(event) =>
                        patchModel(index, { model: event.target.value.slice(0, 256) })
                      }
                      placeholder="model-name"
                      spellCheck={false}
                    />
                  </Row>
                  <Row label={t('displayNameLabel')}>
                    <input
                      className="settings-input"
                      value={model.label}
                      onChange={(event) =>
                        patchModel(index, { label: event.target.value.slice(0, 256) })
                      }
                      placeholder={t('optionalPlaceholder')}
                      spellCheck={false}
                    />
                  </Row>
                  <label className="ai-model-default">
                    <input
                      type="radio"
                      name="default-ai-model"
                      checked={draft.defaultModel === model.model && model.model.length > 0}
                      onChange={() => patch({ defaultModel: model.model })}
                      disabled={!model.model}
                    />
                    {t('defaultModel')}
                  </label>
                  {draft.protocol === 'responses' ? (
                    <div className="ai-model-options">
                      <label>
                        <span>R</span>
                        <select
                          className="settings-select"
                          value={model.responses.reasoningEffort}
                          onChange={(event) =>
                            patchModel(index, {
                              responses: {
                                ...model.responses,
                                reasoningEffort: event.target.value as AiResponsesReasoningEffort
                              }
                            })
                          }
                        >
                          {reasoningEfforts.map((effort) => (
                            <option value={effort} key={effort}>
                              {effort}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>V</span>
                        <select
                          className="settings-select"
                          value={model.responses.verbosity}
                          onChange={(event) =>
                            patchModel(index, {
                              responses: {
                                ...model.responses,
                                verbosity: event.target.value as AiResponsesVerbosity
                              }
                            })
                          }
                        >
                          {verbosityValues.map((verbosity) => (
                            <option value={verbosity} key={verbosity}>
                              {verbosity}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="ai-model-toggle">
                        <input
                          type="checkbox"
                          checked={model.responses.reasoningSummary}
                          onChange={(event) =>
                            patchModel(index, {
                              responses: {
                                ...model.responses,
                                reasoningSummary: event.target.checked
                              }
                            })
                          }
                        />
                        {model.responses.reasoningSummary ? t('summaryOn') : t('summaryOff')}
                      </label>
                      <label className="ai-model-toggle">
                        <input
                          type="checkbox"
                          checked={model.responses.webSearch}
                          onChange={(event) =>
                            patchModel(index, {
                              responses: { ...model.responses, webSearch: event.target.checked }
                            })
                          }
                        />
                        {model.responses.webSearch ? t('webOn') : t('webOff')}
                      </label>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
            <div className="settings-actions-row">
              <button type="button" className="toolbar-button" onClick={() => addModel()}>
                <Plus size={13} aria-hidden="true" /> {t('addModel')}
              </button>
            </div>
            {discovered.length > 0 ? (
              <>
                <p className="settings-hint">{t('discoveredModels')}</p>
                <div className="chip-row">
                  {discovered.map((model) => (
                    <button
                      type="button"
                      key={model}
                      className="chip"
                      onClick={() => addModel(model)}
                    >
                      ＋ {model}
                    </button>
                  ))}
                </div>
              </>
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
