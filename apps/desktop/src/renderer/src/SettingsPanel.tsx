import { useState } from 'react';
import { normalizeTerminalFontFallbacks } from '@geared-term/protocol';
import type {
  AppInfo,
  InvalidThemeFile,
  RuntimeInfo,
  SettingsRecord,
  TerminalFontFallbackEntry
} from '@geared-term/protocol';
import { useModalFocus } from './useModalFocus';
import { settingsLocale, translate } from './i18n';

type SettingsPanelProps = {
  settings: SettingsRecord;
  themeNames: string[];
  invalidThemes: InvalidThemeFile[];
  info: AppInfo | null;
  runtime: RuntimeInfo | null;
  onSave: (settings: SettingsRecord) => Promise<void>;
  onOpenAssistant: () => void;
  onOpenProfiles: () => void;
  onClose: () => void;
};

type Draft = SettingsRecord & { terminalFontFallbacks: TerminalFontFallbackEntry[] };

export function SettingsPanel({
  settings,
  themeNames,
  invalidThemes,
  info,
  runtime,
  onSave,
  onOpenAssistant,
  onOpenProfiles,
  onClose
}: SettingsPanelProps): React.JSX.Element {
  const [draft, setDraft] = useState<Draft>(() => ({
    ...settings,
    terminalFontFallbacks: settings.terminalFontFallbacks.map((entry) => ({ ...entry }))
  }));
  const [saving, setSaving] = useState(false);
  const { containerRef } = useModalFocus<HTMLFormElement>();
  const locale = settingsLocale(draft.language);
  const t = (key: Parameters<typeof translate>[1]): string => translate(draft.language, key);

  const update = <K extends keyof Draft>(key: K, value: Draft[K]): void => {
    setDraft((current) => ({ ...current, [key]: value }));
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

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSaving(true);
    try {
      await onSave({
        ...draft,
        terminalFontFamily: draft.terminalFontFamily.trim() || 'Cascadia Code',
        terminalFontFallbacks: normalizeTerminalFontFallbacks(
          draft.terminalFontFamily,
          draft.terminalFontFallbacks
        )
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-backdrop" role="presentation" onMouseDown={onClose}>
      <form
        ref={containerRef}
        className="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onSubmit={(event) => void submit(event)}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="settings-header">
          <h2 id="settings-title">{t('settings')}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t('close')}>
            ×
          </button>
        </div>
        <div className="settings-body">
          <section className="settings-group">
            <h3>{t('groupGeneral')}</h3>
            <div className="settings-grid">
              <label>
                {t('language')}
                <select
                  value={draft.language}
                  onChange={(event) =>
                    update('language', event.target.value as SettingsRecord['language'])
                  }
                >
                  <option value="system">{t('systemLanguage')}</option>
                  <option value="en-US">{t('english')}</option>
                  <option value="zh-CN">{t('chinese')}</option>
                </select>
              </label>
            </div>
          </section>

          <section className="settings-group">
            <h3>{t('groupAppearance')}</h3>
            <div className="settings-grid">
              <label>
                {t('theme')}
                <select
                  value={draft.theme}
                  onChange={(event) => update('theme', event.target.value)}
                >
                  {themeNames.map((theme) => (
                    <option key={theme} value={theme}>
                      {theme}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t('uiFontFamily')}
                <input
                  value={draft.uiFontFamily}
                  onChange={(event) => update('uiFontFamily', event.target.value.slice(0, 256))}
                  placeholder="system default"
                  spellCheck={false}
                />
              </label>
              <label>
                {t('uiFontSize')}
                <input
                  type="number"
                  min={10}
                  max={24}
                  step={1}
                  value={draft.uiFontSize}
                  onChange={(event) =>
                    update(
                      'uiFontSize',
                      Math.min(24, Math.max(10, Number(event.target.value) || 13))
                    )
                  }
                />
              </label>
              <div className="settings-wide">
                {invalidThemes.length > 0 ? (
                  <p className="settings-warning">
                    {t('invalidThemes')} {invalidThemes.map((entry) => entry.file).join(', ')}
                  </p>
                ) : null}
                <button
                  type="button"
                  className="toolbar-button"
                  onClick={() => void window.geared.openThemesFolder()}
                >
                  {t('themeFolder')}
                </button>
              </div>
            </div>
          </section>

          <section className="settings-group">
            <h3>{t('groupTerminal')}</h3>
            <div className="settings-grid">
              <label>
                {t('terminalFontFamily')}
                <input
                  value={draft.terminalFontFamily}
                  onChange={(event) =>
                    update('terminalFontFamily', event.target.value.slice(0, 256))
                  }
                  spellCheck={false}
                />
              </label>
              <label>
                {t('fontSize')}
                <input
                  type="number"
                  min={8}
                  max={32}
                  step={1}
                  value={draft.terminalFontSize}
                  onChange={(event) =>
                    update(
                      'terminalFontSize',
                      Math.min(32, Math.max(8, Number(event.target.value) || 14))
                    )
                  }
                />
              </label>
              <label>
                {t('lineHeight')}
                <input
                  type="number"
                  min={1}
                  max={2}
                  step={0.05}
                  value={draft.terminalLineHeight}
                  onChange={(event) =>
                    update(
                      'terminalLineHeight',
                      Math.min(2, Math.max(1, Number(event.target.value) || 1))
                    )
                  }
                />
              </label>
              <label>
                {t('cursor')}
                <select
                  value={draft.terminalCursor}
                  onChange={(event) =>
                    update('terminalCursor', event.target.value as SettingsRecord['terminalCursor'])
                  }
                >
                  <option value="block">{t('cursorBlock')}</option>
                  <option value="underline">{t('cursorUnderline')}</option>
                  <option value="bar">{t('cursorBar')}</option>
                </select>
              </label>
              <label>
                {t('defaultTerm')}
                <select
                  value={draft.defaultTerm}
                  onChange={(event) =>
                    update('defaultTerm', event.target.value as SettingsRecord['defaultTerm'])
                  }
                >
                  <option value="xterm-256color">xterm-256color</option>
                  <option value="xterm">xterm</option>
                  <option value="vt520">vt520</option>
                  <option value="linux">linux</option>
                  <option value="screen">screen</option>
                </select>
              </label>
              <label>
                {t('contextLines')}
                <input
                  type="number"
                  min={0}
                  max={2000}
                  step={10}
                  value={draft.terminalContextPrecedingLines}
                  onChange={(event) =>
                    update(
                      'terminalContextPrecedingLines',
                      Math.min(2000, Math.max(0, Number(event.target.value) || 0))
                    )
                  }
                />
              </label>
              <label className="settings-checkbox">
                <input
                  type="checkbox"
                  checked={draft.splitCommandPresentation}
                  onChange={(event) => update('splitCommandPresentation', event.target.checked)}
                />
                <span>{t('splitCommands')}</span>
              </label>
            </div>
            <p className="settings-subheading">{t('fallbackFonts')}</p>
            <div className="settings-fallbacks">
              {draft.terminalFontFallbacks.map((entry, index) => (
                <div className="settings-fallback-row" key={`${entry.name}-${index}`}>
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
                  className="toolbar-button"
                  onClick={() =>
                    update('terminalFontFallbacks', [
                      ...draft.terminalFontFallbacks,
                      { name: '', scale: 1, offsetX: 0, offsetY: 0 }
                    ])
                  }
                >
                  {t('addFallback')}
                </button>
              ) : null}
            </div>
          </section>

          <section className="settings-group">
            <h3>{t('groupSftp')}</h3>
            <label className="settings-wide">
              {t('remoteCommands')}
              <textarea
                rows={4}
                value={draft.remoteFileCommands}
                onChange={(event) =>
                  update('remoteFileCommands', event.target.value.slice(0, 4096))
                }
                placeholder="cat&#10;less"
                spellCheck={false}
              />
              <small>{t('remoteCommandsHint')}</small>
            </label>
          </section>

          <section className="settings-group">
            <h3>{t('groupAssistant')}</h3>
            <label className="settings-wide">
              {t('aiInstructions')}
              <textarea
                rows={3}
                value={draft.globalAiInstructions}
                onChange={(event) =>
                  update('globalAiInstructions', event.target.value.slice(0, 8192))
                }
                spellCheck={false}
              />
            </label>
            <div className="settings-actions-row">
              <button
                type="button"
                className="toolbar-button"
                onClick={() => {
                  onOpenAssistant();
                  onClose();
                }}
              >
                {t('manageConnections')}
              </button>
              <button
                type="button"
                className="toolbar-button"
                onClick={() => {
                  onOpenProfiles();
                  onClose();
                }}
              >
                {t('manageVault')}
              </button>
            </div>
          </section>

          <section className="settings-group">
            <h3>{t('groupAbout')}</h3>
            <p className="settings-about-line">
              {info ? `${info.name} ${info.version} (${info.platform})` : ''}
              {runtime ? ` · Electron ${runtime.electron} · Node ${runtime.node}` : ''}
            </p>
            {runtime ? (
              <>
                <p className="settings-about-path">{runtime.configDirectory}</p>
                <div className="settings-actions-row">
                  <button
                    type="button"
                    className="toolbar-button"
                    onClick={() => void window.geared.openConfigFolder()}
                  >
                    {t('openConfigFolder')}
                  </button>
                  <button
                    type="button"
                    className="toolbar-button"
                    onClick={() => void window.geared.openThemesFolder()}
                  >
                    {t('themeFolder')}
                  </button>
                </div>
              </>
            ) : null}
          </section>
        </div>
        <div className="settings-actions">
          <button type="button" className="toolbar-button" data-modal-cancel onClick={onClose}>
            {locale === 'zh-CN' ? '取消' : 'Cancel'}
          </button>
          <button type="submit" className="primary-button settings-save" disabled={saving}>
            {saving ? '…' : t('save')}
          </button>
        </div>
      </form>
    </div>
  );
}
