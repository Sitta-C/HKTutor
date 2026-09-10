import type { ListingPublicationStatus } from '@/lib/api/types';
import type { ReactNode } from 'react';

export const listingFieldClass =
  'mt-2 min-h-12 w-full rounded-md border border-[#d9d2c6] bg-[#fffdf9] px-4 text-[0.95rem] text-[#171714] outline-none transition placeholder:text-[#8a857b] hover:border-[#b9b3a8] focus:border-[#d18b43] focus:ring-4 focus:ring-[#d18b43]/10 disabled:cursor-not-allowed disabled:bg-[#f1eee7]';

export function ListingIcon({ name }: { name: 'add' | 'archive' | 'edit' | 'listing' | 'search' }) {
  const paths: Record<typeof name, ReactNode> = {
    add: <path d="M12 5v14M5 12h14" />,
    archive: (
      <>
        <path d="M4 7.5h16v12H4zM3 4.5h18v3H3z" />
        <path d="M9 11h6" />
      </>
    ),
    edit: (
      <>
        <path d="m14.5 5.5 4 4M5 19l1-4 9.5-9.5a1.4 1.4 0 0 1 2 0l1 1a1.4 1.4 0 0 1 0 2L9 18z" />
        <path d="M13.5 7.5l3 3" />
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
      className={`inline-flex min-h-7 items-center gap-2 rounded-md border px-2.5 py-1 text-[0.7rem] font-extrabold tracking-[0.08em] ${classes}`}
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
