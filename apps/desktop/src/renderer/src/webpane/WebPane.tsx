import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CommandCandidate } from '@geared-term/command-parser';
import type {
  LlmWebCandidateGroup,
  LlmWebCandidates,
  LlmWebNavigation,
  LlmWebPaneStatus,
  LlmWebSiteId,
  SettingsRecord
} from '@geared-term/protocol';
import { ArrowLeft, ArrowRight, Globe, Home, RotateCw } from 'lucide-react';
import { CommandCard } from '../assistant/CommandCard';
import { translate, type MessageKey } from '../i18n';

const siteLabels: Record<LlmWebSiteId, string> = {
  chatgpt: 'ChatGPT',
  deepseek: 'DeepSeek'
};

const statusKeys: Record<LlmWebPaneStatus['state'], MessageKey | null> = {
  hidden: null,
  off: 'webStatusOff',
  loading: 'webStatusLoading',
  ready: 'webStatusReady',
  enhanced: 'webStatusEnhanced',
  degraded: 'webStatusDegraded',
  failed: 'webStatusFailed'
};

type WebPaneProps = {
  hidden: boolean;
  modalOpen: boolean;
  enhancementEnabled: boolean;
  targetSessionId?: string;
  sessionLabel?: string;
  allowRiskyRun: boolean;
  language: SettingsRecord['language'];
};

export function WebPane({
  hidden,
  modalOpen,
  enhancementEnabled,
  targetSessionId,
  sessionLabel,
  allowRiskyRun,
  language
}: WebPaneProps): React.JSX.Element {
  const t = useCallback((key: MessageKey): string => translate(language, key), [language]);
  const [site, setSite] = useState<LlmWebSiteId>('chatgpt');
  const [navigation, setNavigation] = useState<LlmWebNavigation | null>(null);
  const [status, setStatus] = useState<LlmWebPaneStatus | null>(null);
  const [candidates, setCandidates] = useState<LlmWebCandidates | null>(null);
  const [opened, setOpened] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const visible = !hidden && !modalOpen;

  useEffect(() => {
    if (!actionError) return;
    const timer = setTimeout(() => setActionError(null), 4000);
    return () => clearTimeout(timer);
  }, [actionError]);

  useEffect(() => {
    const offNavigation = window.geared.onWebPaneNavigation(setNavigation);
    const offStatus = window.geared.onWebPaneStatus(setStatus);
    const offCandidates = window.geared.onWebPaneCandidates(setCandidates);
    return () => {
      offNavigation();
      offStatus();
      offCandidates();
    };
  }, []);

  useEffect(() => {
    const element = surfaceRef.current;
    if (!element) return;
    let frame = 0;
    const report = (): void => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const rect = element.getBoundingClientRect();
        void window.geared
          .setWebPaneBounds({
            x: Math.round(rect.left),
            y: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          })
          .catch(() => undefined);
      });
    };
    const observer = new ResizeObserver(report);
    observer.observe(element);
    window.addEventListener('resize', report);
    report();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', report);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    if (!visible || opened) return;
    setOpened(true);
    void window.geared.openWebPane(site).catch(() => undefined);
  }, [visible, opened, site]);

  useEffect(() => {
    if (!opened) return;
    void window.geared.setWebPaneVisible(visible).catch(() => undefined);
  }, [visible, opened]);

  const switchSite = useCallback(
    (next: LlmWebSiteId): void => {
      if (next === site) return;
      setSite(next);
      setCandidates(null);
      void window.geared.openWebPane(next).catch(() => undefined);
    },
    [site]
  );

  const navigate = useCallback((action: 'back' | 'forward' | 'reload' | 'home'): void => {
    void window.geared.webPaneNavigate(action).catch(() => undefined);
  }, []);

  const reveal = useCallback((blockId: string): void => {
    void window.geared.revealWebBlock(blockId).catch(() => undefined);
  }, []);

  const groups = useMemo<LlmWebCandidateGroup[]>(() => {
    if (!candidates || candidates.site !== site) return [];
    return candidates.groups;
  }, [candidates, site]);

  const statusKey = status && statusKeys[status.state];
  const navDisabled = !opened;

  return (
    <section className="web-pane" aria-label={t('panelWeb')}>
      <div className="web-pane-toolbar">
        <div className="web-pane-sites" role="tablist" aria-label={t('panelWeb')}>
          {(Object.keys(siteLabels) as LlmWebSiteId[]).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={site === id}
              className="right-panel-pill"
              title={t('webOpenSite').replace('{site}', siteLabels[id])}
              onClick={() => switchSite(id)}
            >
              {siteLabels[id]}
            </button>
          ))}
        </div>
        <span className="right-panel-spacer" />
        <button
          type="button"
          className="icon-button"
          aria-label={t('webBack')}
          title={t('webBack')}
          disabled={navDisabled || !navigation?.canGoBack}
          onClick={() => navigate('back')}
        >
          <ArrowLeft size={13} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={t('webForward')}
          title={t('webForward')}
          disabled={navDisabled || !navigation?.canGoForward}
          onClick={() => navigate('forward')}
        >
          <ArrowRight size={13} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={t('webReload')}
          title={t('webReload')}
          disabled={navDisabled}
          onClick={() => navigate('reload')}
        >
          <RotateCw size={13} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={t('webHome')}
          title={t('webHome')}
          disabled={navDisabled}
          onClick={() => navigate('home')}
        >
          <Home size={13} aria-hidden="true" />
        </button>
      </div>
      <div className="web-pane-surface" ref={surfaceRef} aria-hidden="true" />
      {statusKey ? (
        <p className={`web-pane-status status-${status?.state}`} role="status">
          <Globe size={12} aria-hidden="true" /> {t(statusKey)}
          {status?.state === 'failed' && status.detail ? ` (${status.detail})` : ''}
        </p>
      ) : null}
      <div className="web-pane-candidates">
        <div className="web-pane-candidates-header">
          <strong>{t('webCommandsTitle')}</strong>
          <small>
            {targetSessionId
              ? t('webTargetTerminal').replace('{label}', sessionLabel ?? targetSessionId)
              : t('webNoTerminal')}
          </small>
        </div>
        {groups.length === 0 ? (
          <p className="web-pane-empty">
            {enhancementEnabled ? t('webCommandsEmpty') : t('webCommandsDisabled')}
          </p>
        ) : (
          groups.map((group, groupIndex) => (
            <div key={group.blockId} className="web-candidate-group">
              <div className="web-candidate-group-header">
                <small>{t('webBlockLabel').replace('{index}', String(groupIndex + 1))}</small>
                {group.streaming ? (
                  <small className="web-candidate-badge">{t('webStreamingBadge')}</small>
                ) : null}
                {group.wholeBlock ? (
                  <small className="web-candidate-badge">{t('webWholeBlockBadge')}</small>
                ) : null}
                <span className="right-panel-spacer" />
                <button
                  type="button"
                  className="toolbar-button"
                  onClick={() => reveal(group.blockId)}
                >
                  {t('webRevealBlock')}
                </button>
              </div>
              {group.rows.map((row) => {
                const candidate: CommandCandidate = {
                  shell: row.shell,
                  exactText: row.exactText,
                  revision: row.revision,
                  stability: row.stability,
                  risk: row.risk,
                  confidence: row.confidence,
                  complete: row.stability !== 'incomplete',
                  runAllowed: row.runAllowed && !group.streaming
                };
                return (
                  <CommandCard
                    key={row.rowId}
                    candidate={candidate}
                    targetSessionId={targetSessionId}
                    allowRiskyRun={allowRiskyRun}
                    disabled={false}
                    onError={setActionError}
                    language={language}
                  />
                );
              })}
            </div>
          ))
        )}
        {actionError ? (
          <p className="web-pane-error" role="alert">
            {actionError}
          </p>
        ) : null}
      </div>
    </section>
  );
}
