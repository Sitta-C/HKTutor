'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import PrivacyNoticeModal from '@/components/privacy-notice-modal';
import {
  getDashboardNavItems,
  getDashboardRoleConfig,
  getUserDisplayName,
  getUserInitial,
} from '@/lib/dashboard-navigation';
import { useLanguage } from '@/lib/i18n';

import type { AuthUser } from '@/lib/api/types';
import type { ReactNode } from 'react';

export interface DashboardShellProps {
  user: AuthUser;
  onLogout: () => Promise<void>;
  children: ReactNode;
  headerNavRight?: ReactNode;
  visualVariant?: 'default' | 'profile';
}

export function DashboardShell({
  user,
  onLogout,
  children,
  headerNavRight,
  visualVariant = 'default',
}: DashboardShellProps) {
  const { language, copy, toggleLanguage } = useLanguage();
  const pathname = usePathname();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [privacyNoticeOpen, setPrivacyNoticeOpen] = useState(false);

  const roleConfig = getDashboardRoleConfig(user.role, copy);
  const navItems = getDashboardNavItems(user.role, copy);
  const displayName = getUserDisplayName(user);
  const userInitial = getUserInitial(user);

  const toggleSidebar = () => {
    setIsSidebarCollapsed((prev) => !prev);
  };

  return (
    <div className="dash-root">
      {/* Soft floating decorative artwork */}
      <div className="dash-art" aria-hidden="true">
        <div className="blob dash-b1" />
        <div className="blob dash-b2" />
        <div className={`blob dash-b3-${roleConfig.viewType}`} />
      </div>

      <div
        className={`dash-app ${isSidebarCollapsed ? 'sb-collapsed' : ''} ${visualVariant === 'profile' ? 'dash-app-profile' : ''}`}
      >
        {/* Sticky left sidebar */}
        <aside
          className="dash-sidebar"
          id="dashboard-sidebar"
          aria-label={copy.dashboard.common.eyebrow}
          aria-hidden={isSidebarCollapsed || undefined}
          inert={isSidebarCollapsed || undefined}
        >
          <div className="dash-sb-head">
            <button
              type="button"
              onClick={toggleSidebar}
              className="dash-logo"
              aria-label={copy.dashboard.sidebar.closeSidebar}
              title={copy.dashboard.sidebar.closeSidebar}
            >
              <span className="mono">HK</span>
              <span>HKTutor</span>
            </button>
            <button
              type="button"
              onClick={toggleSidebar}
              className="dash-sb-close"
              aria-label={copy.dashboard.sidebar.closeSidebar}
            >
              ✕
            </button>
          </div>

          <div className="dash-card dash-side-card dash-account-card dash-profile-nav-card">
            <div className="dash-user-chip" style={{ marginBottom: '1rem' }}>
              <div className={`dash-avatar dash-avatar-${roleConfig.viewType}`} aria-hidden="true">
                {userInitial}
              </div>
              <div className="min-w-0">
                <b className="block truncate text-sm font-extrabold text-[#1a1916]">
                  {displayName}
                </b>
                <span className="block truncate text-xs text-[#5e5a52]">{user.email}</span>
              </div>
            </div>

            <nav
              className={`dash-side-nav dash-side-nav-${roleConfig.viewType}`}
              aria-label="Sidebar Navigation"
            >
              {navItems.map((item) => {
                if (item.isDanger) {
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => void onLogout()}
                      className="danger"
                    >
                      <span className="flex items-center gap-2.5">
                        <span className="ico" aria-hidden="true">
                          <DashboardNavIcon name={item.icon} />
                        </span>
                        <span>{item.label}</span>
                      </span>
                    </button>
                  );
                }

                if (item.id === 'privacy') {
                  return (
                    <button key={item.id} type="button" onClick={() => setPrivacyNoticeOpen(true)}>
                      <span className="flex items-center gap-2.5">
                        <span className="ico" aria-hidden="true">
                          <DashboardNavIcon name={item.icon} />
                        </span>
                        <span>{item.label}</span>
                      </span>
                    </button>
                  );
                }

                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    className={
                      item.id === 'profile' && pathname === '/dashboard/profile'
                        ? 'is-active'
                        : undefined
                    }
                  >
                    <span className="flex items-center gap-2.5">
                      <span className="ico" aria-hidden="true">
                        <DashboardNavIcon name={item.icon} />
                      </span>
                      <span>{item.label}</span>
                    </span>
                    {item.badge !== undefined && (
                      <span
                        className="rounded-full px-2 py-0.5 text-xs font-bold"
                        style={{
                          background: roleConfig.softBg,
                          color: roleConfig.accentDeepColor,
                        }}
                      >
                        {item.badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="dash-card dash-side-card">
            <h2>{copy.dashboard.sidebar.needHelpTitle}</h2>
            <p>{copy.dashboard.sidebar.needHelpBody}</p>
            <button type="button" onClick={() => setPrivacyNoticeOpen(true)} className="dash-link">
              {copy.dashboard.sidebar.privacyNoticeLink}
            </button>
          </div>
        </aside>

        {/* Main Column */}
        <div className="dash-main-wrap">
          <header className="dash-header">
            <button
              type="button"
              onClick={toggleSidebar}
              className="dash-reopen-logo"
              aria-label={copy.dashboard.sidebar.openSidebar}
              title={copy.dashboard.sidebar.openSidebar}
            >
              <span className="mono">HK</span>
              <span className="reopen-txt font-black tracking-[-0.08em]">HKTutor</span>
              <span className="burger" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            </button>

            <nav aria-label="Dashboard Top Navigation">
              {visualVariant === 'profile' && (
                <NotificationMenu userRole={user.role} copy={copy.dashboard.header} />
              )}
              <button
                type="button"
                onClick={toggleLanguage}
                aria-label={copy.common.languageButtonLabel}
                aria-pressed={language === 'th'}
                className="dash-lang-btn"
              >
                <span className="dot" style={{ backgroundColor: roleConfig.accentColor }} />
                <span>{language.toUpperCase()}</span>
              </button>

              {headerNavRight}
            </nav>
          </header>

          <main className="dash-main">{children}</main>

          <footer className="dash-footer">
            <span>
              © {new Date().getFullYear()} {copy.dashboard.common.copyright}
            </span>
            <span className="sep">|</span>
            <button
              type="button"
              onClick={() => setPrivacyNoticeOpen(true)}
              style={{ color: 'inherit' }}
            >
              {copy.dashboard.common.privacySupport}
            </button>
          </footer>
        </div>
      </div>
      <PrivacyNoticeModal open={privacyNoticeOpen} onClose={() => setPrivacyNoticeOpen(false)} />
    </div>
  );
}

type NotificationMenuCopy = {
  notifications: string;
  notificationsUnread: string;
  markAllNotificationsRead: string;
  noNotifications: string;
  profileNotificationTitle: string;
  profileNotificationBody: string;
  listingNotificationTitle: string;
  listingNotificationBody: string;
  privacyNotificationTitle: string;
  privacyNotificationBody: string;
};

type NotificationItem = {
  id: string;
  href: string;
  title: string;
  body: string;
};

function NotificationMenu({
  userRole,
  copy,
}: {
  userRole: AuthUser['role'];
  copy: NotificationMenuCopy;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [hasUnread, setHasUnread] = useState(true);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const closeOnPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('pointerdown', closeOnPointerDown);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isOpen]);

  const items: NotificationItem[] =
    userRole === 'TUTOR'
      ? [
          {
            id: 'profile',
            href: '/dashboard/profile',
            title: copy.profileNotificationTitle,
            body: copy.profileNotificationBody,
          },
          {
            id: 'listing',
            href: '/dashboard/listings/new',
            title: copy.listingNotificationTitle,
            body: copy.listingNotificationBody,
          },
        ]
      : [
          {
            id: 'profile',
            href: '/dashboard/profile',
            title: copy.profileNotificationTitle,
            body: copy.profileNotificationBody,
          },
          {
            id: 'privacy',
            href: '/dashboard/profile#privacy',
            title: copy.privacyNotificationTitle,
            body: copy.privacyNotificationBody,
          },
        ];

  const unreadCount = hasUnread ? items.length : 0;
  const unreadLabel = copy.notificationsUnread.replace('{count}', String(unreadCount));

  return (
    <div className="dash-notification-wrap" ref={menuRef}>
      <button
        type="button"
        className="dash-notification-trigger"
        aria-label={`${copy.notifications}${unreadCount ? `, ${unreadLabel}` : ''}`}
        aria-expanded={isOpen}
        aria-controls="dashboard-notifications"
        onClick={() => setIsOpen((open) => !open)}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 8.5h18C21 16 18 16 18 9Z" />
          <path d="M10 21h4" />
        </svg>
        {unreadCount > 0 && <span className="dash-notification-badge">{unreadCount}</span>}
      </button>

      {isOpen && (
        <div className="dash-notification-popover" id="dashboard-notifications" role="dialog">
          <div className="dash-notification-head">
            <div>
              <h2>{copy.notifications}</h2>
              <p>{unreadCount ? unreadLabel : copy.noNotifications}</p>
            </div>
            {unreadCount > 0 && (
              <button type="button" onClick={() => setHasUnread(false)}>
                {copy.markAllNotificationsRead}
              </button>
            )}
          </div>

          <div className="dash-notification-list">
            {items.length > 0 ? (
              items.map((item) => (
                <Link
                  key={item.id}
                  href={item.href}
                  className={`dash-notification-item${hasUnread ? ' is-unread' : ''}`}
                  onClick={() => setIsOpen(false)}
                >
                  <span className="dash-notification-item-dot" aria-hidden="true" />
                  <span>
                    <strong>{item.title}</strong>
                    <span>{item.body}</span>
                  </span>
                </Link>
              ))
            ) : (
              <p className="dash-notification-empty">{copy.noNotifications}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default DashboardShell;

function DashboardNavIcon({ name }: { name: string }) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeWidth: 1.8,
  };

  if (name === 'profile') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" {...common}>
        <circle cx="12" cy="8" r="3.2" />
        <path d="M5.5 20c.7-3.1 3.1-4.8 6.5-4.8s5.8 1.7 6.5 4.8" />
      </svg>
    );
  }

  if (name === 'listings') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" {...common}>
        <path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H19v17H7.5A2.5 2.5 0 0 1 5 17.5z" />
        <path d="M8 3v17M11.5 7h4.5M11.5 10.5h4.5" />
      </svg>
    );
  }

  if (name === 'availability') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" {...common}>
        <rect x="4" y="5.5" width="16" height="15" rx="2" />
        <path d="M8 3.5v4M16 3.5v4M4 9.5h16M8 13h3M8 16.5h3M14 13h2" />
      </svg>
    );
  }

  if (name === 'bookings') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" {...common}>
        <rect x="5" y="4.5" width="14" height="16" rx="2" />
        <path d="M9 4.5V3h6v1.5M9 10h6M9 13.5h6M9 17h3" />
      </svg>
    );
  }

  if (name === 'settings') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" {...common}>
        <path d="m12 3 1.1 1.9 2.2.5 1.8-1 1.5 1.5-1 1.8.5 2.2L20 11v2l-1.9 1.1-.5 2.2 1 1.8-1.5 1.5-1.8-1-2.2.5L12 21l-1.1-1.9-2.2-.5-1.8 1-1.5-1.5 1-1.8-.5-2.2L4 13v-2l1.9-1.1.5-2.2-1-1.8L6.9 4.4l1.8 1 2.2-.5z" />
        <circle cx="12" cy="12" r="2.7" />
      </svg>
    );
  }

  if (name === 'support') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" {...common}>
        <path d="M4 13v-1a8 8 0 0 1 16 0v1" />
        <path d="M4 13h3v5H5.5A1.5 1.5 0 0 1 4 16.5zM20 13h-3v5h1.5a1.5 1.5 0 0 0 1.5-1.5zM17 18c0 1.1-.9 2-2 2h-2" />
      </svg>
    );
  }

  if (name === 'privacy') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" {...common}>
        <path d="M12 3.5 19 6v5.3c0 4.5-2.7 7.6-7 9.2-4.3-1.6-7-4.7-7-9.2V6z" />
        <rect x="9.2" y="10.5" width="5.6" height="5" rx="1" />
        <path d="M10.5 10.5V9.3a1.5 1.5 0 0 1 3 0v1.2" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...common}>
      <path d="M14 5h4.5A1.5 1.5 0 0 1 20 6.5v11a1.5 1.5 0 0 1-1.5 1.5H14M10 8l-4 4 4 4M6 12h9" />
    </svg>
  );
}
