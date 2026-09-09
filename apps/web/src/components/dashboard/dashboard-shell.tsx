'use client';

import Link from 'next/link';
import { useState } from 'react';

import {
  getDashboardNavItems,
  getDashboardRoleConfig,
  getUserDisplayName,
  getUserInitial,
} from '@/lib/dashboard-navigation';
import { useLanguage } from '@/lib/i18n';

import type { AuthUser } from '@/lib/auth-client';
import type { ReactNode } from 'react';

export interface DashboardShellProps {
  user: AuthUser;
  onLogout: () => Promise<void>;
  children: ReactNode;
  headerNavRight?: ReactNode;
}

export function DashboardShell({ user, onLogout, children, headerNavRight }: DashboardShellProps) {
  const { language, copy, toggleLanguage } = useLanguage();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

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

      <div className={`dash-app ${isSidebarCollapsed ? 'sb-collapsed' : ''}`}>
        {/* Sticky left sidebar */}
        <aside
          className="dash-sidebar"
          id="dashboard-sidebar"
          aria-label={copy.dashboard.common.eyebrow}
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

          <div className="dash-card dash-side-card" style={{ padding: '1.2rem' }}>
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
                          {item.icon}
                        </span>
                        <span>{item.label}</span>
                      </span>
                    </button>
                  );
                }

                return (
                  <Link key={item.id} href={item.href}>
                    <span className="flex items-center gap-2.5">
                      <span className="ico" aria-hidden="true">
                        {item.icon}
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
            <Link href="/privacy" className="dash-link">
              {copy.dashboard.sidebar.privacyNoticeLink}
            </Link>
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
            <Link href="/privacy" style={{ color: 'inherit' }}>
              {copy.dashboard.common.privacySupport}
            </Link>
          </footer>
        </div>
      </div>
    </div>
  );
}

export default DashboardShell;
