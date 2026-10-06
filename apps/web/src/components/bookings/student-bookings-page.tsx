'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { BookingSummaryRow, getBookingErrorMessage } from '@/components/bookings/booking-ui';
import {
  GraphPaper,
  NotebookHeading,
  PaperCard,
  WashiTape,
  notebookButtonClass,
} from '@/components/ui/notebook';
import { NotebookLoadingRegion } from '@/components/ui/notebook-loading';
import { getMyBookings } from '@/lib/api/bookings';
import { ApiError } from '@/lib/api/error';
import { useLanguage } from '@/lib/i18n';

import type { BookingText } from '@/components/bookings/booking-ui';
import type { BookingStatus, BookingView } from '@/lib/api/types';

type BookingFilter = 'ALL' | BookingStatus;
const BOOKINGS_PAGE_SIZE = 10;

const filters: BookingFilter[] = [
  'ALL',
  'PENDING',
  'CONFIRMED',
  'COMPLETED',
  'CANCELED',
  'EXPIRED',
];

export default function StudentBookingsPage() {
  const { copy, language } = useLanguage();
  const text = copy.dashboard.booking;
  const [filter, setFilter] = useState<BookingFilter>('ALL');
  const [items, setItems] = useState<BookingView[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<unknown | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = () => {
    setReloadKey((value) => value + 1);
  };

  useEffect(() => {
    let active = true;

    const fetchBookings = () => {
      setIsLoading(true);
      setError(null);
      return getMyBookings({
        ...(filter === 'ALL' ? {} : { status: filter }),
        page,
        pageSize: BOOKINGS_PAGE_SIZE,
      });
    };

    fetchBookings()
      .then((response) => {
        if (!active) return;
        setItems(response.items);
        setTotal(response.total);
      })
      .catch((caught: unknown) => {
        if (active) {
          setItems([]);
          setTotal(0);
          setError(caught);
        }
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [filter, page, reloadKey]);

  const totalPages = Math.max(1, Math.ceil(total / BOOKINGS_PAGE_SIZE));

  return (
    <div className="mx-auto w-full max-w-[1120px] py-8 pb-12">
      <NotebookHeading
        eyebrow={text.bookingsEyebrow}
        title={text.myBookings}
        description={`${total} ${text.bookingCount}`}
        className="mb-8"
      />

      <PaperCard className="relative overflow-hidden p-5 shadow-[0_18px_40px_-12px_rgba(46,39,25,0.14)] sm:p-7">
        <WashiTape tone="pink" className="-right-5 top-3 rotate-12" />
        <div className="mb-6 flex flex-wrap gap-2" role="group" aria-label={text.status}>
          {filters.map((item) => (
            <button
              key={item}
              type="button"
              className={`rounded-full border px-4 py-2 text-sm font-bold transition ${
                filter === item
                  ? 'border-student-deep bg-sticky-green text-student-deep shadow-sm'
                  : 'border-paper-edge bg-paper text-notebook-muted hover:bg-sticky-yellow/40'
              }`}
              aria-pressed={filter === item}
              onClick={() => {
                setFilter(item);
                setPage(1);
              }}
            >
              {getFilterLabel(item, text)}
            </button>
          ))}
        </div>

        {isLoading && <NotebookLoadingRegion label={text.loading} />}

        {!isLoading && error !== null && (
          <div
            className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800"
            role="alert"
          >
            <p>{getBookingErrorMessage(error, text)}</p>
            {isUnauthorized(error) && (
              <Link href="/" className="mt-3 inline-flex font-bold underline">
                {text.signIn}
              </Link>
            )}
            {!isUnauthorized(error) && (
              <button type="button" className="mt-3 font-bold underline" onClick={reload}>
                {text.tryAgain}
              </button>
            )}
          </div>
        )}

        {!isLoading && !error && items.length === 0 && (
          <GraphPaper className="border-dashed p-10 text-center">
            <h2 className="font-note text-2xl font-bold text-notebook-ink">{text.emptyTitle}</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-notebook-muted">
              {text.emptyBody}
            </p>
            <Link href="/tutors" className={notebookButtonClass({ className: 'mt-5' })}>
              {text.browseTutors}
            </Link>
          </GraphPaper>
        )}

        {!isLoading && !error && items.length > 0 && (
          <div>
            <div className="space-y-3">
              {items.map((booking) => (
                <BookingSummaryRow
                  key={booking.id}
                  booking={booking}
                  text={text}
                  language={language}
                />
              ))}
            </div>
            {totalPages > 1 && (
              <nav
                className="mt-6 flex items-center justify-between gap-4 border-t border-dashed border-paper-edge pt-5"
                aria-label={text.pagination}
              >
                <button
                  type="button"
                  disabled={page === 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  className={notebookButtonClass({
                    tone: 'secondary',
                    className: 'min-h-10 px-4 py-2',
                  })}
                >
                  {text.previousPage}
                </button>
                <span className="text-sm font-semibold text-notebook-muted">
                  {text.pageOf
                    .replace('{page}', String(page))
                    .replace('{totalPages}', String(totalPages))}
                </span>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                  className={notebookButtonClass({
                    tone: 'secondary',
                    className: 'min-h-10 px-4 py-2',
                  })}
                >
                  {text.nextPage}
                </button>
              </nav>
            )}
          </div>
        )}
      </PaperCard>
    </div>
  );
}

function getFilterLabel(filter: BookingFilter, text: BookingText): string {
  if (filter === 'ALL') return text.all;
  const labels: Record<BookingStatus, string> = {
    CANCELED: text.canceled,
    COMPLETED: text.completed,
    CONFIRMED: text.confirmed,
    EXPIRED: text.expired,
    PENDING: text.pending,
  };
  return labels[filter];
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}
