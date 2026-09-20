import { useEffect, useMemo, useState } from 'react';
import {
  BUILTIN_THEME_NAMES,
  type AppInfo,
  type InvalidThemeFile,
  type RuntimeInfo,
  type SettingsRecord,
  type UserTheme
} from '@geared-term/protocol';
import {
  Bot,
  FolderSync,
  Info,
  Lock,
  Palette,
  Settings as SettingsIcon,
  SquareTerminal
} from 'lucide-react';
import { applyPalette, applyTypography, resolvePalette } from '../themes';
import { makeTranslate } from './sections';
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
import { WindowTitleBar } from '../WindowTitleBar';

type Category =
  | 'general'
  | 'appearance'
  | 'terminal'
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
  const [category, setCategory] = useState<Category>('general');
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([
      window.geared.getSettings(),
      window.geared.listUserThemes(),
      window.geared.getAppInfo(),
      window.geared.getRuntimeInfo()
    ])
      .then(([savedSettings, themes, appInfo, runtimeInfo]) => {
        setSettings(savedSettings);
        setUserThemes(themes.themes);
        setInvalidThemes(themes.invalid);
        setInfo(appInfo);
        setRuntime(runtimeInfo);
      })
      .catch((reason: unknown) =>
        setLoadError(reason instanceof Error ? reason.message : 'Unable to load settings')
      );
  }, []);

  useEffect(() => {
    const offChanged = window.geared.onSettingsChanged((changed) => setSettings(changed));
    const offNavigate = window.geared.onSettingsNavigate((next) => {
      if (next === 'general' || next === 'appearance' || next === 'terminal' || next === 'sftp') {
        setCategory(next);
      } else if (next === 'ai-connections' || next === 'ai-assistant' || next === 'security') {
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

  const palette = useMemo(
    () => (settings ? resolvePalette(settings.theme, userThemes) : null),
    [settings, userThemes]
  );

  useEffect(() => {
    if (!palette || !settings) return;
    applyPalette(palette);
    void window.geared
      .setTitleBarOverlay({ color: palette.background, symbolColor: palette.text })
      .catch(() => undefined);
    applyTypography(settings.uiFontSize, settings.uiFontFamily);
  }, [palette, settings]);

  const save = async (patch: Partial<SettingsRecord>): Promise<void> => {
    if (!settings) return;
    try {
      setSettings(await window.geared.saveSettings({ ...settings, ...patch }));
    } catch (reason) {
      setLoadError(reason instanceof Error ? reason.message : 'Unable to save settings');
    }
  };

  const platform = info?.platform ?? window.geared.platform;
  const themeNames = [
    ...new Set([...BUILTIN_THEME_NAMES, ...userThemes.map((theme) => theme.name)])
  ];

  if (loadError) {
    return (
      <div className="settings-window-shell">
        <WindowTitleBar title="Geared Term Settings" platform={platform} showMenu={false} />
        <div className="settings-loading">{loadError}</div>
      </div>
    );
  }
  if (!settings) {
    return (
      <div className="settings-window-shell">
        <WindowTitleBar title="Geared Term Settings" platform={platform} showMenu={false} />
        <div className="settings-loading" aria-busy="true">
          Loading…
        </div>
      </div>
    );
  }

  const t = makeTranslate(settings.language);

  return (
    <div className="settings-window-shell">
      <WindowTitleBar
        title="Geared Term Settings"
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
            {category === 'general' ? (
              <GeneralSection settings={settings} onSave={save} t={t} />
            ) : null}
            {category === 'appearance' ? (
              <AppearanceSection
                settings={settings}
                themeNames={themeNames}
                invalidThemes={invalidThemes}
                onSave={save}
                t={t}
              />
            ) : null}
            {category === 'terminal' ? (
              <TerminalSection settings={settings} onSave={save} t={t} />
            ) : null}
            {category === 'sftp' ? <SftpSection settings={settings} onSave={save} t={t} /> : null}
            {category === 'ai-connections' ? <AiConnectionsSection t={t} /> : null}
            {category === 'ai-assistant' ? (
              <AiAssistantSection settings={settings} onSave={save} t={t} />
            ) : null}
            {category === 'security' ? <SecurityVaultSection t={t} /> : null}
            {category === 'about' ? <AboutSection info={info} runtime={runtime} t={t} /> : null}
          </div>
        </section>
      </div>
    </div>
  );
}
