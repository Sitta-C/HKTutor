import type { ReactNode } from 'react';

export type DashboardIconName =
  | 'arrow-left'
  | 'arrow-right'
  | 'availability'
  | 'bell'
  | 'bookings'
  | 'calendar'
  | 'check'
  | 'clock'
  | 'close'
  | 'dashboard'
  | 'eye'
  | 'inbox'
  | 'info'
  | 'listings'
  | 'logout'
  | 'plus'
  | 'profile'
  | 'search'
  | 'settings'
  | 'shield'
  | 'star'
  | 'support'
  | 'trash';

export function DashboardIcon({
  name,
  className = 'h-5 w-5',
}: {
  name: DashboardIconName;
  className?: string;
}) {
  const paths: Record<DashboardIconName, ReactNode> = {
    'arrow-left': <path d="M19 12H5m6-6-6 6 6 6" />,
    'arrow-right': <path d="M5 12h14m-6-6 6 6-6 6" />,
    availability: (
      <>
        <rect x="4" y="5.5" width="16" height="15" rx="2" />
        <path d="M8 3.5v4M16 3.5v4M4 9.5h16M8 13h3M8 16.5h3M14 13h2" />
      </>
    ),
    bell: (
      <>
        <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 8.5h18C21 16 18 16 18 9Z" />
        <path d="M10 21h4" />
      </>
    ),
    bookings: (
      <>
        <rect x="5" y="4.5" width="14" height="16" rx="2" />
        <path d="M9 4.5V3h6v1.5M9 10h6M9 13.5h6M9 17h3" />
      </>
    ),
    calendar: (
      <>
        <rect x="4" y="5.5" width="16" height="15" rx="2" />
        <path d="M8 3.5v4M16 3.5v4M4 9.5h16M8 13h3M8 16.5h3M14 13h2" />
      </>
    ),
    check: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="m8.5 12 2.3 2.3 4.7-4.7" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    close: <path d="m6 6 12 12M18 6 6 18" />,
    dashboard: (
      <>
        <rect x="4" y="4" width="6" height="6" rx="1.5" />
        <rect x="14" y="4" width="6" height="6" rx="1.5" />
        <rect x="4" y="14" width="6" height="6" rx="1.5" />
        <rect x="14" y="14" width="6" height="6" rx="1.5" />
      </>
    ),
    eye: (
      <>
        <path d="M3.5 12s3.1-5 8.5-5 8.5 5 8.5 5-3.1 5-8.5 5-8.5-5-8.5-5Z" />
        <circle cx="12" cy="12" r="2.2" />
      </>
    ),
    inbox: (
      <>
        <path d="M4 13.5 6.5 5h11L20 13.5v4a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" />
        <path d="M4 13.5h4l1.5 2.5h5L16 13.5h4" />
      </>
    ),
    info: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 10.5v5M12 7.7h.01" />
      </>
    ),
    listings: (
      <>
        <path d="M6 4.5h12v15H6z" />
        <path d="M9 8h6M9 11.5h6M9 15h4" />
      </>
    ),
    logout: (
      <path d="M14 5h4.5A1.5 1.5 0 0 1 20 6.5v11a1.5 1.5 0 0 1-1.5 1.5H14M10 8l-4 4 4 4M6 12h9" />
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    profile: (
      <>
        <circle cx="12" cy="8" r="3.2" />
        <path d="M5.5 20c.7-3.1 3.1-4.8 6.5-4.8s5.8 1.7 6.5 4.8" />
      </>
    ),
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="5.5" />
        <path d="m15 15 4 4" />
      </>
    ),
    settings: (
      <>
        <path d="m12 3 1.1 1.9 2.2.5 1.8-1 1.5 1.5-1 1.8.5 2.2L20 11v2l-1.9 1.1-.5 2.2 1 1.8-1.5 1.5-1.8-1-2.2.5L12 21l-1.1-1.9-2.2-.5-1.8 1-1.5-1.5 1-1.8-.5-2.2L4 13v-2l1.9-1.1.5-2.2-1-1.8L6.9 4.4l1.8 1 2.2-.5z" />
        <circle cx="12" cy="12" r="2.7" />
      </>
    ),
    shield: (
      <>
        <path d="M12 3.5 19 6v5.3c0 4.5-2.7 7.6-7 9.2-4.3-1.6-7-4.7-7-9.2V6z" />
        <path d="m9.5 12 1.7 1.5 3.4-3.5" />
      </>
    ),
    star: <path d="m12 3 2.8 5.7 6.3.9-4.5 4.4 1.1 6.2L12 17.3l-5.7 3 1.1-6.2L2.9 9.6l6.3-.9z" />,
    support: (
      <>
        <path d="M4 13v-1a8 8 0 0 1 16 0v1" />
        <path d="M4 13h3v5H5.5A1.5 1.5 0 0 1 4 16.5zM20 13h-3v5h1.5a1.5 1.5 0 0 0 1.5-1.5zM17 18c0 1.1-.9 2-2 2h-2" />
      </>
    ),
    trash: (
      <>
        <path d="M3.5 6h17M9 6V3.5h6V6M6 6l1 14h10l1-14M10 10v6M14 10v6" />
      </>
    ),
  };

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {paths[name]}
    </svg>
  );
}
