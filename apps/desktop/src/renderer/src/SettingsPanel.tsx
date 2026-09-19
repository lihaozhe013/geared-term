import { useState } from 'react';
import type { SettingsRecord } from '@geared-term/protocol';
import { settingsLocale, translate } from './i18n';

type SettingsPanelProps = {
  settings: SettingsRecord;
  onSave: (settings: SettingsRecord) => Promise<void>;
  onClose: () => void;
};

const themes = ['Geared Dark', 'Midnight', 'Light'];

export function SettingsPanel({
  settings,
  onSave,
  onClose
}: SettingsPanelProps): React.JSX.Element {
  const [draft, setDraft] = useState(settings);
  const [saving, setSaving] = useState(false);
  const locale = settingsLocale(draft.language);
  const t = (key: Parameters<typeof translate>[1]): string => translate(draft.language, key);

  const update = <K extends keyof SettingsRecord>(key: K, value: SettingsRecord[K]): void => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSaving(true);
    try {
      await onSave(draft);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-backdrop" role="presentation" onMouseDown={onClose}>
      <form
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
          <label>
            {t('theme')}
            <select value={draft.theme} onChange={(event) => update('theme', event.target.value)}>
              {themes.map((theme) => (
                <option key={theme} value={theme}>
                  {theme}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('fontSize')}
            <input
              type="number"
              min={8}
              max={32}
              step={1}
              value={draft.terminalFontSize}
              onChange={(event) => update('terminalFontSize', Number(event.target.value))}
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
              onChange={(event) => update('terminalLineHeight', Number(event.target.value))}
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
                update('terminalContextPrecedingLines', Number(event.target.value))
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
          <label className="settings-wide">
            {t('remoteCommands')}
            <textarea
              rows={4}
              value={draft.remoteFileCommands}
              onChange={(event) => update('remoteFileCommands', event.target.value.slice(0, 4096))}
              placeholder="cat&#10;less"
              spellCheck={false}
            />
            <small>{t('remoteCommandsHint')}</small>
          </label>
        </div>
        <div className="settings-actions">
          <button type="button" className="toolbar-button" onClick={onClose}>
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
