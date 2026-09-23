import { useState } from 'react';
import { normalizeTerminalFontFallbacks } from '@geared-term/protocol';
import type {
  AppInfo,
  InvalidThemeFile,
  RuntimeInfo,
  SettingsRecord,
  UpdateStatus,
  TerminalFontFallbackEntry
} from '@geared-term/protocol';
import { FolderOpen, FolderSync, Plus } from 'lucide-react';
import { settingsLocale, translate } from '../i18n';
import gearedTermMark from '../assets/geared-term-mark.png';
import { Row, Section, Stepper } from './primitives';

export type Translate = (key: Parameters<typeof translate>[1]) => string;

export function makeTranslate(language: SettingsRecord['language']): Translate {
  void settingsLocale(language);
  return (key) => translate(language, key);
}

export function GeneralSection({
  settings,
  onSave,
  t
}: {
  settings: SettingsRecord;
  onSave: (patch: Partial<SettingsRecord>) => Promise<void>;
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
  themeNames,
  invalidThemes,
  onSave,
  t
}: {
  settings: SettingsRecord;
  themeNames: string[];
  invalidThemes: InvalidThemeFile[];
  onSave: (patch: Partial<SettingsRecord>) => Promise<void>;
  t: Translate;
}): React.JSX.Element {
  const [draft, setDraft] = useState<SettingsRecord>(() => ({
    ...settings,
    terminalFontFallbacks: settings.terminalFontFallbacks.map((entry) => ({ ...entry }))
  }));
  const [status, setStatus] = useState<string | null>(null);

  const update = <K extends keyof SettingsRecord>(key: K, value: SettingsRecord[K]): void => {
    setDraft((current) => ({ ...current, [key]: value }));
    setStatus(null);
  };

  const updateFallback = (index: number, patch: Partial<TerminalFontFallbackEntry>): void => {
    setDraft((current) => ({
      ...current,
      terminalFontFallbacks: current.terminalFontFallbacks.map((entry, position) =>
        position === index ? { ...entry, ...patch } : entry
      )
    }));
  };

  const moveFallback = (index: number, direction: -1 | 1): void => {
    setDraft((current) => {
      const next = [...current.terminalFontFallbacks];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      const moved = [...next];
      const value = moved[index] as TerminalFontFallbackEntry;
      moved.splice(index, 1);
      moved.splice(target, 0, value);
      return { ...current, terminalFontFallbacks: moved };
    });
  };

  const apply = async (): Promise<void> => {
    await onSave({
      theme: draft.theme,
      uiFontFamily: draft.uiFontFamily,
      uiFontSize: draft.uiFontSize,
      terminalFontFamily: draft.terminalFontFamily.trim() || 'Cascadia Code',
      terminalFontLigatures: draft.terminalFontLigatures,
      terminalFontSize: draft.terminalFontSize,
      terminalLineHeight: draft.terminalLineHeight,
      terminalFontFallbacks: normalizeTerminalFontFallbacks(
        draft.terminalFontFamily,
        draft.terminalFontFallbacks
      )
    });
    setStatus(t('appearanceStatus'));
  };

  return (
    <Section title={t('groupAppearance')}>
      <Row label={t('theme')}>
        <select
          className="settings-select"
          value={draft.theme}
          onChange={(event) => update('theme', event.target.value)}
        >
          {themeNames.map((theme) => (
            <option key={theme} value={theme}>
              {theme}
            </option>
          ))}
        </select>
      </Row>
      {invalidThemes.length > 0 ? (
        <p className="settings-warning">
          {t('invalidThemes')} {invalidThemes.map((entry) => entry.file).join(', ')}
        </p>
      ) : null}
      <Row label={t('uiFontFamily')}>
        <input
          className="settings-input"
          value={draft.uiFontFamily}
          onChange={(event) => update('uiFontFamily', event.target.value.slice(0, 256))}
          placeholder={t('placeholderSystemDefault')}
          spellCheck={false}
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
      <Row label={t('terminalFontFamily')}>
        <input
          className="settings-input"
          value={draft.terminalFontFamily}
          onChange={(event) => update('terminalFontFamily', event.target.value.slice(0, 256))}
          spellCheck={false}
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
      <div className="settings-section-body">
        <p className="settings-subheading">{t('fallbackFonts')}</p>
        <div className="settings-fallbacks">
          {draft.terminalFontFallbacks.map((entry, index) => (
            <div className="settings-fallback-row" key={index}>
              <input
                value={entry.name}
                aria-label={`Fallback font ${index + 1}`}
                onChange={(event) =>
                  updateFallback(index, { name: event.target.value.slice(0, 128) })
                }
                spellCheck={false}
              />
              <label>
                {t('fontScale')}
                <input
                  type="number"
                  min={0.5}
                  max={2}
                  step={0.05}
                  value={entry.scale}
                  onChange={(event) =>
                    updateFallback(index, {
                      scale: Math.min(2, Math.max(0.5, Number(event.target.value) || 1))
                    })
                  }
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
                  onChange={(event) =>
                    updateFallback(index, {
                      offsetX: Math.round(
                        Math.min(10, Math.max(-10, Number(event.target.value) || 0))
                      )
                    })
                  }
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
                  onChange={(event) =>
                    updateFallback(index, {
                      offsetY: Math.round(
                        Math.min(10, Math.max(-10, Number(event.target.value) || 0))
                      )
                    })
                  }
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
                  update(
                    'terminalFontFallbacks',
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
                update('terminalFontFallbacks', [
                  ...draft.terminalFontFallbacks,
                  { name: '', scale: 1, offsetX: 0, offsetY: 0 }
                ])
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
          className="primary-button settings-apply"
          onClick={() => void apply()}
        >
          {t('apply')}
        </button>
        <button
          type="button"
          className="toolbar-button"
          onClick={() => void window.geared.openThemesFolder()}
        >
          <FolderOpen size={13} aria-hidden="true" /> {t('themeFolder')}
        </button>
        {status ? <span className="settings-status status-ok">{status}</span> : null}
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
  onSave: (patch: Partial<SettingsRecord>) => Promise<void>;
  t: Translate;
}): React.JSX.Element {
  const [draft, setDraft] = useState({
    defaultTerm: settings.defaultTerm,
    terminalCursor: settings.terminalCursor
  });
  const [status, setStatus] = useState<string | null>(null);
  const update = (patch: Partial<typeof draft>): void => {
    setDraft((current) => ({ ...current, ...patch }));
    setStatus(null);
  };
  return (
    <Section title={t('groupTerminal')}>
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
      <div className="settings-actions-row">
        <button
          type="button"
          className="primary-button settings-apply"
          onClick={() => {
            void onSave(draft).then(() => setStatus(t('terminalStatus')));
          }}
        >
          {t('apply')}
        </button>
        {status ? <span className="settings-status status-ok">{status}</span> : null}
      </div>
    </Section>
  );
}

export function SftpSection({
  settings,
  onSave,
  t
}: {
  settings: SettingsRecord;
  onSave: (patch: Partial<SettingsRecord>) => Promise<void>;
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
            void onSave({ remoteFileCommands: draft }).then(() => setStatus(t('sftpStatus')));
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
  onSave: (patch: Partial<SettingsRecord>) => Promise<void>;
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
            void onSave({ globalAiInstructions: draft }).then(() =>
              setStatus(t('aiInstructionsStatus'))
            );
          }}
        >
          {t('save')}
        </button>
        {status ? <span className="settings-status status-ok">{status}</span> : null}
      </div>
    </Section>
  );
}

export function AboutSection({
  info,
  runtime,
  updateStatus,
  onCheckUpdates,
  onInstallUpdate,
  onOpenRelease,
  t
}: {
  info: AppInfo | null;
  runtime: RuntimeInfo | null;
  updateStatus: UpdateStatus | null;
  onCheckUpdates: () => Promise<void>;
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
        return `${t('updateAvailable')} (${updateStatus.latestSha?.slice(0, 7) ?? ''})`;
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
        </div>
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
