import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BUILTIN_THEME_NAMES,
  type AppInfo,
  type InvalidThemeFile,
  type RuntimeInfo,
  type SettingsRecord,
  type SettingsPatch,
  type UpdateStatus,
  type UserTheme
} from '@geared-term/protocol';
import {
  Bot,
  FolderSync,
  Info,
  Keyboard,
  Lock,
  Palette,
  Settings as SettingsIcon,
  SquareTerminal
} from 'lucide-react';
import { applyPalette, applyTypography, applyTerminalLayout, resolvePalette } from '../themes';
import { makeTranslate } from './sections';
import type { Translate } from './sections';
import {
  AboutSection,
  AiAssistantSection,
  AppearanceSection,
  GeneralSection,
  SftpSection,
  TerminalSection
} from './sections';
import { AiConnectionsSection } from './AiConnections';
import { SecurityVaultSection } from './SecurityVault';
import { ShortcutsSection } from './ShortcutsSection';
import { WindowTitleBar } from '../WindowTitleBar';

type Category =
  | 'general'
  | 'appearance'
  | 'terminal'
  | 'shortcuts'
  | 'sftp'
  | 'ai-connections'
  | 'ai-assistant'
  | 'security'
  | 'about';

export function SettingsWindow(): React.JSX.Element {
  const [settings, setSettings] = useState<SettingsRecord | null>(null);
  const [userThemes, setUserThemes] = useState<UserTheme[]>([]);
  const [invalidThemes, setInvalidThemes] = useState<InvalidThemeFile[]>([]);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [category, setCategory] = useState<Category>('general');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState(false);
  const [retryPatch, setRetryPatch] = useState<Partial<SettingsPatch>>({});
  const settingsRef = useRef<SettingsRecord | null>(null);
  const saveSequence = useRef(0);
  const pendingPatch = useRef(new Map<keyof SettingsPatch, { sequence: number; value: unknown }>());
  const retryPatchRef = useRef<Partial<SettingsPatch>>({});
  const t: Translate = makeTranslate(settings?.language ?? 'system');
  settingsRef.current = settings;

  useEffect(() => {
    void Promise.all([
      window.geared.getSettings(),
      window.geared.listUserThemes(),
      window.geared.getAppInfo(),
      window.geared.getRuntimeInfo()
    ])
      .then(([savedSettings, themes, appInfo, runtimeInfo]) => {
        settingsRef.current = savedSettings;
        setSettings(savedSettings);
        setUserThemes(themes.themes);
        setInvalidThemes(themes.invalid);
        setInfo(appInfo);
        setRuntime(runtimeInfo);
      })
      .catch((reason: unknown) =>
        setLoadError(reason instanceof Error ? reason.message : t('errLoadSettings'))
      );
  }, []);

  useEffect(() => {
    const offChanged = window.geared.onSettingsChanged((changed) => {
      const pending = Object.fromEntries(
        [...pendingPatch.current].map(([key, entry]) => [key, entry.value])
      ) as Partial<SettingsPatch>;
      const visible = { ...changed, ...pending };
      settingsRef.current = visible;
      setSettings(visible);
    });
    const offNavigate = window.geared.onSettingsNavigate((next) => {
      if (next === 'general' || next === 'appearance' || next === 'terminal' || next === 'sftp') {
        setCategory(next);
      } else if (
        next === 'ai-connections' ||
        next === 'ai-assistant' ||
        next === 'security' ||
        next === 'shortcuts'
      ) {
        setCategory(next);
      } else if (next === 'about') {
        setCategory(next);
      }
    });
    return () => {
      offChanged();
      offNavigate();
    };
  }, []);

  useEffect(() => {
    void window.geared
      .getUpdateStatus()
      .then(setUpdateStatus)
      .catch(() => undefined);
    return window.geared.onUpdateStatus(setUpdateStatus);
  }, []);

  const palette = useMemo(
    () => (settings ? resolvePalette(settings.theme, userThemes) : null),
    [settings, userThemes]
  );

  useEffect(() => {
    if (!palette || !settings) return;
    applyPalette(palette);
    applyTypography(settings.uiFontSize, settings.uiFontFamily, settings.uiScalePercent);
    applyTerminalLayout(settings.terminalPadding, settings.fullScreenTerminalPadding);
  }, [palette, settings]);

  const save = useCallback(async (patch: Partial<SettingsPatch>): Promise<boolean> => {
    if (!settingsRef.current) return false;
    const sequence = ++saveSequence.current;
    for (const [key, value] of Object.entries(patch) as Array<[keyof SettingsPatch, unknown]>) {
      pendingPatch.current.set(key, { sequence, value });
    }
    const visible = { ...settingsRef.current, ...patch };
    settingsRef.current = visible;
    setSettings(visible);
    setSaveError(Object.keys(retryPatchRef.current).length > 0);

    try {
      const saved = await window.geared.patchSettings(patch as SettingsPatch);
      for (const key of Object.keys(patch) as Array<keyof SettingsPatch>) {
        if (pendingPatch.current.get(key)?.sequence === sequence) pendingPatch.current.delete(key);
        delete retryPatchRef.current[key];
      }
      const pending = Object.fromEntries(
        [...pendingPatch.current].map(([key, entry]) => [key, entry.value])
      ) as Partial<SettingsPatch>;
      const next = { ...saved, ...pending };
      settingsRef.current = next;
      setSettings(next);
      setRetryPatch({ ...retryPatchRef.current });
      setSaveError(Object.keys(retryPatchRef.current).length > 0);
      return true;
    } catch {
      for (const [key, value] of Object.entries(patch) as Array<[keyof SettingsPatch, unknown]>) {
        if (pendingPatch.current.get(key)?.sequence !== sequence) continue;
        retryPatchRef.current[key] = value as never;
        pendingPatch.current.delete(key);
      }
      const saved = await window.geared.getSettings().catch(() => settingsRef.current);
      if (saved) {
        const pending = Object.fromEntries(
          [...pendingPatch.current].map(([key, entry]) => [key, entry.value])
        ) as Partial<SettingsPatch>;
        const next = { ...saved, ...pending };
        settingsRef.current = next;
        setSettings(next);
      }
      setRetryPatch({ ...retryPatchRef.current });
      setSaveError(Object.keys(retryPatchRef.current).length > 0);
      return false;
    }
  }, []);

  const retrySave = (): void => {
    const patch = retryPatchRef.current;
    if (Object.keys(patch).length > 0) void save(patch);
  };

  const platform = info?.platform ?? window.geared.platform;
  const themeNames = [
    ...new Set([...BUILTIN_THEME_NAMES, ...userThemes.map((theme) => theme.name)])
  ];

  if (loadError) {
    return (
      <div className="settings-window-shell">
        <WindowTitleBar title={t('settingsWindowTitle')} platform={platform} showMenu={false} />
        <div className="settings-loading">{loadError}</div>
      </div>
    );
  }
  if (!settings) {
    return (
      <div className="settings-window-shell">
        <WindowTitleBar title={t('settingsWindowTitle')} platform={platform} showMenu={false} />
        <div className="settings-loading" aria-busy="true">
          {t('loading')}
        </div>
      </div>
    );
  }

  return (
    <div className="settings-window-shell">
      <WindowTitleBar
        title={t('settingsWindowTitle')}
        platform={platform}
        showMenu={false}
        language={settings.language}
        theme={settings.theme}
        themeNames={themeNames}
        isDevelopment={!info?.isPackaged}
      />
      <div className="settings-window">
        <nav className="settings-nav" aria-label={t('settings')}>
          <button
            type="button"
            className={`settings-nav-item ${category === 'general' ? 'active' : ''}`}
            onClick={() => setCategory('general')}
          >
            <SettingsIcon size={15} aria-hidden="true" /> {t('groupGeneral')}
          </button>
          <button
            type="button"
            className={`settings-nav-item ${category === 'appearance' ? 'active' : ''}`}
            onClick={() => setCategory('appearance')}
          >
            <Palette size={15} aria-hidden="true" /> {t('groupAppearance')}
          </button>
          <button
            type="button"
            className={`settings-nav-item ${category === 'terminal' ? 'active' : ''}`}
            onClick={() => setCategory('terminal')}
          >
            <SquareTerminal size={15} aria-hidden="true" /> {t('groupTerminal')}
          </button>
          <button
            type="button"
            className={`settings-nav-item ${category === 'shortcuts' ? 'active' : ''}`}
            onClick={() => setCategory('shortcuts')}
          >
            <Keyboard size={15} aria-hidden="true" /> {t('groupShortcuts')}
          </button>
          <button
            type="button"
            className={`settings-nav-item ${category === 'sftp' ? 'active' : ''}`}
            onClick={() => setCategory('sftp')}
          >
            <FolderSync size={15} aria-hidden="true" /> {t('groupSftp')}
          </button>
          <button
            type="button"
            className={`settings-nav-item ${category === 'ai-connections' ? 'active' : ''}`}
            onClick={() => setCategory('ai-connections')}
          >
            <Bot size={15} aria-hidden="true" /> {t('groupAiConnections')}
          </button>
          <button
            type="button"
            className={`settings-nav-item ${category === 'ai-assistant' ? 'active' : ''}`}
            onClick={() => setCategory('ai-assistant')}
          >
            <Bot size={15} aria-hidden="true" /> {t('groupAssistant')}
          </button>
          <button
            type="button"
            className={`settings-nav-item ${category === 'security' ? 'active' : ''}`}
            onClick={() => setCategory('security')}
          >
            <Lock size={15} aria-hidden="true" /> {t('groupSecurity')}
          </button>
          <span className="settings-nav-spacer" />
          <button
            type="button"
            className={`settings-nav-item ${category === 'about' ? 'active' : ''}`}
            onClick={() => setCategory('about')}
          >
            <Info size={15} aria-hidden="true" /> {t('groupAbout')}
          </button>
        </nav>
        <section className="settings-content">
          <div className="settings-content-inner">
            {saveError ? (
              <div className="settings-save-error" role="alert">
                <span>{t('errSaveSettings')}</span>
                {Object.keys(retryPatch).length > 0 ? (
                  <button type="button" className="toolbar-button" onClick={retrySave}>
                    {t('retrySettingsSave')}
                  </button>
                ) : null}
              </div>
            ) : null}
            {category === 'general' ? (
              <GeneralSection settings={settings} onSave={save} t={t} />
            ) : null}
            {category === 'appearance' ? (
              <AppearanceSection
                settings={settings}
                appInfo={info}
                themeNames={themeNames}
                invalidThemes={invalidThemes}
                onSave={save}
                t={t}
              />
            ) : null}
            {category === 'terminal' ? (
              <TerminalSection settings={settings} onSave={save} t={t} />
            ) : null}
            {category === 'shortcuts' ? (
              <ShortcutsSection settings={settings} onSave={save} t={t} />
            ) : null}
            {category === 'sftp' ? <SftpSection settings={settings} onSave={save} t={t} /> : null}
            {category === 'ai-connections' ? (
              <AiConnectionsSection settings={settings} onSave={save} t={t} />
            ) : null}
            {category === 'ai-assistant' ? (
              <AiAssistantSection settings={settings} onSave={save} t={t} />
            ) : null}
            {category === 'security' ? <SecurityVaultSection t={t} /> : null}
            {category === 'about' ? (
              <AboutSection
                settings={settings}
                info={info}
                runtime={runtime}
                updateStatus={updateStatus}
                onSave={save}
                onCheckUpdates={async () => setUpdateStatus(await window.geared.checkForUpdates())}
                onDownloadUpdate={async () => {
                  await window.geared.startUpdateDownload();
                }}
                onInstallUpdate={() => void window.geared.installDownloadedUpdate()}
                onOpenRelease={() => void window.geared.openNightlyRelease()}
                t={t}
              />
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
