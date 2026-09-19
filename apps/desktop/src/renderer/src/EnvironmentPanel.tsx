import { useCallback, useEffect, useMemo, useState } from 'react';
import type { EnvironmentFacts, EnvironmentRecord } from '@geared-term/protocol';

type EnvironmentTarget = {
  kind: 'local' | 'wsl';
  targetKey: string;
  distribution?: string;
};

type EnvironmentPanelProps = {
  target: EnvironmentTarget;
  onClose: () => void;
};

const factLabels: Array<[keyof EnvironmentFacts, string]> = [
  ['os', 'OS'],
  ['distribution', 'Distribution'],
  ['kernel', 'Kernel'],
  ['architecture', 'Architecture'],
  ['shell', 'Shell'],
  ['shellVersion', 'Shell version'],
  ['user', 'User'],
  ['hostname', 'Hostname']
];

export function EnvironmentPanel({ target, onClose }: EnvironmentPanelProps): React.JSX.Element {
  const [records, setRecords] = useState<EnvironmentRecord[]>([]);
  const [facts, setFacts] = useState<EnvironmentFacts>({});
  const [notes, setNotes] = useState('');
  const [instructions, setInstructions] = useState('');
  const [attachToAi, setAttachToAi] = useState(false);
  const [recordId, setRecordId] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = useMemo(
    () => records.find((record) => record.targetKey === target.targetKey),
    [records, target.targetKey]
  );

  const load = useCallback(async (): Promise<void> => {
    try {
      const saved = await window.geared.listEnvironments();
      setRecords(saved);
      const record = saved.find((item) => item.targetKey === target.targetKey);
      if (record) {
        setRecordId(record.id);
        setFacts(record.facts);
        setNotes(record.notes);
        setInstructions(record.instructions);
        setAttachToAi(record.attachToAi);
      } else {
        setRecordId(undefined);
        setFacts({});
        setNotes('');
        setInstructions('');
        setAttachToAi(false);
      }
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load environment context');
    }
  }, [target.targetKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const detect = async (): Promise<void> => {
    setLoading(true);
    try {
      const detected = await window.geared.probeEnvironment({
        kind: target.kind,
        ...(target.distribution ? { distribution: target.distribution } : {})
      });
      setFacts(detected);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Environment detection failed');
    } finally {
      setLoading(false);
    }
  };

  const save = async (): Promise<void> => {
    setLoading(true);
    try {
      const saved = await window.geared.saveEnvironment({
        id: recordId ?? crypto.randomUUID(),
        targetKey: target.targetKey,
        kind: target.kind,
        facts,
        notes,
        instructions,
        attachToAi,
        detectedAt: new Date().toISOString()
      });
      setRecords(saved);
      const next = saved.find((record) => record.targetKey === target.targetKey);
      setRecordId(next?.id);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save environment context');
    } finally {
      setLoading(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (!current) return;
    setLoading(true);
    try {
      setRecords(await window.geared.deleteEnvironment(current.id));
      setRecordId(undefined);
      setFacts({});
      setNotes('');
      setInstructions('');
      setAttachToAi(false);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to delete environment context');
    } finally {
      setLoading(false);
    }
  };

  return (
    <aside className="environment-panel" aria-label="Environment context">
      <div className="environment-header">
        <div>
          <p className="section-label">Environment</p>
          <h2>{target.kind === 'wsl' ? target.distribution : 'Local host'}</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label="Close environment"
        >
          ×
        </button>
      </div>
      <div className="environment-actions">
        <button
          type="button"
          className="toolbar-button"
          onClick={() => void detect()}
          disabled={loading}
        >
          {loading ? '…' : 'Detect'}
        </button>
        <button
          type="button"
          className="primary-button environment-save"
          onClick={() => void save()}
          disabled={loading}
        >
          Save context
        </button>
        {current ? (
          <button
            type="button"
            className="toolbar-button"
            onClick={() => void remove()}
            disabled={loading}
          >
            Delete
          </button>
        ) : null}
      </div>
      {error ? <p className="sftp-error">{error}</p> : null}
      <dl className="environment-facts">
        {factLabels.map(([key, label]) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd>{facts[key] ?? '—'}</dd>
          </div>
        ))}
      </dl>
      <label className="environment-field">
        Notes
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
      </label>
      <label className="environment-field">
        Environment instructions
        <textarea
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
          rows={3}
        />
      </label>
      <label className="settings-checkbox environment-attach">
        <input
          type="checkbox"
          checked={attachToAi}
          onChange={(event) => setAttachToAi(event.target.checked)}
        />
        <span>Attach this context to AI requests</span>
      </label>
    </aside>
  );
}
