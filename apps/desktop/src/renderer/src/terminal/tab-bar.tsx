import { useEffect, useRef, useState } from 'react';
import { ContextMenu } from '../sftp/context-menu';
import { buildTabContextMenu, type TabMenuLabels, type TabMenuShortcuts } from './tab-context-menu';

export type TabEntry = {
  id: string;
  label: string;
};

type TabBarProps = {
  tabs: TabEntry[];
  activeTabId: string | null;
  labels: TabMenuLabels;
  shortcuts: TabMenuShortcuts;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onReorder: (draggedId: string, targetId: string, placeAfter: boolean) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onNewTab: () => void;
  onCloseOthers: (id: string) => void;
  onCloseAll: () => void;
};

export function TabBar({
  tabs,
  activeTabId,
  labels,
  shortcuts,
  onActivate,
  onClose,
  onReorder,
  onRename,
  onDuplicate,
  onNewTab,
  onCloseOthers,
  onCloseAll
}: TabBarProps): React.JSX.Element {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; after: boolean } | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (renaming) renameInputRef.current?.focus();
  }, [renaming?.id]);

  const clearDrag = (): void => {
    setDraggedId(null);
    setDropTarget(null);
  };

  const commitRename = (): void => {
    if (!renaming) return;
    // An empty draft is treated as "keep the current name".
    const value = renaming.value.trim();
    if (value) onRename(renaming.id, value);
    setRenaming(null);
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>, id: string): void => {
    if (!draggedId || draggedId === id) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const rect = event.currentTarget.getBoundingClientRect();
    const after = event.clientX > rect.left + rect.width / 2;
    setDropTarget((current) =>
      current && current.id === id && current.after === after ? current : { id, after }
    );
  };

  const menuItems = menu
    ? buildTabContextMenu({
        tabCount: tabs.length,
        labels,
        shortcuts,
        actions: {
          rename: () => {
            const tab = tabs.find((item) => item.id === menu.id);
            if (tab) setRenaming({ id: tab.id, value: tab.label });
          },
          duplicate: () => onDuplicate(menu.id),
          newTab: onNewTab,
          close: () => onClose(menu.id),
          closeOthers: () => onCloseOthers(menu.id),
          closeAll: onCloseAll
        }
      })
    : [];

  return (
    <div className="tab-bar" role="tablist" aria-label="Terminal tabs">
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        const isDragSource = draggedId === tab.id;
        const dropSide =
          draggedId && dropTarget?.id === tab.id && !isDragSource
            ? dropTarget.after
              ? ' drop-after'
              : ' drop-before'
            : '';
        return (
          <div
            key={tab.id}
            className={`terminal-tab ${active ? 'active' : ''}${isDragSource ? ' dragging' : ''}${dropSide}`}
            draggable={!renaming || renaming.id !== tab.id}
            onDragStart={(event) => {
              setDraggedId(tab.id);
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', tab.id);
            }}
            onDragOver={(event) => handleDragOver(event, tab.id)}
            onDrop={(event) => {
              event.preventDefault();
              if (draggedId && dropTarget && draggedId !== tab.id) {
                onReorder(draggedId, tab.id, dropTarget.after);
              }
              clearDrag();
            }}
            onDragEnd={clearDrag}
            onMouseDown={(event) => {
              // Suppress the native middle-click autoscroll before closing.
              if (event.button === 1) event.preventDefault();
            }}
            onAuxClick={(event) => {
              if (event.button === 1) onClose(tab.id);
            }}
            onDoubleClick={() => setRenaming({ id: tab.id, value: tab.label })}
            onContextMenu={(event) => {
              event.preventDefault();
              onActivate(tab.id);
              setMenu({ x: event.clientX, y: event.clientY, id: tab.id });
            }}
          >
            {renaming?.id === tab.id ? (
              <input
                ref={renameInputRef}
                className="tab-rename"
                value={renaming.value}
                aria-label={labels.rename}
                spellCheck={false}
                onChange={(event) => setRenaming({ id: tab.id, value: event.target.value })}
                onBlur={commitRename}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commitRename();
                  else if (event.key === 'Escape') setRenaming(null);
                }}
                onFocus={(event) => event.target.select()}
              />
            ) : (
              <button
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onActivate(tab.id)}
              >
                <span>{tab.label}</span>
              </button>
            )}
            <button
              type="button"
              className="tab-close"
              onClick={() => onClose(tab.id)}
              aria-label={`Close ${tab.label}`}
              title={tabs.length > 1 ? undefined : 'Closing the last tab empties the workspace'}
            >
              ×
            </button>
          </div>
        );
      })}
      {menu ? (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      ) : null}
    </div>
  );
}
