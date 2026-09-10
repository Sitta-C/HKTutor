import type { ListingPublicationStatus } from '@/lib/api/types';
import type { ReactNode } from 'react';

export const listingFieldClass =
  'listing-field-control mt-2 min-h-[2.9rem] w-full rounded-[0.9rem] border-[1.5px] border-[#d9d2c6] bg-white px-4 py-3 text-[0.9rem] text-[#1a1916] outline-none transition placeholder:text-[#8a857b] hover:border-[#b9b3a8] focus:border-[#d18b43] focus:ring-4 focus:ring-[#d18b43]/10 disabled:cursor-not-allowed disabled:bg-[#f1eee7]';

export function ListingIcon({
  name,
}: {
  name: 'add' | 'archive' | 'check' | 'edit' | 'info' | 'listing' | 'search' | 'star';
}) {
  const paths: Record<typeof name, ReactNode> = {
    add: <path d="M12 5v14M5 12h14" />,
    archive: (
      <>
        <path d="M4 7.5h16v12H4zM3 4.5h18v3H3z" />
        <path d="M9 11h6" />
      </>
    ),
    check: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="m8.5 12 2.3 2.3 4.7-4.7" />
      </>
    ),
    edit: (
      <>
        <path d="m14.5 5.5 4 4M5 19l1-4 9.5-9.5a1.4 1.4 0 0 1 2 0l1 1a1.4 1.4 0 0 1 0 2L9 18z" />
        <path d="M13.5 7.5l3 3" />
      </>
    ),
    info: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 10.5v5M12 7.7h.01" />
      </>
    ),
    listing: (
      <>
        <path d="M6 4.5h12v15H6z" />
        <path d="M9 8h6M9 11.5h6M9 15h4" />
      </>
    ),
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="5.5" />
        <path d="m15 15 4 4" />
      </>
    ),
    star: <path d="m12 4 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4-3.9-3.8 5.4-.8z" />,
  };

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-5 w-5"
    >
      {paths[name]}
    </svg>
  );
}

export function ListingMetric({
  detail,
  icon,
  label,
  value,
}: {
  detail: string;
  icon: 'check' | 'info' | 'listing' | 'search';
  label: string;
  value: string;
}) {
  return (
    <div className="listing-metric dash-card flex min-h-[7rem] items-start gap-3 rounded-[1.15rem] border-0 bg-white p-4 sm:p-5">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[0.55rem] bg-[var(--tutor-softer)] text-[var(--tutor-deep)]">
        <ListingIcon name={icon} />
      </span>
      <div className="min-w-0">
        <p className="text-[0.68rem] font-extrabold uppercase tracking-[0.13em] text-[var(--ink-3)]">
          {label}
        </p>
        <p className="mt-1 truncate text-xl font-black tracking-[-0.03em] text-[var(--ink)]">
          {value}
        </p>
        <p className="mt-1 text-xs leading-5 text-[var(--ink-2)]">{detail}</p>
      </div>
    </div>
  );
}

export function ListingStatusBadge({
  status,
  labels,
}: {
  status: ListingPublicationStatus;
  labels: Record<ListingPublicationStatus, string>;
}) {
  const classes = {
    DRAFT: 'border-[#d9d2c6] bg-[#f4f1eb] text-[#5e5a52]',
    PUBLISHED: 'border-[#b8decf] bg-[#edf8f3] text-[#246b51]',
    ARCHIVED: 'border-[#e7c9bf] bg-[#fbf0ec] text-[#9c5142]',
  }[status];

  return (
    <span
      className={`listing-status-badge inline-flex min-h-7 items-center gap-2 rounded-full border px-2.5 py-1 text-[0.7rem] font-extrabold tracking-[0.08em] ${classes}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {labels[status]}
    </span>
  );
}

export function ListingPageState({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#f7f4ec] p-6 text-center text-sm font-semibold text-[#5e5a52]">
      {children}
    </div>
  );
}
