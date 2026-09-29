'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { DashboardIcon } from '@/components/dashboard/dashboard-icon';
import { DashboardNotificationMenu } from '@/components/dashboard/dashboard-notification-menu';
import PrivacyNoticeModal from '@/components/privacy-notice-modal';
import { GraphPaper, NotebookPage, StickyNote, WashiTape } from '@/components/ui/notebook';
import {
  getDashboardNavItems,
  getUserDisplayName,
  getUserInitial,
  isDashboardNavActive,
  resolveDashboardView,
} from '@/lib/dashboard-navigation';
import { formatBangkokYear } from '@/lib/date-time';
import { useLanguage } from '@/lib/i18n';

import type { AuthUser } from '@/lib/api/types';
import type { DashboardViewType } from '@/lib/dashboard-navigation';
import type { ReactNode } from 'react';

export interface DashboardShellProps {
  user: AuthUser;
  onLogout: () => Promise<void>;
  children: ReactNode;
  headerNavRight?: ReactNode;
  visualVariant?: 'default' | 'profile';
  navBadges?: Partial<Record<string, string>>;
}

const sidebarStorageKey = 'hktutor-sidebar-collapsed';

const roleStyles = {
  student: {
    active:
      'border-emerald-300 bg-sticky-green text-emerald-900 shadow-[inset_4px_0_0_var(--color-student)]',
    avatar: 'bg-student-deep text-white',
    badge: 'bg-sticky-green text-student-deep',
    decoration: 'bg-sticky-green/55',
    dot: 'bg-student',
    hover: 'hover:bg-sticky-green/60',
    icon: 'bg-emerald-50 text-student-deep',
    noteTone: 'green',
  },
  tutor: {
    active:
      'border-blue-300 bg-sticky-blue text-blue-900 shadow-[inset_4px_0_0_var(--color-tutor)]',
    avatar: 'bg-tutor-deep text-white',
    badge: 'bg-sticky-blue text-tutor-deep',
    decoration: 'bg-sticky-blue/60',
    dot: 'bg-tutor',
    hover: 'hover:bg-sticky-blue/60',
    icon: 'bg-blue-50 text-tutor-deep',
    noteTone: 'blue',
  },
  admin: {
    active:
      'border-amber-300 bg-sticky-yellow text-amber-900 shadow-[inset_4px_0_0_var(--color-admin)]',
    avatar: 'bg-admin-deep text-white',
    badge: 'bg-sticky-yellow text-admin-deep',
    decoration: 'bg-sticky-yellow/70',
    dot: 'bg-admin',
    hover: 'hover:bg-sticky-yellow/60',
    icon: 'bg-amber-50 text-admin-deep',
    noteTone: 'yellow',
  },
} as const satisfies Record<
  DashboardViewType,
  {
    active: string;
    avatar: string;
    badge: string;
    decoration: string;
    dot: string;
    hover: string;
    icon: string;
    noteTone: 'green' | 'blue' | 'yellow';
  }
>;

const navItemClass =
  'flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-transparent px-2.5 py-2 text-left text-sm font-semibold text-notebook-ink no-underline transition hover:translate-x-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-notebook-ink/25';

function classes(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

export function DashboardShell({
  user,
  onLogout,
  children,
  headerNavRight,
  visualVariant = 'default',
  navBadges,
}: DashboardShellProps) {
  const { language, copy, toggleLanguage } = useLanguage();
  const pathname = usePathname();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebar, setIsMobileSidebar] = useState(false);
  const [privacyNoticeOpen, setPrivacyNoticeOpen] = useState(false);

  const viewType = resolveDashboardView(user.role);
  const theme = roleStyles[viewType];
  const navItems = getDashboardNavItems(user.role, copy);
  const displayName = getUserDisplayName(user);
  const userInitial = getUserInitial(user);

  const toggleSidebar = () => {
    setIsSidebarCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(sidebarStorageKey, String(next));
      } catch {
        // The sidebar remains usable when browser storage is unavailable.
      }
      return next;
    });
  };

  useEffect(() => {
    const media = window.matchMedia('(max-width: 960px)');
    const syncSidebar = () => {
      setIsMobileSidebar(media.matches);
      let savedPreference = false;
      try {
        savedPreference = window.localStorage.getItem(sidebarStorageKey) === 'true';
      } catch {
        // Default to the expanded desktop shell when browser storage is unavailable.
      }
      setIsSidebarCollapsed(media.matches ? true : savedPreference);
    };

    syncSidebar();
    media.addEventListener('change', syncSidebar);
    return () => media.removeEventListener('change', syncSidebar);
  }, []);

  useEffect(() => {
    if (!isMobileSidebar || isSidebarCollapsed) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isMobileSidebar, isSidebarCollapsed]);

  useEffect(() => {
    if (!isMobileSidebar || isSidebarCollapsed) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsSidebarCollapsed(true);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [isMobileSidebar, isSidebarCollapsed]);

  return (
    <NotebookPage className="relative overflow-x-clip bg-paper">
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -right-24 -top-20 h-64 w-64 rotate-6 rounded-[2rem] border border-blue-200/60 bg-sticky-blue/25" />
        <div
          className={classes(
            'absolute -bottom-24 left-[12%] h-64 w-64 -rotate-6 rounded-full blur-sm',
            theme.decoration,
          )}
        />
      </div>

      <div
        className={classes(
          'relative z-10 min-h-dvh transition-[grid-template-columns] duration-300 lg:grid',
          isSidebarCollapsed
            ? 'lg:grid-cols-[5rem_minmax(0,1fr)]'
            : 'lg:grid-cols-[18rem_minmax(0,1fr)]',
        )}
      >
        {isMobileSidebar && !isSidebarCollapsed && (
          <button
            type="button"
            className="fixed inset-0 z-30 cursor-pointer border-0 bg-stone-900/40 backdrop-blur-[1px]"
            aria-label={copy.dashboard.sidebar.closeSidebar}
            onClick={() => setIsSidebarCollapsed(true)}
          />
        )}

        <aside
          className={classes(
            'fixed inset-y-0 left-0 z-40 flex h-dvh flex-col gap-4 overflow-y-auto border-r border-paper-edge bg-paper-deep/95 py-4 shadow-paper backdrop-blur transition-[width,padding] duration-300 [scrollbar-width:none] motion-reduce:transition-none [&::-webkit-scrollbar]:hidden lg:sticky lg:top-0 lg:z-20 lg:shadow-none',
            isSidebarCollapsed ? 'w-20 px-2.5' : 'w-[min(19rem,calc(100vw-1rem))] px-4 lg:w-72',
          )}
          id="dashboard-sidebar"
          aria-label={copy.dashboard.common.eyebrow}
        >
          <div
            className={classes(
              'flex min-h-12 items-center gap-2',
              isSidebarCollapsed ? 'justify-center' : 'justify-between',
            )}
          >
            {isSidebarCollapsed ? (
              <button
                type="button"
                onClick={toggleSidebar}
                className="group inline-flex h-12 w-12 items-center justify-center rounded-xl border border-notebook-ink bg-notebook-ink text-xs font-black tracking-tight text-paper shadow-[0_3px_0_#57534e] transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-notebook-ink/30 focus-visible:ring-offset-2"
                aria-label={copy.dashboard.sidebar.openSidebar}
                title={copy.dashboard.sidebar.openSidebar}
              >
                <span className="group-hover:hidden">HK</span>
                <span className="hidden space-y-1 group-hover:block" aria-hidden="true">
                  <i className="block h-0.5 w-5 rounded-full bg-paper" />
                  <i className="block h-0.5 w-4 rounded-full bg-paper" />
                  <i className="block h-0.5 w-5 rounded-full bg-paper" />
                </span>
              </button>
            ) : (
              <>
                <Link
                  href="/dashboard"
                  className="inline-flex items-center gap-2.5 rounded-lg text-notebook-ink no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-notebook-ink/30"
                  aria-label={copy.dashboard.common.eyebrow}
                  title={copy.dashboard.common.eyebrow}
                >
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-notebook-ink bg-notebook-ink text-xs font-black tracking-tight text-paper shadow-[0_3px_0_#57534e]">
                    HK
                  </span>
                  <span className="font-note text-3xl font-bold tracking-normal">HKTutor</span>
                </Link>
                <button
                  type="button"
                  onClick={toggleSidebar}
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-paper-edge bg-paper text-notebook-muted shadow-sm transition hover:-translate-x-0.5 hover:bg-sticky-yellow/60 hover:text-notebook-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-notebook-ink/30"
                  aria-label={copy.dashboard.sidebar.closeSidebar}
                  title={copy.dashboard.sidebar.closeSidebar}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="h-5 w-5"
                    aria-hidden="true"
                  >
                    <path d="m14.5 5-7 7 7 7" />
                  </svg>
                </button>
              </>
            )}
          </div>

          {!isSidebarCollapsed && (
            <StickyNote tone={theme.noteTone} className="mt-1 p-3.5">
              <WashiTape
                tone={viewType === 'tutor' ? 'blue' : 'yellow'}
                className="-top-2 left-1/2 -translate-x-1/2"
              />
              <div className="flex items-center gap-3">
                <div
                  className={classes(
                    'flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base font-black shadow-sm',
                    theme.avatar,
                  )}
                  aria-hidden="true"
                >
                  {userInitial}
                </div>
                <div className="min-w-0">
                  <b className="block truncate text-sm font-extrabold text-notebook-ink">
                    {displayName}
                  </b>
                  <span className="block truncate text-xs text-notebook-muted">{user.email}</span>
                </div>
              </div>
            </StickyNote>
          )}

          <nav className="flex w-full flex-col gap-1" aria-label="Sidebar Navigation">
            {navItems.map((item) => {
              const badge = navBadges?.[item.id] ?? item.badge;
              const icon = (
                <span
                  className={classes(
                    'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg shadow-sm',
                    item.isDanger ? 'bg-red-50 text-red-700' : theme.icon,
                  )}
                  aria-hidden="true"
                >
                  <DashboardIcon name={item.icon} className="h-[1.1rem] w-[1.1rem]" />
                </span>
              );
              const content = (
                <>
                  <span className="flex min-w-0 items-center gap-2.5">
                    {icon}
                    {!isSidebarCollapsed && <span className="truncate">{item.label}</span>}
                  </span>
                  {!isSidebarCollapsed && badge !== undefined && (
                    <span
                      className={classes(
                        'rounded-full px-2 py-0.5 text-xs font-extrabold',
                        theme.badge,
                      )}
                    >
                      {badge}
                    </span>
                  )}
                </>
              );
              const itemLayout = isSidebarCollapsed
                ? 'h-12 justify-center px-0 hover:translate-x-0'
                : undefined;

              if (item.isDanger) {
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => void onLogout()}
                    className={classes(
                      navItemClass,
                      itemLayout,
                      'text-red-700 hover:bg-sticky-pink/70',
                    )}
                    title={item.label}
                  >
                    {content}
                  </button>
                );
              }

              if (item.id === 'privacy') {
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setPrivacyNoticeOpen(true)}
                    className={classes(navItemClass, itemLayout, theme.hover)}
                    title={item.label}
                  >
                    {content}
                  </button>
                );
              }

              const isActive = isDashboardNavActive(item.id, pathname);

              return (
                <Link
                  key={item.id}
                  href={item.href}
                  className={classes(
                    navItemClass,
                    itemLayout,
                    isActive ? theme.active : theme.hover,
                    isSidebarCollapsed && isActive && 'shadow-none',
                  )}
                  aria-current={isActive ? 'page' : undefined}
                  title={item.label}
                >
                  {content}
                </Link>
              );
            })}
          </nav>

          {!isSidebarCollapsed && (
            <GraphPaper className="relative mt-auto p-4">
              <WashiTape tone="pink" className="-right-4 -top-2 rotate-6" />
              <h2 className="font-note text-xl font-bold text-notebook-ink">
                {copy.dashboard.sidebar.needHelpTitle}
              </h2>
              <p className="mt-1 text-xs leading-5 text-notebook-muted">
                {copy.dashboard.sidebar.needHelpBody}
              </p>
              <button
                type="button"
                onClick={() => setPrivacyNoticeOpen(true)}
                className="mt-2 text-xs font-extrabold text-notebook-ink underline decoration-margin-guide decoration-2 underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-notebook-ink/25"
              >
                {copy.dashboard.sidebar.privacyNoticeLink}
              </button>
            </GraphPaper>
          )}
        </aside>

        <div className="ml-20 flex min-w-0 flex-col lg:ml-0">
          <header className="sticky top-0 z-20 flex min-h-20 items-center justify-end border-b border-dashed border-paper-edge bg-paper/85 px-3 py-3 backdrop-blur-md sm:px-5 lg:px-8">
            <nav
              className="ml-auto flex min-w-0 items-center gap-2 text-sm sm:gap-3 [&>[data-dashboard-action]]:min-h-11 [&>[data-dashboard-action]]:rounded-lg [&>[data-dashboard-action]]:border [&>[data-dashboard-action]]:border-notebook-ink [&>[data-dashboard-action]]:bg-notebook-ink [&>[data-dashboard-action]]:px-3.5 [&>[data-dashboard-action]]:py-2 [&>[data-dashboard-action]]:font-bold [&>[data-dashboard-action]]:text-paper [&>[data-dashboard-action]]:shadow-[0_3px_0_#57534e] [&>[data-dashboard-action]]:transition [&>[data-dashboard-action]]:hover:-translate-y-0.5 [&>a:not([data-dashboard-action])]:font-bold [&>a:not([data-dashboard-action])]:text-notebook-ink [&>a:not([data-dashboard-action])]:underline [&>a:not([data-dashboard-action])]:decoration-margin-guide [&>a:not([data-dashboard-action])]:decoration-2 [&>a:not([data-dashboard-action])]:underline-offset-4 max-[560px]:[&>a:not([data-dashboard-action])]:hidden"
              aria-label="Dashboard Top Navigation"
            >
              {visualVariant === 'profile' && (
                <DashboardNotificationMenu userRole={user.role} copy={copy.dashboard.header} />
              )}
              <button
                type="button"
                onClick={toggleLanguage}
                aria-label={copy.common.languageButtonLabel}
                aria-pressed={language === 'th'}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-paper-edge bg-paper/90 px-3 text-xs font-extrabold text-notebook-ink shadow-sm transition hover:-translate-y-0.5 hover:bg-sticky-yellow/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-notebook-ink/25"
              >
                <span className={classes('h-2 w-2 rounded-full', theme.dot)} />
                <span>{language.toUpperCase()}</span>
              </button>

              {headerNavRight}
            </nav>
          </header>

          <main
            className={classes(
              'relative z-10 mx-auto w-[calc(100%-1.25rem)] min-w-0 flex-1 pb-12 sm:w-[calc(100%-2.5rem)]',
              visualVariant === 'profile' ? 'max-w-[1280px]' : 'max-w-[1200px]',
            )}
          >
            {children}
          </main>

          <footer className="relative z-10 px-4 pb-7 text-center text-sm text-notebook-muted">
            <span>
              © {formatBangkokYear(new Date(), language)} {copy.dashboard.common.copyright}
            </span>
            <span className="mx-3 text-paper-edge">|</span>
            <button
              type="button"
              onClick={() => setPrivacyNoticeOpen(true)}
              className="text-inherit underline decoration-margin-guide decoration-2 underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-notebook-ink/25"
            >
              {copy.dashboard.common.privacySupport}
            </button>
          </footer>
        </div>
      </div>
      <PrivacyNoticeModal open={privacyNoticeOpen} onClose={() => setPrivacyNoticeOpen(false)} />
    </NotebookPage>
  );
}

export default DashboardShell;
