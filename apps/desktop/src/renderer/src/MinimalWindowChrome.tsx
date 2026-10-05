import type { ReactNode } from 'react';
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
  tabs
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
      {!isMac ? <WindowControls /> : null}
    </header>
  );
}
