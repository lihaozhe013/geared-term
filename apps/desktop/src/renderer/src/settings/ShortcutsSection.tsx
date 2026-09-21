import { useEffect, useMemo, useRef, useState } from 'react';
import {
  KEYBINDING_GROUPS,
  findConflicts,
  formatKeybinding,
  isValidKeybindingSpec,
  normalizePlatform,
  resolveKeybindings,
  specFromEvent,
  type CommandId,
  type KeybindingOverrides
} from '@geared-term/keybindings';
import type { SettingsRecord } from '@geared-term/protocol';
import type { MessageKey } from '../i18n';
import { Row, Section } from './primitives';
import type { Translate } from './sections';

const COMMAND_LABEL_KEYS: Record<CommandId, MessageKey> = {
  'terminal.copy': 'shortcutTerminalCopy',
  'terminal.paste': 'shortcutTerminalPaste',
  'terminal.selectAll': 'shortcutTerminalSelectAll',
  'terminal.search': 'shortcutTerminalSearch',
  'terminal.clear': 'shortcutTerminalClear',
  'tab.new': 'shortcutTabNew',
  'tab.close': 'shortcutTabClose',
  'tab.next': 'shortcutTabNext',
  'tab.previous': 'shortcutTabPrevious',
  'terminal.zoomIn': 'shortcutTerminalZoomIn',
  'terminal.zoomOut': 'shortcutTerminalZoomOut',
  'terminal.zoomReset': 'shortcutTerminalZoomReset',
  'panel.cycle': 'shortcutPanelCycle',
  'app.settings': 'shortcutAppSettings'
};

const GROUP_LABEL_KEYS = {
  terminal: 'shortcutGroupTerminal',
  tabs: 'shortcutGroupTabs',
  view: 'shortcutGroupView',
  app: 'shortcutGroupApp'
} as const satisfies Record<(typeof KEYBINDING_GROUPS)[number]['id'], MessageKey>;

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta']);

export function ShortcutsSection({
  settings,
  onSave,
  t
}: {
  settings: SettingsRecord;
  onSave: (patch: Partial<SettingsRecord>) => Promise<void>;
  t: Translate;
}): React.JSX.Element {
  const platform = useMemo(() => normalizePlatform(window.geared.platform), []);
  const bindings = useMemo(
    () => resolveKeybindings(settings.keybindings, platform),
    [settings.keybindings, platform]
  );
  const [recording, setRecording] = useState<CommandId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stateRef = useRef({ settings, onSave, platform, t });
  stateRef.current = { settings, onSave, platform, t };

  const applyOverrides = (overrides: KeybindingOverrides): void => {
    setError(null);
    void stateRef.current.onSave({ keybindings: overrides }).catch(() => undefined);
  };

  const saveBinding = (command: CommandId, spec: string): void => {
    const { settings: current, platform: currentPlatform, t: translate } = stateRef.current;
    const overrides = { ...current.keybindings, [command]: spec };
    const conflicts = findConflicts(resolveKeybindings(overrides, currentPlatform));
    for (const [conflictSpec, commands] of conflicts) {
      if (!commands.includes(command)) continue;
      const other = commands.find((entry) => entry !== command);
      if (other) {
        setError(
          translate('shortcutConflict').replace('{command}', translate(COMMAND_LABEL_KEYS[other]))
        );
        return;
      }
    }
    applyOverrides(overrides);
  };

  const resetBinding = (command: CommandId): void => {
    const rest = { ...stateRef.current.settings.keybindings };
    delete rest[command];
    applyOverrides(rest);
  };

  useEffect(() => {
    if (!recording) return;
    // The application menu is detached while recording (main process) so its
    // registered accelerators cannot swallow the pressed keys.
    void window.geared.beginKeyCapture().catch(() => undefined);
    const onKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        setRecording(null);
        return;
      }
      if (event.key === 'Backspace' || event.key === 'Delete') {
        resetBinding(recording);
        setRecording(null);
        return;
      }
      if (MODIFIER_KEYS.has(event.key)) return;
      const spec = specFromEvent(event);
      if (!spec || !isValidKeybindingSpec(spec, stateRef.current.platform)) {
        setError(stateRef.current.t('shortcutInvalid'));
        setRecording(null);
        return;
      }
      saveBinding(recording, spec);
      setRecording(null);
    };
    const onBlur = (): void => setRecording(null);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('blur', onBlur);
      void window.geared.endKeyCapture().catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);

  const hasOverrides = Object.keys(settings.keybindings).length > 0;

  return (
    <>
      <Section title={t('groupShortcuts')}>
        <p className="settings-hint">{t('shortcutHint')}</p>
        <div className="shortcut-actions">
          {error ? <span className="shortcut-error">{error}</span> : null}
          {hasOverrides ? (
            <button
              type="button"
              className="shortcut-reset-all"
              onClick={() => {
                setError(null);
                applyOverrides({});
              }}
            >
              {t('shortcutResetAll')}
            </button>
          ) : null}
        </div>
      </Section>
      {KEYBINDING_GROUPS.map((group) => (
        <Section key={group.id} title={t(GROUP_LABEL_KEYS[group.id])}>
          {group.commands.map((command) => {
            const isRecording = recording === command;
            return (
              <Row key={command} label={t(COMMAND_LABEL_KEYS[command])}>
                <span className="shortcut-controls">
                  <button
                    type="button"
                    className={`kbd-capture ${isRecording ? 'recording' : ''}`}
                    aria-pressed={isRecording}
                    onClick={() => {
                      setError(null);
                      setRecording(isRecording ? null : command);
                    }}
                  >
                    {isRecording
                      ? t('shortcutRecording')
                      : formatKeybinding(bindings[command], platform)}
                  </button>
                  {settings.keybindings[command] ? (
                    <button
                      type="button"
                      className="shortcut-reset"
                      title={t('reset')}
                      aria-label={t('reset')}
                      onClick={() => resetBinding(command)}
                    >
                      ↺
                    </button>
                  ) : null}
                </span>
              </Row>
            );
          })}
        </Section>
      ))}
    </>
  );
}
