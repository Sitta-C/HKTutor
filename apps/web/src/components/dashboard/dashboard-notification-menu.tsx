'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { DashboardIcon } from '@/components/dashboard/dashboard-icon';
import { WashiTape } from '@/components/ui/notebook';

import type { AuthUser } from '@/lib/api/types';

export type DashboardNotificationCopy = {
  notifications: string;
  notificationClose: string;
  notificationNow: string;
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
  icon: 'profile' | 'listings' | 'shield';
};

export function DashboardNotificationMenu({
  userRole,
  copy,
}: {
  userRole: AuthUser['role'];
  copy: DashboardNotificationCopy;
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
            icon: 'profile',
          },
          {
            id: 'listing',
            href: '/dashboard/listings/new',
            title: copy.listingNotificationTitle,
            body: copy.listingNotificationBody,
            icon: 'listings',
          },
        ]
      : [
          {
            id: 'profile',
            href: '/dashboard/profile',
            title: copy.profileNotificationTitle,
            body: copy.profileNotificationBody,
            icon: 'profile',
          },
          {
            id: 'privacy',
            href: '/dashboard/profile#privacy',
            title: copy.privacyNotificationTitle,
            body: copy.privacyNotificationBody,
            icon: 'shield',
          },
        ];

  const unreadCount = hasUnread ? items.length : 0;
  const unreadLabel = copy.notificationsUnread.replace('{count}', String(unreadCount));

  return (
    <div className="relative inline-flex shrink-0" ref={menuRef}>
      <button
        type="button"
        className="relative inline-flex h-11 w-11 items-center justify-center rounded-lg border border-paper-edge bg-paper/90 text-notebook-muted shadow-sm transition hover:-translate-y-0.5 hover:border-amber-400 hover:bg-white hover:text-notebook-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
        aria-label={`${copy.notifications}${unreadCount ? `, ${unreadLabel}` : ''}`}
        aria-expanded={isOpen}
        aria-controls="dashboard-notifications"
        onClick={() => setIsOpen((open) => !open)}
      >
        <DashboardIcon name="bell" className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-1.5 -top-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-paper bg-red-600 px-1 text-[0.65rem] font-black leading-none text-white">
            {unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          className="fixed left-3 right-3 top-[4.75rem] z-50 overflow-hidden rounded-2xl border border-paper-edge bg-paper shadow-paper sm:absolute sm:left-auto sm:right-0 sm:top-[calc(100%+0.75rem)] sm:w-96"
          id="dashboard-notifications"
          role="region"
          aria-labelledby="dashboard-notifications-title"
        >
          <WashiTape tone="yellow" className="-top-2 left-1/2 -translate-x-1/2" />
          <div className="flex items-start justify-between gap-4 border-b border-dashed border-paper-edge px-4 pb-3 pt-5">
            <div>
              <div className="flex items-center gap-2.5">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-sticky-yellow text-amber-700">
                  <DashboardIcon name="bell" className="h-4 w-4" />
                </span>
                <h2 id="dashboard-notifications-title" className="text-base font-black">
                  {copy.notifications}
                </h2>
              </div>
              <p className="mt-1 text-xs text-notebook-muted">
                {unreadCount ? unreadLabel : copy.noNotifications}
              </p>
            </div>
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-notebook-muted transition hover:bg-sticky-pink hover:text-notebook-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
              aria-label={copy.notificationClose}
              onClick={() => setIsOpen(false)}
            >
              <DashboardIcon name="close" className="h-4 w-4" />
            </button>
          </div>

          {unreadCount > 0 && (
            <div className="flex items-center justify-between gap-3 bg-sticky-yellow/35 px-4 py-2.5 text-xs font-bold text-notebook-muted">
              <span>{unreadLabel}</span>
              <button
                type="button"
                className="font-extrabold text-amber-800 underline decoration-amber-400 decoration-2 underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                onClick={() => setHasUnread(false)}
              >
                {copy.markAllNotificationsRead}
              </button>
            </div>
          )}

          <div className="grid">
            {items.length > 0 ? (
              items.map((item) => (
                <Link
                  key={item.id}
                  href={item.href}
                  className="grid grid-cols-[2.25rem_minmax(0,1fr)_0.5rem] items-start gap-3 border-b border-dashed border-paper-edge px-4 py-3.5 text-notebook-ink no-underline transition last:border-b-0 hover:bg-sticky-yellow/25 focus-visible:bg-sticky-yellow/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-400"
                  onClick={() => {
                    setHasUnread(false);
                    setIsOpen(false);
                  }}
                >
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-sticky-blue text-blue-800">
                    <DashboardIcon name={item.icon} className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="flex items-baseline justify-between gap-2">
                      <strong className="text-sm font-extrabold">{item.title}</strong>
                      <time className="shrink-0 text-[0.7rem] text-notebook-muted">
                        {copy.notificationNow}
                      </time>
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-notebook-muted">
                      {item.body}
                    </span>
                  </span>
                  <span
                    className={`mt-2 h-2 w-2 rounded-full ${hasUnread ? 'bg-amber-500' : 'bg-transparent'}`}
                    aria-hidden="true"
                  />
                </Link>
              ))
            ) : (
              <p className="px-4 py-6 text-center text-sm text-notebook-muted">
                {copy.noNotifications}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
