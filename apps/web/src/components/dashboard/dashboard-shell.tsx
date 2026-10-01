'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { DashboardIcon } from '@/components/dashboard/dashboard-icon';
import { DashboardNotificationMenu } from '@/components/dashboard/dashboard-notification-menu';
import PrivacyNoticeModal from '@/components/privacy-notice-modal';
import { NotebookPage, WashiTape } from '@/components/ui/notebook';
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
  userAvatarUrl?: string | null;
  showSignOut?: boolean;
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
  }
>;

const navItemClass =
  'flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border border-paper-edge/70 bg-paper/55 px-2.5 py-2 text-left text-sm font-semibold text-notebook-ink no-underline shadow-[0_2px_0_rgba(120,113,108,0.08)] transition hover:translate-x-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-notebook-ink/25';

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
  userAvatarUrl,
  showSignOut = true,
}: DashboardShellProps) {
  const { language, copy, toggleLanguage } = useLanguage();
  const pathname = usePathname();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebar, setIsMobileSidebar] = useState(false);
  const [privacyNoticeOpen, setPrivacyNoticeOpen] = useState(false);
  const mobileSidebarButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarCloseButtonRef = useRef<HTMLButtonElement>(null);

  const viewType = resolveDashboardView(user.role);
  const theme = roleStyles[viewType];
  const navItems = getDashboardNavItems(user.role, copy);
  const displayName = getUserDisplayName(user);
  const userInitial = getUserInitial(user);
  const roleLabel =
    viewType === 'student'
      ? copy.dashboard.common.studentChip
      : viewType === 'tutor'
        ? copy.dashboard.common.tutorChip
        : copy.dashboard.common.adminChip;

  const toggleSidebar = () => {
    setIsSidebarCollapsed((current) => {
      const next = !current;
      if (!isMobileSidebar) {
        try {
          window.localStorage.setItem(sidebarStorageKey, String(next));
        } catch {
          // The sidebar remains usable when browser storage is unavailable.
        }
      }
      return next;
    });
  };

  const openMobileSidebar = () => {
    setIsSidebarCollapsed(false);
    window.requestAnimationFrame(() => sidebarCloseButtonRef.current?.focus());
  };

  const closeMobileSidebar = (restoreFocus = false) => {
    setIsSidebarCollapsed(true);
    if (restoreFocus) {
      window.requestAnimationFrame(() => mobileSidebarButtonRef.current?.focus());
    }
  };

  useEffect(() => {
    const media = window.matchMedia('(max-width: 1023px)');
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
      if (event.key === 'Escape') closeMobileSidebar(true);
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
        {isMobileSidebar && isSidebarCollapsed && (
          <button
            ref={mobileSidebarButtonRef}
            type="button"
            onClick={openMobileSidebar}
            className="fixed left-3 top-3 z-40 inline-flex h-12 w-12 items-center justify-center rounded-xl border border-notebook-ink bg-notebook-ink text-paper shadow-[0_3px_0_#57534e] transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-notebook-ink/30 focus-visible:ring-offset-2 lg:hidden"
            aria-label={copy.dashboard.sidebar.openSidebar}
            aria-controls="dashboard-sidebar"
            aria-expanded="false"
          >
            <span className="space-y-1" aria-hidden="true">
              <i className="block h-0.5 w-5 rounded-full bg-paper" />
              <i className="block h-0.5 w-4 rounded-full bg-paper" />
              <i className="block h-0.5 w-5 rounded-full bg-paper" />
            </span>
          </button>
        )}

        {isMobileSidebar && !isSidebarCollapsed && (
          <button
            type="button"
            className="fixed inset-0 z-30 cursor-pointer border-0 bg-stone-900/40 backdrop-blur-[1px]"
            aria-label={copy.dashboard.sidebar.closeSidebar}
            onClick={() => closeMobileSidebar(true)}
          />
        )}

        <aside
          className={classes(
            'fixed inset-y-0 left-0 z-40 flex h-dvh w-[min(19rem,calc(100vw-1rem))] flex-col gap-4 overflow-y-auto border-r border-paper-edge bg-paper/95 px-4 py-4 shadow-paper backdrop-blur transition-[width,padding,transform] duration-300 [scrollbar-width:none] motion-reduce:transition-none [&::-webkit-scrollbar]:hidden lg:sticky lg:top-0 lg:z-20 lg:shadow-none',
            isSidebarCollapsed
              ? '-translate-x-full lg:w-20 lg:translate-x-0 lg:px-2.5'
              : 'translate-x-0 lg:w-72',
          )}
          id="dashboard-sidebar"
          aria-label={copy.dashboard.common.eyebrow}
          aria-hidden={isMobileSidebar && isSidebarCollapsed ? true : undefined}
          inert={isMobileSidebar && isSidebarCollapsed ? true : undefined}
        >
          <span
            className="pointer-events-none absolute inset-y-0 left-1.5 w-px bg-margin-guide/45"
            aria-hidden="true"
          />
          <div
            className={classes(
              'relative flex min-h-12 items-center gap-2',
              isSidebarCollapsed ? 'justify-center' : 'justify-between',
            )}
          >
            {isSidebarCollapsed ? (
              <button
                type="button"
                onClick={toggleSidebar}
                className="group inline-flex h-12 w-12 items-center justify-center rounded-xl border border-notebook-ink bg-notebook-ink text-xs font-black tracking-tight text-paper shadow-[0_3px_0_#57534e] transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-notebook-ink/30 focus-visible:ring-offset-2"
                aria-label={copy.dashboard.sidebar.openSidebar}
                aria-controls="dashboard-sidebar"
                aria-expanded="false"
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
                  className="relative inline-flex items-center gap-2.5 rounded-xl border border-paper-edge/70 bg-paper px-2.5 py-2 text-notebook-ink no-underline shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-notebook-ink/30"
                  aria-label={copy.dashboard.common.eyebrow}
                  title={copy.dashboard.common.eyebrow}
                  onClick={() => {
                    if (isMobileSidebar) closeMobileSidebar();
                  }}
                >
                  <WashiTape tone="yellow" className="-top-2 left-1/2 h-3 w-14 -translate-x-1/2" />
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-notebook-ink bg-notebook-ink text-xs font-black tracking-tight text-paper shadow-[0_3px_0_#57534e]">
                    HK
                  </span>
                  <span className="font-note text-3xl font-bold tracking-normal">HKTutor</span>
                </Link>
                <button
                  ref={sidebarCloseButtonRef}
                  type="button"
                  onClick={() => {
                    if (isMobileSidebar) closeMobileSidebar(true);
                    else toggleSidebar();
                  }}
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-paper-edge bg-paper text-notebook-muted shadow-sm transition hover:-translate-x-0.5 hover:bg-sticky-yellow/60 hover:text-notebook-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-notebook-ink/30"
                  aria-label={copy.dashboard.sidebar.closeSidebar}
                  aria-controls="dashboard-sidebar"
                  aria-expanded="true"
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

          <nav
            className="relative flex w-full flex-col gap-1.5"
            aria-label={copy.dashboard.common.sidebarNavigationLabel}
          >
            {navItems.map((item) => {
              const badge = navBadges?.[item.id] ?? item.badge;
              const icon = (
                <span
                  className={classes(
                    'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg shadow-sm',
                    theme.icon,
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

              if (item.id === 'privacy') {
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      if (isMobileSidebar) closeMobileSidebar();
                      setPrivacyNoticeOpen(true);
                    }}
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
                  onClick={() => {
                    if (isMobileSidebar) closeMobileSidebar();
                  }}
                >
                  {content}
                </Link>
              );
            })}
          </nav>

          <div
            className={classes(
              'relative mt-auto border-t border-dashed border-paper-edge pt-4',
              isSidebarCollapsed && 'flex flex-col items-center gap-2',
            )}
          >
            {isSidebarCollapsed ? (
              <>
                <SidebarAvatar
                  displayName={displayName}
                  imageUrl={userAvatarUrl}
                  initial={userInitial}
                  className={theme.avatar}
                />
                {showSignOut && (
                  <button
                    type="button"
                    onClick={() => void onLogout()}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-red-200 bg-red-50 text-red-700 shadow-sm transition hover:-translate-y-0.5 hover:bg-sticky-pink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
                    aria-label={copy.dashboard.nav.signOut}
                    title={copy.dashboard.nav.signOut}
                  >
                    <DashboardIcon name="logout" className="h-5 w-5" />
                  </button>
                )}
              </>
            ) : (
              <div className="relative rounded-2xl border border-paper-edge bg-paper p-3 shadow-note">
                <WashiTape
                  tone={viewType === 'tutor' ? 'blue' : 'yellow'}
                  className="-top-2 left-1/2 h-4 w-16 -translate-x-1/2"
                />
                <div className="flex min-w-0 items-center gap-3">
                  <SidebarAvatar
                    displayName={displayName}
                    imageUrl={userAvatarUrl}
                    initial={userInitial}
                    className={theme.avatar}
                  />
                  <div className="min-w-0 flex-1">
                    <b className="block truncate text-sm font-extrabold text-notebook-ink">
                      {displayName}
                    </b>
                    {user.email && (
                      <span className="block truncate text-[0.7rem] text-notebook-muted">
                        {user.email}
                      </span>
                    )}
                    <span
                      className={classes(
                        'mt-1 inline-flex rounded-full px-2 py-0.5 text-[0.62rem] font-extrabold uppercase tracking-[0.08em]',
                        theme.badge,
                      )}
                    >
                      {roleLabel}
                    </span>
                  </div>
                </div>
                {showSignOut && (
                  <button
                    type="button"
                    onClick={() => void onLogout()}
                    className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 text-xs font-extrabold text-red-700 transition hover:-translate-y-0.5 hover:bg-sticky-pink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
                  >
                    <DashboardIcon name="logout" className="h-4 w-4" />
                    {copy.dashboard.nav.signOut}
                  </button>
                )}
              </div>
            )}
          </div>
        </aside>

        <div className="flex min-w-0 flex-col">
          <header className="sticky top-0 z-20 flex min-h-20 items-center justify-end border-b border-dashed border-paper-edge bg-paper/85 py-3 pl-20 pr-3 backdrop-blur-md sm:px-5 sm:pl-20 lg:px-8">
            <nav
              className="ml-auto flex min-w-0 items-center gap-2 text-sm sm:gap-3 [&>[data-dashboard-action]]:min-h-11 [&>[data-dashboard-action]]:rounded-lg [&>[data-dashboard-action]]:border [&>[data-dashboard-action]]:border-notebook-ink [&>[data-dashboard-action]]:bg-notebook-ink [&>[data-dashboard-action]]:px-3.5 [&>[data-dashboard-action]]:py-2 [&>[data-dashboard-action]]:font-bold [&>[data-dashboard-action]]:text-paper [&>[data-dashboard-action]]:shadow-[0_3px_0_#57534e] [&>[data-dashboard-action]]:transition [&>[data-dashboard-action]]:hover:-translate-y-0.5 [&>a:not([data-dashboard-action])]:font-bold [&>a:not([data-dashboard-action])]:text-notebook-ink [&>a:not([data-dashboard-action])]:underline [&>a:not([data-dashboard-action])]:decoration-margin-guide [&>a:not([data-dashboard-action])]:decoration-2 [&>a:not([data-dashboard-action])]:underline-offset-4 max-[560px]:[&>a:not([data-dashboard-action])]:hidden"
              aria-label={copy.dashboard.common.topNavigationLabel}
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

function SidebarAvatar({
  displayName,
  imageUrl,
  initial,
  className,
}: {
  displayName: string;
  imageUrl: string | null | undefined;
  initial: string;
  className: string;
}) {
  return (
    <span
      className={classes(
        'relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-paper text-base font-black shadow-sm ring-1 ring-paper-edge',
        className,
      )}
      role="img"
      aria-label={displayName}
    >
      {imageUrl ? (
        <Image src={imageUrl} alt="" fill sizes="48px" className="object-cover" unoptimized />
      ) : (
        <span aria-hidden="true">{initial}</span>
      )}
    </span>
  );
}

export default DashboardShell;
