import { useEffect, useState } from 'react';
import type { AppInfo, SessionProfileRecord, WslDistribution } from '@geared-term/protocol';
import { ChevronDown, ChevronRight, PanelLeftClose, Plus, RefreshCw } from 'lucide-react';

type SidebarTab = 'sessions' | 'wsl';

type SidebarProps = {
  platform: AppInfo['platform'] | undefined;
  profiles: SessionProfileRecord[];
  wslDistributions: WslDistribution[];
  wslLoading: boolean;
  onNewProfile: () => void;
  onOpenProfile: (profile: SessionProfileRecord) => void;
  onEditProfile: (profile: SessionProfileRecord) => void;
  onDeleteProfile: (profile: SessionProfileRecord) => void;
  onOpenWslDistribution: (name: string) => void;
  onRefreshWsl: () => void;
  onCollapse: () => void;
};

function groupProfiles(profiles: SessionProfileRecord[]): {
  ungrouped: SessionProfileRecord[];
  groups: [string, SessionProfileRecord[]][];
} {
  const ungrouped: SessionProfileRecord[] = [];
  const grouped = new Map<string, SessionProfileRecord[]>();
  for (const profile of profiles) {
    const name = profile.group?.trim();
    if (!name) {
      ungrouped.push(profile);
      continue;
    }
    const bucket = grouped.get(name);
    if (bucket) {
      bucket.push(profile);
    } else {
      grouped.set(name, [profile]);
    }
  }
  return { ungrouped, groups: Array.from(grouped) };
}

export function Sidebar({
  platform,
  profiles,
  wslDistributions,
  wslLoading,
  onNewProfile,
  onOpenProfile,
  onEditProfile,
  onDeleteProfile,
  onOpenWslDistribution,
  onRefreshWsl,
  onCollapse
}: SidebarProps): React.JSX.Element {
  const [tab, setTab] = useState<SidebarTab>('sessions');
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(new Set());
  const [profileMenu, setProfileMenu] = useState<{
    x: number;
    y: number;
    profile: SessionProfileRecord;
  } | null>(null);
  const isWindows = platform === 'win32';

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

  const { ungrouped, groups } = groupProfiles(profiles);

  const renderProfileButton = (
    profile: SessionProfileRecord,
    grouped: boolean
  ): React.JSX.Element => (
    <button
      type="button"
      className={`profile-button${grouped ? ' grouped' : ''}`}
      key={profile.id}
      onClick={() => onOpenProfile(profile)}
      onContextMenu={(event) => {
        event.preventDefault();
        setProfileMenu({ x: event.clientX, y: event.clientY, profile });
      }}
    >
      <small className="profile-kind">{profile.kind}</small>
      <span>{profile.name}</span>
    </button>
  );

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
          Sessions
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
          <button
            type="button"
            className="icon-button"
            onClick={onNewProfile}
            aria-label="New session profile"
            title="New session profile"
          >
            <Plus size={14} aria-hidden="true" />
          </button>
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
          {ungrouped.map((profile) => renderProfileButton(profile, false))}
          {groups.map(([groupName, groupProfiles]) => {
            const collapsed = collapsedGroups.has(groupName);
            return (
              <section className="profile-tree-group" key={groupName} aria-label={groupName}>
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
                  <small>{groupProfiles.length}</small>
                </button>
                {!collapsed
                  ? groupProfiles.map((profile) => renderProfileButton(profile, true))
                  : null}
              </section>
            );
          })}
          {profiles.length === 0 ? (
            <div className="empty-state">
              <span className="empty-icon" aria-hidden="true">
                +
              </span>
              <p>No saved sessions</p>
              <small>Use the + button in the sidebar to keep a session profile.</small>
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
            <small className="muted">No distributions discovered.</small>
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
            Edit
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
            Delete
          </button>
        </div>
      ) : null}
    </aside>
  );
}
