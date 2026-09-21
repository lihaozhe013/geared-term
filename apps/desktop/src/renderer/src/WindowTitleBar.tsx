import { Settings } from 'lucide-react';
import type { SettingsRecord } from '@geared-term/protocol';
import type { KeybindingOverrides } from '@geared-term/keybindings';
import { DesktopMenuBar } from './DesktopMenuBar';
import { WindowControls } from './WindowControls';
import gearedTermMark from './assets/geared-term-mark.png';

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
  keybindings?: KeybindingOverrides;
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
  onOpenSettings,
  keybindings
}: WindowTitleBarProps): React.JSX.Element {
  const isMac = platform === 'darwin';
  return (
    <header className={`titlebar ${isMac ? 'titlebar-mac' : ''}`}>
      <div className="titlebar-leading">
        <span className="titlebar-app">
          <img className="titlebar-logo" src={gearedTermMark} alt="" aria-hidden="true" />
          {title}
        </span>
        {!isMac && showMenu ? (
          <DesktopMenuBar
            language={language}
            theme={theme}
            themeNames={themeNames}
            isDevelopment={isDevelopment}
            keybindings={keybindings}
          />
        ) : null}
      </div>
      {sessionLabel ? <span className="titlebar-session">{sessionLabel}</span> : null}
      {onOpenSettings || !isMac ? (
        <div className="titlebar-actions">
          {onOpenSettings ? (
            <button
              type="button"
              className="icon-button"
              aria-label="Settings"
              title="Settings"
              onClick={onOpenSettings}
            >
              <Settings size={15} aria-hidden="true" />
            </button>
          ) : null}
          {!isMac ? <WindowControls /> : null}
        </div>
      ) : null}
    </header>
  );
}
