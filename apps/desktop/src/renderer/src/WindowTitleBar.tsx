import { Settings } from 'lucide-react';
import type { SettingsRecord } from '@geared-term/protocol';
import { DesktopMenuBar } from './DesktopMenuBar';

type WindowTitleBarProps = {
  title: string;
  sessionLabel?: string;
  platform?: NodeJS.Platform;
  language?: SettingsRecord['language'];
  theme?: string;
  themeNames?: string[];
  isDevelopment?: boolean;
  showMenu?: boolean;
  onOpenSettings?: () => void;
};

export function WindowTitleBar({
  title,
  sessionLabel,
  platform = window.geared.platform,
  language = 'system',
  theme = '',
  themeNames = [],
  isDevelopment = false,
  showMenu = true,
  onOpenSettings
}: WindowTitleBarProps): React.JSX.Element {
  const isMac = platform === 'darwin';
  return (
    <header className={`titlebar ${isMac ? 'titlebar-mac' : 'titlebar-overlay'}`}>
      <div className="titlebar-leading">
        <span className="titlebar-app">
          <span className="titlebar-logo" aria-hidden="true" />
          {title}
        </span>
        {!isMac && showMenu ? (
          <DesktopMenuBar
            language={language}
            theme={theme}
            themeNames={themeNames}
            isDevelopment={isDevelopment}
          />
        ) : null}
      </div>
      {sessionLabel ? <span className="titlebar-session">{sessionLabel}</span> : null}
      {onOpenSettings ? (
        <div className="titlebar-actions">
          <button
            type="button"
            className="icon-button"
            aria-label="Settings"
            title="Settings"
            onClick={onOpenSettings}
          >
            <Settings size={15} aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </header>
  );
}
