import { useEffect, useState } from 'react';
import { groupThemeNames, normalizeTerminalFontFallbacks } from '@geared-term/protocol';
import type {
  AppInfo,
  InvalidThemeFile,
  RuntimeInfo,
  SettingsRecord,
  UpdateStatus,
  TerminalFontFallbackEntry
} from '@geared-term/protocol';
import { isFrostedGlassSupported } from '../appearance/window-effect';
import { FolderOpen, FolderSync, Plus } from 'lucide-react';
import { settingsLocale, translate } from '../i18n';
import gearedTermMark from '../assets/geared-term-mark.png';
import { Row, Section, Stepper } from './primitives';
import { FontPicker } from './FontPicker';

export type Translate = (key: Parameters<typeof translate>[1]) => string;

export function makeTranslate(language: SettingsRecord['language']): Translate {
  void settingsLocale(language);
  return (key) => translate(language, key);
}

type EditableFallbackFont = TerminalFontFallbackEntry & { editorId: string };
type AppearanceDraft = Omit<SettingsRecord, 'terminalFontFallbacks'> & {
  terminalFontFallbacks: EditableFallbackFont[];
};

function persistedFallbackFonts(entries: EditableFallbackFont[]): TerminalFontFallbackEntry[] {
  return entries.map(({ editorId: _editorId, ...entry }) => entry);
}

export function GeneralSection({
  settings,
  onSave,
  t
}: {
  settings: SettingsRecord;
  onSave: (patch: Partial<SettingsRecord>) => Promise<boolean>;
  t: Translate;
}): React.JSX.Element {
  return (
    <Section title={t('groupGeneral')}>
      <Row label={t('language')}>
        <div className="segmented" role="group" aria-label={t('language')}>
          {(
            [
              { value: 'system', label: t('systemLanguage') },
              { value: 'en-US', label: 'English' },
              { value: 'zh-CN', label: '简体中文' }
            ] as const
          ).map((option) => (
            <button
              type="button"
              key={option.value}
              className={settings.language === option.value ? 'active' : ''}
              aria-pressed={settings.language === option.value}
              onClick={() => void onSave({ language: option.value })}
            >
              {option.label}
            </button>
          ))}
        </div>
      </Row>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={settings.splitCommandPresentation}
          onChange={(event) =>
            void onSave({ splitCommandPresentation: event.target.checked }).catch(() => undefined)
          }
        />
        <span>{t('splitCommands')}</span>
      </label>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={settings.allowRiskyRun}
          onChange={(event) =>
            void onSave({ allowRiskyRun: event.target.checked }).catch(() => undefined)
          }
        />
        <span>{t('allowRiskyRun')}</span>
      </label>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={settings.keepRunningInBackground}
          onChange={(event) =>
            void onSave({ keepRunningInBackground: event.target.checked }).catch(() => undefined)
          }
        />
        <span>{t('keepRunningInBackground')}</span>
      </label>
    </Section>
  );
}

export function AppearanceSection({
  settings,
  appInfo,
  themeNames,
  invalidThemes,
  onSave,
  t
}: {
  settings: SettingsRecord;
  appInfo: AppInfo | null;
  themeNames: string[];
  invalidThemes: InvalidThemeFile[];
  onSave: (patch: Partial<SettingsRecord>) => Promise<boolean>;
  t: Translate;
}): React.JSX.Element {
  const [draft, setDraft] = useState<AppearanceDraft>(() => ({
    ...settings,
    terminalFontFallbacks: settings.terminalFontFallbacks.map((entry) => ({
      ...entry,
      editorId: crypto.randomUUID()
    }))
  }));
  const [fonts, setFonts] = useState<string[]>([]);
  const [fontsLoading, setFontsLoading] = useState(false);
  const [fontsError, setFontsError] = useState(false);
  const themeGroups = groupThemeNames(themeNames, t('customThemes'));

  const loadFonts = (): void => {
    setFontsLoading(true);
    setFontsError(false);
    void window.geared
      .listSystemFonts()
      .then(setFonts)
      .catch(() => setFontsError(true))
      .finally(() => setFontsLoading(false));
  };

  useEffect(() => loadFonts(), []);

  useEffect(() => {
    setDraft((current) => ({
      ...current,
      ...settings,
      terminalFontFallbacks: settings.terminalFontFallbacks.map((entry, index) => ({
        ...entry,
        editorId: current.terminalFontFallbacks[index]?.editorId ?? crypto.randomUUID()
      }))
    }));
  }, [settings]);

  const update = <K extends keyof SettingsRecord>(key: K, value: SettingsRecord[K]): void => {
    setDraft((current) => ({ ...current, [key]: value }));
    void onSave({ [key]: value }).catch(() => undefined);
  };

  const updateFallback = (index: number, patch: Partial<TerminalFontFallbackEntry>): void => {
    setDraft((current) => ({
      ...current,
      terminalFontFallbacks: current.terminalFontFallbacks.map((entry, position) =>
        position === index ? { ...entry, ...patch } : entry
      )
    }));
    const next = draft.terminalFontFallbacks.map((entry, position) =>
      position === index ? { ...entry, ...patch } : entry
    );
    void onSave({
      terminalFontFallbacks: normalizeTerminalFontFallbacks(
        draft.terminalFontFamily,
        persistedFallbackFonts(next)
      )
    }).catch(() => undefined);
  };

  const moveFallback = (index: number, direction: -1 | 1): void => {
    const next = [...draft.terminalFontFallbacks];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    const [value] = next.splice(index, 1);
    if (value) next.splice(target, 0, value);
    setDraft((current) => ({ ...current, terminalFontFallbacks: next }));
    void onSave({
      terminalFontFallbacks: normalizeTerminalFontFallbacks(
        draft.terminalFontFamily,
        persistedFallbackFonts(next)
      )
    }).catch(() => undefined);
  };

  const commitFallbacks = (entries: EditableFallbackFont[]): void => {
    setDraft((current) => ({ ...current, terminalFontFallbacks: entries }));
    void onSave({
      terminalFontFallbacks: normalizeTerminalFontFallbacks(
        draft.terminalFontFamily,
        persistedFallbackFonts(entries)
      )
    }).catch(() => undefined);
  };

  return (
    <Section title={t('groupAppearance')}>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={draft.minimalMode}
          onChange={(event) => {
            const minimalMode = event.target.checked;
            update('minimalMode', minimalMode);
          }}
        />
        <span>{t('minimalMode')}</span>
      </label>
      <Row label={t('windowEffect')} hint={t('windowEffectDescription')}>
        <select
          className="settings-select"
          value={draft.windowEffect}
          onChange={(event) => {
            const windowEffect = event.target.value as SettingsRecord['windowEffect'];
            update('windowEffect', windowEffect);
          }}
        >
          <option value="solid">{t('windowEffectSolid')}</option>
          <option value="translucent">{t('windowEffectTranslucent')}</option>
          <option value="frosted">{t('windowEffectFrosted')}</option>
        </select>
      </Row>
      <Row label={t('windowBackgroundOpacity')}>
        <Stepper
          value={draft.windowBackgroundOpacityPercent}
          min={0}
          max={100}
          step={5}
          format={(value) => `${value}%`}
          onChange={(windowBackgroundOpacityPercent) => {
            update('windowBackgroundOpacityPercent', windowBackgroundOpacityPercent);
          }}
        />
      </Row>
      {appInfo && settings.windowEffect === 'frosted' && !isFrostedGlassSupported(appInfo) ? (
        <p className="settings-hint" role="status">
          {t('frostedUnavailable')}
        </p>
      ) : null}
      {appInfo &&
      (settings.windowEffect === 'solid') !== (appInfo.mainWindowEffectAtLaunch === 'solid') ? (
        <p className="settings-warning" role="status">
          {t('windowRestartRequired')}
        </p>
      ) : null}
      <Row label={t('theme')}>
        <select
          className="settings-select"
          value={draft.theme}
          onChange={(event) => {
            const theme = event.target.value;
            update('theme', theme);
          }}
        >
          {themeGroups.map((group) => (
            <optgroup key={group.id} label={group.label}>
              {group.themes.map((theme) => (
                <option key={theme} value={theme}>
                  {theme}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </Row>
      {invalidThemes.length > 0 ? (
        <p className="settings-warning">
          {t('invalidThemes')} {invalidThemes.map((entry) => entry.file).join(', ')}
        </p>
      ) : null}
      <Row label={t('uiFontFamily')}>
        <FontPicker
          value={draft.uiFontFamily}
          fonts={fonts}
          label={t('uiFontFamily')}
          t={t}
          includeSystemDefault
          loading={fontsLoading}
          loadError={fontsError}
          onRetry={loadFonts}
          onCommit={(value) => update('uiFontFamily', value)}
        />
      </Row>
      <Row label={t('uiFontSize')}>
        <Stepper
          value={draft.uiFontSize}
          min={10}
          max={24}
          onChange={(value) => update('uiFontSize', value)}
        />
      </Row>
      <Row label={t('uiScalePercent')}>
        <Stepper
          value={draft.uiScalePercent}
          min={75}
          max={150}
          step={5}
          format={(value) => `${value}%`}
          onChange={(value) => update('uiScalePercent', value)}
        />
      </Row>
      <Row label={t('terminalFontFamily')}>
        <FontPicker
          value={draft.terminalFontFamily}
          fonts={fonts}
          label={t('terminalFontFamily')}
          t={t}
          loading={fontsLoading}
          loadError={fontsError}
          onRetry={loadFonts}
          onCommit={(terminalFontFamily) => update('terminalFontFamily', terminalFontFamily)}
        />
      </Row>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={draft.terminalFontLigatures}
          onChange={(event) => update('terminalFontLigatures', event.target.checked)}
        />
        <span>{t('fontLigatures')}</span>
      </label>
      <p className="settings-hint">{t('fontLigaturesHint')}</p>
      <Row label={t('fontSize')}>
        <Stepper
          value={draft.terminalFontSize}
          min={8}
          max={32}
          onChange={(value) => update('terminalFontSize', value)}
        />
      </Row>
      <Row label={t('lineHeight')}>
        <Stepper
          value={draft.terminalLineHeight}
          min={1}
          max={2}
          step={0.05}
          format={(value) => `${value.toFixed(2)}×`}
          onChange={(value) => update('terminalLineHeight', value)}
        />
      </Row>
      <Row label={t('terminalPadding')}>
        <Stepper
          value={draft.terminalPadding}
          min={0}
          max={32}
          step={1}
          format={(value) => `${value}px`}
          onChange={(value) => update('terminalPadding', value)}
        />
      </Row>
      <p className="settings-hint">{t('terminalPaddingHint')}</p>
      <Row label={t('fullScreenTerminalPadding')}>
        <Stepper
          value={draft.fullScreenTerminalPadding}
          min={0}
          max={32}
          step={1}
          format={(value) => `${value}px`}
          onChange={(value) => update('fullScreenTerminalPadding', value)}
        />
      </Row>
      <p className="settings-hint">{t('fullScreenTerminalPaddingHint')}</p>
      <div className="settings-section-body">
        <p className="settings-subheading">{t('fallbackFonts')}</p>
        <div className="settings-fallbacks">
          {draft.terminalFontFallbacks.map((entry, index) => (
            <div className="settings-fallback-row" key={entry.editorId}>
              <FontPicker
                value={entry.name}
                fonts={fonts}
                label={`Fallback font ${index + 1}`}
                t={t}
                loading={fontsLoading}
                loadError={fontsError}
                onRetry={loadFonts}
                onCommit={(name) => {
                  const next = draft.terminalFontFallbacks.map((item, position) =>
                    position === index ? { ...item, name } : item
                  );
                  commitFallbacks(next);
                }}
              />
              <label>
                {t('fontScale')}
                <input
                  type="number"
                  min={0.5}
                  max={2}
                  step={0.05}
                  value={entry.scale}
                  onChange={(event) => {
                    const value = event.currentTarget.valueAsNumber;
                    if (Number.isFinite(value) && value >= 0.5 && value <= 2) {
                      updateFallback(index, { scale: value });
                    }
                  }}
                />
              </label>
              <label>
                {t('offsetX')}
                <input
                  type="number"
                  min={-10}
                  max={10}
                  step={1}
                  value={entry.offsetX}
                  onChange={(event) => {
                    const value = event.currentTarget.valueAsNumber;
                    if (Number.isInteger(value) && value >= -10 && value <= 10) {
                      updateFallback(index, { offsetX: value });
                    }
                  }}
                />
              </label>
              <label>
                {t('offsetY')}
                <input
                  type="number"
                  min={-10}
                  max={10}
                  step={1}
                  value={entry.offsetY}
                  onChange={(event) => {
                    const value = event.currentTarget.valueAsNumber;
                    if (Number.isInteger(value) && value >= -10 && value <= 10) {
                      updateFallback(index, { offsetY: value });
                    }
                  }}
                />
              </label>
              <button
                type="button"
                className="icon-button"
                aria-label={t('moveUp')}
                disabled={index === 0}
                onClick={() => moveFallback(index, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={t('moveDown')}
                disabled={index === draft.terminalFontFallbacks.length - 1}
                onClick={() => moveFallback(index, 1)}
              >
                ↓
              </button>
              <button
                type="button"
                className="icon-button danger"
                aria-label={t('remove')}
                onClick={() =>
                  commitFallbacks(
                    draft.terminalFontFallbacks.filter((_, position) => position !== index)
                  )
                }
              >
                ×
              </button>
            </div>
          ))}
          {draft.terminalFontFallbacks.length < 8 ? (
            <button
              type="button"
              className="chip"
              onClick={() =>
                setDraft((current) => ({
                  ...current,
                  terminalFontFallbacks: [
                    ...draft.terminalFontFallbacks,
                    { name: '', scale: 1, offsetX: 0, offsetY: 0, editorId: crypto.randomUUID() }
                  ]
                }))
              }
            >
              <Plus size={12} aria-hidden="true" /> {t('addFallback')}
            </button>
          ) : null}
        </div>
      </div>
      <div className="settings-actions-row">
        <button
          type="button"
          className="toolbar-button"
          onClick={() => void window.geared.openThemesFolder()}
        >
          <FolderOpen size={13} aria-hidden="true" /> {t('themeFolder')}
        </button>
      </div>
    </Section>
  );
}

export function TerminalSection({
  settings,
  onSave,
  t
}: {
  settings: SettingsRecord;
  onSave: (patch: Partial<SettingsRecord>) => Promise<boolean>;
  t: Translate;
}): React.JSX.Element {
  const [profiles, setProfiles] = useState<import('@geared-term/protocol').SessionProfileRecord[]>(
    []
  );
  const [draft, setDraft] = useState({
    defaultTerm: settings.defaultTerm,
    terminalCursor: settings.terminalCursor,
    newTabProfileId: settings.newTabProfileId
  });
  useEffect(() => {
    void window.geared.listProfiles().then(setProfiles);
  }, []);
  useEffect(() => {
    setDraft({
      defaultTerm: settings.defaultTerm,
      terminalCursor: settings.terminalCursor,
      newTabProfileId: settings.newTabProfileId
    });
  }, [settings.defaultTerm, settings.terminalCursor, settings.newTabProfileId]);
  const update = (patch: Partial<typeof draft>): void => {
    setDraft((current) => ({ ...current, ...patch }));
    void onSave(patch).catch(() => undefined);
  };
  return (
    <Section title={t('groupTerminal')}>
      <label className="settings-check">
        <input
          type="checkbox"
          checked={settings.showTerminalContextMenuOnRightClick}
          onChange={(event) =>
            void onSave({ showTerminalContextMenuOnRightClick: event.target.checked }).catch(
              () => undefined
            )
          }
        />
        <span>{t('terminalContextMenuOnRightClick')}</span>
      </label>
      <Row label={t('newTabOpens')} hint={t('newTabOpensHint')}>
        <select
          className="settings-select"
          value={draft.newTabProfileId ?? ''}
          onChange={(event) => {
            const value = event.target.value || null;
            update({ newTabProfileId: value as string | null });
          }}
        >
          <option value="">{t('newTabTargetLocalShell')}</option>
          {profiles.map((p) => (
            <option value={p.id} key={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Row>
      <Row label={t('defaultTerm')}>
        <select
          className="settings-select"
          value={draft.defaultTerm}
          onChange={(event) =>
            update({ defaultTerm: event.target.value as SettingsRecord['defaultTerm'] })
          }
        >
          <option value="xterm-256color">xterm-256color</option>
          <option value="xterm">xterm</option>
          <option value="vt520">vt520</option>
          <option value="linux">linux</option>
          <option value="screen">screen</option>
        </select>
      </Row>
      <Row label={t('cursor')}>
        <div className="segmented" role="group" aria-label={t('cursor')}>
          {(
            [
              { value: 'block', label: t('cursorBlock') },
              { value: 'underline', label: t('cursorUnderline') },
              { value: 'bar', label: t('cursorBar') }
            ] as const
          ).map((option) => (
            <button
              type="button"
              key={option.value}
              className={draft.terminalCursor === option.value ? 'active' : ''}
              aria-pressed={draft.terminalCursor === option.value}
              onClick={() => update({ terminalCursor: option.value })}
            >
              {option.label}
            </button>
          ))}
        </div>
      </Row>
    </Section>
  );
}

export function SftpSection({
  settings,
  onSave,
  t
}: {
  settings: SettingsRecord;
  onSave: (patch: Partial<SettingsRecord>) => Promise<boolean>;
  t: Translate;
}): React.JSX.Element {
  const [draft, setDraft] = useState(settings.remoteFileCommands);
  const [status, setStatus] = useState<string | null>(null);
  return (
    <Section title={t('groupSftp')}>
      <p className="settings-hint">
        <FolderSync size={13} aria-hidden="true" /> {t('remoteCommandsHint')}
      </p>
      <Row label={t('remoteCommands')}>
        <textarea
          className="settings-textarea"
          rows={6}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value.slice(0, 4096));
            setStatus(null);
          }}
          placeholder="cat&#10;less"
          spellCheck={false}
        />
      </Row>
      <div className="settings-actions-row">
        <button
          type="button"
          className="primary-button settings-apply"
          onClick={() => {
            void onSave({ remoteFileCommands: draft }).then((saved) => {
              if (saved) setStatus(t('sftpStatus'));
            });
          }}
        >
          {t('apply')}
        </button>
        {status ? <span className="settings-status status-ok">{status}</span> : null}
      </div>
    </Section>
  );
}

export function AiAssistantSection({
  settings,
  onSave,
  t
}: {
  settings: SettingsRecord;
  onSave: (patch: Partial<SettingsRecord>) => Promise<boolean>;
  t: Translate;
}): React.JSX.Element {
  const [draft, setDraft] = useState(settings.globalAiInstructions);
  const [status, setStatus] = useState<string | null>(null);
  return (
    <Section title={t('groupAssistant')}>
      <p className="settings-hint">{t('aiInstructions')}</p>
      <textarea
        className="settings-textarea"
        rows={10}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value.slice(0, 8192));
          setStatus(null);
        }}
        spellCheck={false}
      />
      <div className="settings-actions-row">
        <button
          type="button"
          className="toolbar-button"
          onClick={() => {
            setDraft(settings.globalAiInstructions);
            setStatus(null);
          }}
        >
          {t('reset')}
        </button>
        <button
          type="button"
          className="primary-button settings-apply"
          onClick={() => {
            void onSave({ globalAiInstructions: draft }).then((saved) => {
              if (saved) setStatus(t('aiInstructionsStatus'));
            });
          }}
        >
          {t('save')}
        </button>
        {status ? <span className="settings-status status-ok">{status}</span> : null}
      </div>
    </Section>
  );
}

const homebrewUpgradeCommand = 'brew upgrade --cask geared-term';

export function AboutSection({
  settings,
  info,
  runtime,
  updateStatus,
  onSave,
  onCheckUpdates,
  onDownloadUpdate,
  onInstallUpdate,
  onOpenRelease,
  t
}: {
  settings: SettingsRecord;
  info: AppInfo | null;
  runtime: RuntimeInfo | null;
  updateStatus: UpdateStatus | null;
  onSave: (patch: Partial<SettingsRecord>) => Promise<boolean>;
  onCheckUpdates: () => Promise<void>;
  onDownloadUpdate: () => Promise<void>;
  onInstallUpdate: () => void;
  onOpenRelease: () => void;
  t: Translate;
}): React.JSX.Element {
  const updateMessage = (() => {
    switch (updateStatus?.state) {
      case 'checking':
        return t('checkingForUpdates');
      case 'up-to-date':
        return t('upToDate');
      case 'available':
        return updateStatus.error
          ? t('updateDownloadFailed')
          : `${t('updateAvailable')} (${updateStatus.latestSha?.slice(0, 7) ?? ''})`;
      case 'downloading':
        return t('downloadingUpdate');
      case 'downloaded':
        return t('downloadedUpdate');
      case 'error':
        return t('updateCheckFailed');
      default:
        return null;
    }
  })();

  return (
    <Section title={t('groupAbout')}>
      <div className="settings-about-header">
        <img className="settings-about-icon" src={gearedTermMark} alt="" aria-hidden="true" />
        <div className="settings-about-meta">
          <p className="settings-about-line">
            {info ? `${info.name} ${info.version} (${__APP_COMMIT__.slice(0, 7)})` : ''}
            {info ? ` · ${t('platform')}: ${info.platform}` : ''}
          </p>
          {runtime ? (
            <p className="settings-about-line">
              Electron {runtime.electron} · Chromium {runtime.chrome} · Node {runtime.node}
            </p>
          ) : null}
          {runtime ? <p className="settings-about-path">{runtime.configDirectory}</p> : null}
          {info?.isPackaged && info.installChannel === 'homebrew-cask' ? (
            <p className="settings-about-path">
              {t('homebrewUpgradeHint')}{' '}
              <code className="settings-about-command">{homebrewUpgradeCommand}</code>
            </p>
          ) : null}
        </div>
      </div>
      <div className="settings-update-preferences">
        <label className="settings-check">
          <input
            type="checkbox"
            checked={settings.autoCheckUpdates}
            onChange={(event) =>
              void onSave({ autoCheckUpdates: event.target.checked }).catch(() => undefined)
            }
          />
          <span>{t('autoCheckUpdates')}</span>
        </label>
        <p className="settings-hint">{t('autoCheckUpdatesHint')}</p>
      </div>
      <div className="settings-actions-row">
        {info?.isPackaged ? (
          <>
            <button
              type="button"
              className="toolbar-button"
              disabled={updateStatus?.state === 'checking' || updateStatus?.state === 'downloading'}
              onClick={() => void onCheckUpdates()}
            >
              {t('checkForUpdates')}
            </button>
            {updateStatus?.state === 'downloaded' && updateStatus.canInstall ? (
              <button type="button" className="primary-button" onClick={onInstallUpdate}>
                {t('restartToInstall')}
              </button>
            ) : null}
            {updateStatus?.state === 'available' && updateStatus.canInstall ? (
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  void onDownloadUpdate().catch(() => undefined);
                }}
              >
                {t('downloadUpdate')}
              </button>
            ) : null}
            {updateStatus?.state !== 'downloaded' ? (
              <button type="button" className="toolbar-button" onClick={onOpenRelease}>
                {t('downloadNightly')}
              </button>
            ) : null}
            {updateStatus?.state === 'downloading' ? (
              <progress
                className="update-progress"
                max={100}
                value={updateStatus.progress ?? 0}
                aria-label={t('downloadingUpdate')}
              />
            ) : null}
            {updateMessage ? <span className="settings-status">{updateMessage}</span> : null}
          </>
        ) : null}
        <button
          type="button"
          className="toolbar-button"
          onClick={() => void window.geared.openConfigFolder()}
        >
          <FolderOpen size={13} aria-hidden="true" /> {t('openConfigFolder')}
        </button>
        <button
          type="button"
          className="toolbar-button"
          onClick={() => void window.geared.openThemesFolder()}
        >
          <FolderOpen size={13} aria-hidden="true" /> {t('themeFolder')}
        </button>
      </div>
    </Section>
  );
}
