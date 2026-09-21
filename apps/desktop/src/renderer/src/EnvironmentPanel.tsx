import { useCallback, useEffect, useMemo, useState } from 'react';
import type { EnvironmentFacts, EnvironmentRecord, SettingsRecord } from '@geared-term/protocol';
import { translate } from './i18n';
import type { MessageKey } from './i18n';

type EnvironmentTarget = {
  kind: 'local' | 'wsl' | 'ssh';
  targetKey: string;
  distribution?: string;
  shell?: string;
  cwd?: string;
  legacyTargetKeys?: string[];
};

type EnvironmentPanelProps = {
  target: EnvironmentTarget;
  language: SettingsRecord['language'];
  onClose: () => void;
};

const factLabels: Array<[keyof EnvironmentFacts, MessageKey]> = [
  ['os', 'factOs'],
  ['distribution', 'factDistribution'],
  ['kernel', 'factKernel'],
  ['architecture', 'factArchitecture'],
  ['shell', 'factShell'],
  ['shellVersion', 'factShellVersion'],
  ['user', 'factUser'],
  ['hostname', 'factHostname']
];

export function EnvironmentPanel({
  target,
  language,
  onClose
}: EnvironmentPanelProps): React.JSX.Element {
  const t = useCallback((key: MessageKey): string => translate(language, key), [language]);
  const [records, setRecords] = useState<EnvironmentRecord[]>([]);
  const [facts, setFacts] = useState<EnvironmentFacts>({});
  const [notes, setNotes] = useState('');
  const [instructions, setInstructions] = useState('');
  const [attachToAi, setAttachToAi] = useState(false);
  const [verified, setVerified] = useState(false);
  const [detectedAt, setDetectedAt] = useState<string | null>(null);
  const [recordId, setRecordId] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matchesTarget = useCallback(
    (record: EnvironmentRecord): boolean =>
      record.targetKey === target.targetKey ||
      Boolean(target.legacyTargetKeys?.includes(record.targetKey)),
    [target.legacyTargetKeys, target.targetKey]
  );
  const current = useMemo(() => records.find(matchesTarget), [matchesTarget, records]);

  const load = useCallback(async (): Promise<void> => {
    try {
      const saved = await window.geared.listEnvironments();
      setRecords(saved);
      const record = saved.find(matchesTarget);
      if (record) {
        setRecordId(record.id);
        setFacts(record.facts);
        setNotes(record.notes);
        setInstructions(record.instructions);
        setAttachToAi(record.attachToAi);
        setVerified(record.verified);
        setDetectedAt(record.detectedAt);
      } else {
        setRecordId(undefined);
        setFacts({});
        setNotes('');
        setInstructions('');
        setAttachToAi(true);
        setVerified(false);
        setDetectedAt(null);
      }
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('errLoadEnvironment'));
    }
  }, [matchesTarget, t, target.targetKey]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return window.geared.onEnvironmentUpdated((record) => {
      if (!matchesTarget(record)) return;
      setRecords((currentRecords) => [
        ...currentRecords.filter((item) => item.targetKey !== record.targetKey),
        record
      ]);
      setRecordId(record.id);
      setFacts(record.facts);
      setNotes(record.notes);
      setInstructions(record.instructions);
      setAttachToAi(record.attachToAi);
      setVerified(record.verified);
      setDetectedAt(record.detectedAt);
    });
  }, [matchesTarget]);

  const detect = async (): Promise<void> => {
    if (target.kind === 'ssh') {
      setError(t('envSshAutoDetect'));
      return;
    }
    setLoading(true);
    try {
      const detected = await window.geared.probeEnvironment({
        kind: target.kind,
        ...(target.distribution ? { distribution: target.distribution } : {}),
        ...(target.shell ? { shell: target.shell } : {}),
        ...(target.cwd ? { cwd: target.cwd } : {})
      });
      setFacts(detected);
      setVerified(false);
      setDetectedAt(new Date().toISOString());
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('errEnvironmentDetect'));
    } finally {
      setLoading(false);
    }
  };

  const save = async (verifiedOverride = verified): Promise<void> => {
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
        verified: verifiedOverride,
        detectedAt
      });
      setRecords(saved);
      const next = saved.find((record) => record.targetKey === target.targetKey);
      setRecordId(next?.id);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('errSaveEnvironment'));
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
      setVerified(false);
      setDetectedAt(null);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('errDeleteEnvironment'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <aside className="environment-panel" aria-label="Environment context">
      <div className="environment-header">
        <div>
          <p className="section-label">{t('envTitle')}</p>
          <h2>
            {target.kind === 'wsl'
              ? target.distribution
              : target.kind === 'ssh'
                ? t('envSshHost')
                : t('envLocalHost')}
          </h2>
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
          {loading ? '…' : t('envDetect')}
        </button>
        <button
          type="button"
          className="primary-button environment-save"
          onClick={() => void save()}
          disabled={loading}
        >
          {t('envSaveContext')}
        </button>
        {current ? (
          <button
            type="button"
            className="toolbar-button"
            onClick={() => void remove()}
            disabled={loading}
          >
            {t('delete')}
          </button>
        ) : null}
      </div>
      {error ? <p className="sftp-error">{error}</p> : null}
      <p className="muted">
        {verified ? t('envVerified') : t('envNeedsConfirmation')}
        {detectedAt
          ? ` ${t('envLastDetected').replace('{time}', new Date(detectedAt).toLocaleString())}`
          : ` ${t('envNeverDetected')}`}
      </p>
      <dl className="environment-facts">
        {factLabels.map(([key, label]) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd>{facts[key] ?? '—'}</dd>
          </div>
        ))}
      </dl>
      <label className="environment-field">
        {t('envNotes')}
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} />
      </label>
      <label className="environment-field">
        {t('envInstructions')}
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
        <span>{t('envAttach')}</span>
      </label>
      {!verified && current ? (
        <button
          type="button"
          className="toolbar-button"
          onClick={() => {
            setVerified(true);
            void save(true);
          }}
          disabled={loading}
        >
          {t('envConfirmFacts')}
        </button>
      ) : null}
    </aside>
  );
}
