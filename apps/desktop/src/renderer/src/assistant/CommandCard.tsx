import { useCallback } from 'react';
import type { CommandCandidate } from '@geared-term/command-parser';
import type { SettingsRecord } from '@geared-term/protocol';
import { Copy, SquarePlus, SquareTerminal } from 'lucide-react';
import { translate } from '../i18n';

export function CommandCard({
  candidate,
  targetSessionId,
  allowRiskyRun,
  disabled,
  onError,
  language
}: {
  candidate: CommandCandidate;
  targetSessionId?: string;
  allowRiskyRun: boolean;
  disabled: boolean;
  onError: (message: string) => void;
  language: SettingsRecord['language'];
}): React.JSX.Element {
  const t = useCallback(
    (key: Parameters<typeof translate>[1]): string => translate(language, key),
    [language]
  );
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
      onError(reason instanceof Error ? reason.message : t('errCopyCommand'));
    }
  };

  const execute = async (action: 'insert' | 'run'): Promise<void> => {
    if (!targetSessionId) {
      onError(t('errSelectVisibleTerminal'));
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
      onError(reason instanceof Error ? reason.message : t('errSubmitCommand'));
    }
  };

  return (
    <div className="command-card">
      <div className="command-card-header">
        <small>
          {candidate.shell} · {t('confidenceValue').replace('{value}', candidate.confidence)}
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
          <Copy size={12} aria-hidden="true" /> {t('terminalCopy')}
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
          <SquareTerminal size={12} aria-hidden="true" /> {t('cmdInsert')}
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
          <SquarePlus size={12} aria-hidden="true" /> {t('cmdRun')}
        </button>
      </div>
    </div>
  );
}
