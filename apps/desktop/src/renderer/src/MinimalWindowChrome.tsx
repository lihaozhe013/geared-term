import type { ReactNode } from 'react';
import { Settings } from 'lucide-react';
import type { SettingsRecord } from '@geared-term/protocol';
import type { KeybindingOverrides } from '@geared-term/keybindings';
import { DesktopMenuBar } from './DesktopMenuBar';
import { WindowControls } from './WindowControls';

export function MinimalWindowChrome({
  platform,
  language,
  theme,
  themeNames,
  isDevelopment,
  showTerminalContextMenuOnRightClick,
  minimalMode,
  keybindings,
  tabs,
  onOpenSettings
}: {
  platform: NodeJS.Platform;
  language: SettingsRecord['language'];
  theme: string;
  themeNames: string[];
  isDevelopment: boolean;
  showTerminalContextMenuOnRightClick: boolean;
  minimalMode: boolean;
  keybindings: KeybindingOverrides;
  tabs: ReactNode;
  onOpenSettings: () => void;
}): React.JSX.Element {
  const isMac = platform === 'darwin';
  return (
    <header className={`minimal-chrome${isMac ? ' minimal-chrome-mac' : ''}`}>
      <DesktopMenuBar
        compact
        language={language}
        theme={theme}
        themeNames={themeNames}
        isDevelopment={isDevelopment}
        showTerminalContextMenuOnRightClick={showTerminalContextMenuOnRightClick}
        minimalMode={minimalMode}
        keybindings={keybindings}
      />
      <div className="minimal-tab-viewport">{tabs}</div>
      <div className="minimal-drag-region" aria-hidden="true" />
      <button
        type="button"
        className="icon-button minimal-settings-button"
        aria-label="Settings"
        title="Settings"
        onClick={onOpenSettings}
      >
        <Settings size={15} aria-hidden="true" />
      </button>
      {!isMac ? <WindowControls /> : null}
    </header>
  );
}
