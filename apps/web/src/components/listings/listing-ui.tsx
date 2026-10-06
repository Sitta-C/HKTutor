import {
  PaperCard,
  StatusBadge,
  WashiTape,
  notebookButtonClass,
  notebookInputClass,
} from '@/components/ui/notebook';
import { NotebookLoading, NotebookPageError } from '@/components/ui/notebook-loading';

import type { ListingPublicationStatus } from '@/lib/api/types';
import type { ReactNode } from 'react';

export const listingFieldClass = notebookInputClass({
  className:
    'mt-2 focus:border-tutor focus:ring-sticky-blue/70 aria-invalid:border-red-400 aria-invalid:ring-4 aria-invalid:ring-red-100 disabled:cursor-not-allowed disabled:bg-paper-deep disabled:text-notebook-muted',
});

export function listingButtonClass(
  tone: 'primary' | 'secondary' | 'danger' = 'secondary',
  className?: string,
) {
  return notebookButtonClass({ tone, className });
}

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
    <PaperCard className="group relative flex min-h-32 items-start gap-3 overflow-hidden p-4 transition hover:-translate-y-0.5 hover:shadow-paper sm:p-5">
      <WashiTape tone="blue" className="-right-5 -top-1 rotate-12 opacity-70" />
      <span className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sticky-blue text-tutor-deep">
        <ListingIcon name={icon} />
      </span>
      <div className="relative z-10 min-w-0">
        <p className="text-[0.68rem] font-extrabold uppercase tracking-[0.13em] text-notebook-muted">
          {label}
        </p>
        <p className="mt-1 [overflow-wrap:anywhere] text-xl font-black tracking-[-0.03em] text-notebook-ink">
          {value}
        </p>
        <p className="mt-1 text-xs leading-5 text-notebook-muted">{detail}</p>
      </div>
      <span className="absolute -bottom-9 -right-8 h-24 w-24 rounded-full bg-sticky-blue/50 transition group-hover:scale-110" />
    </PaperCard>
  );
}

export function ListingStatusBadge({
  status,
  labels,
  variant = 'default',
}: {
  status: ListingPublicationStatus;
  labels: Record<ListingPublicationStatus, string>;
  variant?: 'default' | 'ledger';
}) {
  const tone = {
    DRAFT: 'neutral',
    PUBLISHED: 'success',
    ARCHIVED: 'danger',
  } as const;
  const ledgerTone = {
    DRAFT: 'warning',
    PUBLISHED: 'tutor',
    ARCHIVED: 'neutral',
  } as const;

  return (
    <StatusBadge
      tone={variant === 'ledger' ? ledgerTone[status] : tone[status]}
      className={
        variant === 'ledger'
          ? `min-h-7 shrink-0 gap-1.5 rounded-md text-[0.6875rem] ${status === 'ARCHIVED' ? 'border-dashed bg-paper-deep' : ''}`
          : 'min-h-7 shrink-0 gap-2 tracking-[0.08em]'
      }
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {labels[status]}
    </StatusBadge>
  );
}

export function ListingPageState({
  children,
  kind = 'listingsSession',
  error = false,
}: {
  children: ReactNode;
  kind?: 'listingsSession' | 'listingCreate' | 'listingEdit';
  error?: boolean;
}) {
  if (error) return <NotebookPageError label={children} />;
  return <NotebookLoading kind={kind} label={children} />;
}
