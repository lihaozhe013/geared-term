import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AppInfo,
  SessionProfileRecord,
  SettingsRecord,
  WslDistribution,
  ProfileOrderRequest
} from '@geared-term/protocol';
import {
  ChevronDown,
  ChevronRight,
  GripVertical,
  MoreHorizontal,
  PanelLeftClose,
  Plus,
  RefreshCw,
  Trash2
} from 'lucide-react';
import { translate } from './i18n';
import type { MessageKey } from './i18n';
import { createSidebarOrder, moveSidebarGroup, moveSidebarProfile } from './sidebar-ordering';

type SidebarTab = 'sessions' | 'wsl';

type SidebarProps = {
  platform: AppInfo['platform'] | undefined;
  language: SettingsRecord['language'];
  profiles: SessionProfileRecord[];
  groupNames: string[];
  wslDistributions: WslDistribution[];
  wslLoading: boolean;
  onNewProfile: (kind: SessionProfileRecord['kind']) => void;
  onCreateGroup: () => void;
  onDeleteGroup: (name: string) => void;
  onOpenProfile: (profile: SessionProfileRecord) => void;
  onEditProfile: (profile: SessionProfileRecord) => void;
  onDeleteProfile: (profile: SessionProfileRecord) => void;
  onReorderProfiles: (order: ProfileOrderRequest) => Promise<void>;
  onOpenWslDistribution: (name: string) => void;
  onRefreshWsl: () => void;
  onCollapse: () => void;
};

type DraggedSidebarItem = { kind: 'profile'; id: string } | { kind: 'group'; name: string };

type SidebarDropTarget =
  | { kind: 'profile'; id: string; after: boolean }
  | { kind: 'group-reorder'; name: string; after: boolean }
  | { kind: 'group-append'; name: string }
  | { kind: 'ungrouped' };

export function Sidebar({
  platform,
  language,
  profiles,
  groupNames,
  wslDistributions,
  wslLoading,
  onNewProfile,
  onCreateGroup,
  onDeleteGroup,
  onOpenProfile,
  onEditProfile,
  onDeleteProfile,
  onReorderProfiles,
  onOpenWslDistribution,
  onRefreshWsl,
  onCollapse
}: SidebarProps): React.JSX.Element {
  const t = useCallback((key: MessageKey): string => translate(language, key), [language]);
  const [tab, setTab] = useState<SidebarTab>('sessions');
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(new Set());
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [groupMenu, setGroupMenu] = useState<{ name: string; x: number; y: number } | null>(null);
  const createMenuRef = useRef<HTMLDivElement>(null);
  const [profileMenu, setProfileMenu] = useState<{
    x: number;
    y: number;
    profile: SessionProfileRecord;
  } | null>(null);
  const [draggedItem, setDraggedItem] = useState<DraggedSidebarItem | null>(null);
  const [dropTarget, setDropTarget] = useState<SidebarDropTarget | null>(null);
  const [reorderingProfiles, setReorderingProfiles] = useState(false);
  const isWindows = platform === 'win32';

  useEffect(() => {
    if (!createMenuOpen) return;
    const closeOnOutsideClick = (event: MouseEvent): void => {
      if (!createMenuRef.current?.contains(event.target as Node)) setCreateMenuOpen(false);
    };
    const closeOnKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setCreateMenuOpen(false);
    };
    const close = (): void => setCreateMenuOpen(false);
    window.addEventListener('click', closeOnOutsideClick);
    window.addEventListener('keydown', closeOnKeyDown);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('click', closeOnOutsideClick);
      window.removeEventListener('keydown', closeOnKeyDown);
      window.removeEventListener('resize', close);
    };
  }, [createMenuOpen]);

  useEffect(() => {
    if (!groupMenu) return;
    const close = (): void => setGroupMenu(null);
    const closeOnKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('click', close);
    window.addEventListener('keydown', closeOnKeyDown);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', closeOnKeyDown);
      window.removeEventListener('resize', close);
    };
  }, [groupMenu]);

  useEffect(() => {
    if (!profileMenu) return;
    const close = (): void => setProfileMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('keydown', close);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', close);
      window.removeEventListener('resize', close);
    };
  }, [profileMenu]);

  const sidebarOrder = createSidebarOrder(profiles, groupNames);
  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));

  const clearDrag = (): void => {
    setDraggedItem(null);
    setDropTarget(null);
  };

  const beginDrag = (event: React.DragEvent<HTMLButtonElement>, item: DraggedSidebarItem): void => {
    if (reorderingProfiles) {
      event.preventDefault();
      return;
    }
    setDraggedItem(item);
    setDropTarget(null);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', item.kind === 'profile' ? item.id : item.name);
  };

  const persistOrder = (next: ProfileOrderRequest): void => {
    if (next === sidebarOrder || reorderingProfiles) return;
    clearDrag();
    setReorderingProfiles(true);
    void onReorderProfiles(next)
      .catch(() => undefined)
      .finally(() => setReorderingProfiles(false));
  };

  const handleProfileDragOver = (
    event: React.DragEvent<HTMLDivElement>,
    profileId: string
  ): void => {
    if (draggedItem?.kind !== 'profile' || draggedItem.id === profileId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const rect = event.currentTarget.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    setDropTarget((current) =>
      current?.kind === 'profile' && current.id === profileId && current.after === after
        ? current
        : { kind: 'profile', id: profileId, after }
    );
  };

  const handleProfileDrop = (event: React.DragEvent<HTMLDivElement>, profileId: string): void => {
    event.preventDefault();
    event.stopPropagation();
    if (
      draggedItem?.kind === 'profile' &&
      dropTarget?.kind === 'profile' &&
      dropTarget.id === profileId
    ) {
      persistOrder(
        moveSidebarProfile(sidebarOrder, draggedItem.id, {
          kind: 'profile',
          profileId,
          after: dropTarget.after
        })
      );
    }
    clearDrag();
  };

  const handleGroupDragOver = (event: React.DragEvent<HTMLDivElement>, groupName: string): void => {
    if (!draggedItem || (draggedItem.kind === 'group' && draggedItem.name === groupName)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (draggedItem.kind === 'profile') {
      setDropTarget((current) =>
        current?.kind === 'group-append' && current.name === groupName
          ? current
          : { kind: 'group-append', name: groupName }
      );
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    setDropTarget((current) =>
      current?.kind === 'group-reorder' && current.name === groupName && current.after === after
        ? current
        : { kind: 'group-reorder', name: groupName, after }
    );
  };

  const handleGroupDrop = (event: React.DragEvent<HTMLDivElement>, groupName: string): void => {
    event.preventDefault();
    event.stopPropagation();
    if (
      draggedItem?.kind === 'profile' &&
      dropTarget?.kind === 'group-append' &&
      dropTarget.name === groupName
    ) {
      persistOrder(
        moveSidebarProfile(sidebarOrder, draggedItem.id, { kind: 'group', name: groupName })
      );
    } else if (
      draggedItem?.kind === 'group' &&
      dropTarget?.kind === 'group-reorder' &&
      dropTarget.name === groupName
    ) {
      persistOrder(moveSidebarGroup(sidebarOrder, draggedItem.name, groupName, dropTarget.after));
    }
    clearDrag();
  };

  const handleUngroupedDragOver = (event: React.DragEvent<HTMLDivElement>): void => {
    if (draggedItem?.kind !== 'profile') return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTarget((current) => (current?.kind === 'ungrouped' ? current : { kind: 'ungrouped' }));
  };

  const handleUngroupedDrop = (event: React.DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    if (draggedItem?.kind === 'profile' && dropTarget?.kind === 'ungrouped') {
      persistOrder(moveSidebarProfile(sidebarOrder, draggedItem.id, { kind: 'ungrouped' }));
    }
    clearDrag();
  };

  const renderProfileButton = (
    profile: SessionProfileRecord,
    grouped: boolean
  ): React.JSX.Element => {
    const dropSide =
      draggedItem?.kind === 'profile' &&
      dropTarget?.kind === 'profile' &&
      dropTarget.id === profile.id
        ? dropTarget.after
          ? ' drop-after'
          : ' drop-before'
        : '';
    const dragging = draggedItem?.kind === 'profile' && draggedItem.id === profile.id;

    return (
      <div
        key={profile.id}
        className={
          'profile-row' + (grouped ? ' grouped' : '') + (dragging ? ' dragging' : '') + dropSide
        }
        onDragOver={(event) => handleProfileDragOver(event, profile.id)}
        onDrop={(event) => handleProfileDrop(event, profile.id)}
      >
        <button
          type="button"
          className="profile-drag-handle"
          draggable={!reorderingProfiles}
          aria-label={t('reorderSession') + ': ' + profile.name}
          title={t('reorderSession')}
          onDragStart={(event) => beginDrag(event, { kind: 'profile', id: profile.id })}
          onDragEnd={clearDrag}
        >
          <GripVertical size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="profile-button"
          onClick={() => onOpenProfile(profile)}
          onContextMenu={(event) => {
            event.preventDefault();
            setProfileMenu({ x: event.clientX, y: event.clientY, profile });
          }}
        >
          <small className="profile-kind">{profile.kind}</small>
          <span>{profile.name}</span>
        </button>
      </div>
    );
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-switcher" role="tablist" aria-label="Sidebar panels">
        <button
          type="button"
          className="sidebar-pill"
          role="tab"
          aria-selected={tab === 'sessions'}
          onClick={() => setTab('sessions')}
        >
          {t('sessions')}
        </button>
        {isWindows ? (
          <button
            type="button"
            className="sidebar-pill"
            role="tab"
            aria-selected={tab === 'wsl'}
            onClick={() => setTab('wsl')}
          >
            WSL
          </button>
        ) : null}
        <span className="sidebar-spacer" />
        {tab === 'sessions' ? (
          <div className="sidebar-create-control" ref={createMenuRef}>
            <button
              type="button"
              className="icon-button"
              onClick={() => setCreateMenuOpen((open) => !open)}
              aria-label={t('newSessionProfile')}
              title={t('newSessionProfile')}
              aria-haspopup="menu"
              aria-expanded={createMenuOpen}
            >
              <Plus size={14} aria-hidden="true" />
            </button>
            {createMenuOpen ? (
              <div className="sidebar-context-menu sidebar-create-menu" role="menu">
                {(
                  [
                    ['local', 'newLocalSession'],
                    ['ssh', 'newSshSession'],
                    ['wsl', 'newWslSession']
                  ] as const
                ).map(([kind, label]) => (
                  <button
                    type="button"
                    role="menuitem"
                    key={kind}
                    onClick={() => {
                      setCreateMenuOpen(false);
                      onNewProfile(kind);
                    }}
                  >
                    {t(label)}
                  </button>
                ))}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setCreateMenuOpen(false);
                    onCreateGroup();
                  }}
                >
                  {t('emptyGroupMenuItem')}
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <button
            type="button"
            className="icon-button"
            onClick={onRefreshWsl}
            aria-label="Refresh WSL distributions"
            title="Refresh WSL distributions"
          >
            <RefreshCw
              size={14}
              aria-hidden="true"
              className={wslLoading ? 'icon-spin' : undefined}
            />
          </button>
        )}
        <button
          type="button"
          className="icon-button"
          onClick={onCollapse}
          aria-label="Collapse sessions sidebar"
          title="Collapse sessions sidebar"
        >
          <PanelLeftClose size={14} aria-hidden="true" />
        </button>
      </div>
      {tab === 'sessions' ? (
        <div className="sidebar-body" aria-label="Saved sessions">
          {sidebarOrder.ungroupedIds.map((id) => {
            const profile = profilesById.get(id);
            return profile ? renderProfileButton(profile, false) : null;
          })}
          <div
            className={
              'sidebar-ungrouped-drop-target' +
              (draggedItem?.kind === 'profile' ? ' active' : '') +
              (dropTarget?.kind === 'ungrouped' ? ' is-drop-target' : '')
            }
            onDragOver={handleUngroupedDragOver}
            onDrop={handleUngroupedDrop}
          >
            {draggedItem?.kind === 'profile' ? <span>{t('ungrouped')}</span> : null}
          </div>
          {sidebarOrder.groups.map(({ name: groupName, profileIds }) => {
            const collapsed = collapsedGroups.has(groupName);
            const groupDropClass =
              dropTarget?.kind === 'group-reorder' && dropTarget.name === groupName
                ? dropTarget.after
                  ? ' drop-after'
                  : ' drop-before'
                : dropTarget?.kind === 'group-append' && dropTarget.name === groupName
                  ? ' drop-append'
                  : '';
            return (
              <section className="profile-tree-group" key={groupName} aria-label={groupName}>
                <div
                  className={'profile-tree-heading' + groupDropClass}
                  onDragOver={(event) => handleGroupDragOver(event, groupName)}
                  onDrop={(event) => handleGroupDrop(event, groupName)}
                >
                  <button
                    type="button"
                    className="profile-tree-header"
                    aria-expanded={!collapsed}
                    onClick={() =>
                      setCollapsedGroups((current) => {
                        const next = new Set(current);
                        if (next.has(groupName)) {
                          next.delete(groupName);
                        } else {
                          next.add(groupName);
                        }
                        return next;
                      })
                    }
                  >
                    {collapsed ? (
                      <ChevronRight size={12} aria-hidden="true" />
                    ) : (
                      <ChevronDown size={12} aria-hidden="true" />
                    )}
                    <span>{groupName}</span>
                    <small>{profileIds.length}</small>
                  </button>
                  <button
                    type="button"
                    className="profile-drag-handle group-drag-handle"
                    draggable={!reorderingProfiles}
                    aria-label={t('reorderGroup') + ': ' + groupName}
                    title={t('reorderGroup')}
                    onDragStart={(event) => beginDrag(event, { kind: 'group', name: groupName })}
                    onDragEnd={clearDrag}
                  >
                    <GripVertical size={14} aria-hidden="true" />
                  </button>
                  {profileIds.length === 0 ? (
                    <button
                      type="button"
                      className="icon-button group-actions-button"
                      aria-label={t('groupActions') + ': ' + groupName}
                      title={t('groupActions')}
                      aria-haspopup="menu"
                      aria-expanded={groupMenu?.name === groupName}
                      onClick={(event) => {
                        event.stopPropagation();
                        const rect = event.currentTarget.getBoundingClientRect();
                        setGroupMenu({ name: groupName, x: rect.right - 180, y: rect.bottom });
                      }}
                    >
                      <MoreHorizontal size={14} aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
                {!collapsed
                  ? profileIds.map((id) => {
                      const profile = profilesById.get(id);
                      return profile ? renderProfileButton(profile, true) : null;
                    })
                  : null}
              </section>
            );
          })}
          {profiles.length === 0 && sidebarOrder.groups.length === 0 ? (
            <div className="empty-state">
              <span className="empty-icon" aria-hidden="true">
                +
              </span>
              <p>{t('sidebarEmpty')}</p>
              <small>{t('sidebarEmptyHint')}</small>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="sidebar-body" aria-label="WSL distributions">
          {wslDistributions.map((distribution) => (
            <button
              type="button"
              className="profile-button"
              key={distribution.name}
              onDoubleClick={() => onOpenWslDistribution(distribution.name)}
              title={`Double-click to open "${distribution.name}" in a new terminal`}
            >
              <span>
                {distribution.isDefault ? '★ ' : ''}
                {distribution.name}
              </span>
              <small>
                {distribution.state} · WSL {distribution.version ?? '?'}
              </small>
            </button>
          ))}
          {wslDistributions.length === 0 && !wslLoading ? (
            <small className="muted">{t('noDistributionsDiscovered')}</small>
          ) : null}
        </div>
      )}
      {profileMenu ? (
        <div
          className="sidebar-context-menu"
          role="menu"
          style={{ left: profileMenu.x, top: profileMenu.y }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onEditProfile(profileMenu.profile);
              setProfileMenu(null);
            }}
          >
            {t('edit')}
          </button>
          <button
            type="button"
            role="menuitem"
            className="danger"
            onClick={() => {
              onDeleteProfile(profileMenu.profile);
              setProfileMenu(null);
            }}
          >
            {t('delete')}
          </button>
        </div>
      ) : null}
      {groupMenu ? (
        <div
          className="sidebar-context-menu"
          role="menu"
          aria-label={t('groupActions') + ': ' + groupMenu.name}
          style={{ left: groupMenu.x, top: groupMenu.y }}
        >
          <button
            type="button"
            role="menuitem"
            className="danger"
            onClick={() => {
              onDeleteGroup(groupMenu.name);
              setGroupMenu(null);
            }}
          >
            <Trash2 size={14} aria-hidden="true" />
            {t('deleteGroup')}
          </button>
        </div>
      ) : null}
    </aside>
  );
}
