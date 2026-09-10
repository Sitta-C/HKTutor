import type { ReactNode } from 'react';

export type DashboardIconName =
  'calendar' | 'check' | 'eye' | 'info' | 'plus' | 'profile' | 'search' | 'settings' | 'shield';

export function DashboardIcon({
  name,
  className = 'h-5 w-5',
}: {
  name: DashboardIconName;
  className?: string;
}) {
  const paths: Record<DashboardIconName, ReactNode> = {
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
    eye: (
      <>
        <path d="M3.5 12s3.1-5 8.5-5 8.5 5 8.5 5-3.1 5-8.5 5-8.5-5-8.5-5Z" />
        <circle cx="12" cy="12" r="2.2" />
      </>
    ),
    info: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 10.5v5M12 7.7h.01" />
      </>
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
