import { useEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';

export type ContextMenuItem = {
  id: string;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  separatorBefore?: boolean;
  submenu?: ContextMenuItem[];
  run?: () => void;
};

type ContextMenuProps = {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
};

const MENU_WIDTH = 230;
const ITEM_HEIGHT = 26;

/**
 * Panel-local popup menu with viewport clamping and one hover-expandable
 * submenu level (used by the SFTP "Run in terminal" group).
 */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps): React.JSX.Element {
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const height = items.reduce((sum, item) => sum + ITEM_HEIGHT + (item.separatorBefore ? 8 : 0), 8);
  const left = Math.max(4, Math.min(x, window.innerWidth - MENU_WIDTH - 8));
  const top = Math.max(4, Math.min(y, window.innerHeight - height - 8));
  const flipSubmenu = left + MENU_WIDTH * 2 > window.innerWidth;
  useEffect(() => {
    const dismiss = (event: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose();
    };
    const dismissKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', dismiss);
    window.addEventListener('keydown', dismissKey);
    return () => {
      window.removeEventListener('mousedown', dismiss);
      window.removeEventListener('keydown', dismissKey);
    };
  }, [onClose]);
  const renderItem = (item: ContextMenuItem, inSubmenu: boolean): React.JSX.Element => (
    <div className="sftp-menu-row" key={`${inSubmenu ? 'sub-' : ''}${item.id}`}>
      {item.separatorBefore ? <div className="sftp-menu-separator" /> : null}
      <button
        type="button"
        role="menuitem"
        className={`sftp-menu-item ${item.danger ? 'danger' : ''}`}
        disabled={item.disabled}
        onMouseEnter={() => setOpenSubmenu(item.submenu ? item.id : null)}
        onClick={() => {
          if (item.disabled || item.submenu) return;
          onClose();
          item.run?.();
        }}
      >
        <span>{item.label}</span>
        {item.shortcut ? (
          <span className="sftp-menu-shortcut">{item.shortcut}</span>
        ) : null}
        {item.submenu ? (
          <span className="sftp-menu-caret">
            <ChevronRight size={13} aria-hidden="true" />
          </span>
        ) : null}
      </button>
      {item.submenu && openSubmenu === item.id ? (
        <div
          className="sftp-context-menu sftp-context-menu-submenu"
          role="menu"
          style={
            flipSubmenu
              ? { right: inSubmenu ? 0 : MENU_WIDTH - 6 }
              : { left: inSubmenu ? MENU_WIDTH - 6 : MENU_WIDTH - 6 }
          }
        >
          {item.submenu.length === 0 ? (
            <div className="sftp-menu-item" aria-disabled>
              <span>—</span>
            </div>
          ) : null}
          {item.submenu.map((child) => renderItem(child, true))}
        </div>
      ) : null}
    </div>
  );
  return (
    <div
      ref={menuRef}
      className="sftp-context-menu"
      role="menu"
      style={{ left, top, width: MENU_WIDTH }}
    >
      {items.map((item) => renderItem(item, false))}
    </div>
  );
}
