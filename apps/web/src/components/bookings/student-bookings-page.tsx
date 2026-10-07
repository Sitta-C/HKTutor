'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { bookingRequestCopy } from '@/components/bookings/booking-request-copy';
import { getBookingErrorMessage } from '@/components/bookings/booking-ui';
import { StudentBookingLedgerRow } from '@/components/bookings/student-booking-ledger-row';
import { studentBookingsCopy } from '@/components/bookings/student-bookings-copy';
import { DashboardIcon } from '@/components/dashboard/dashboard-icon';
import { NotebookHeading, PaperCard } from '@/components/ui/notebook';
import { NotebookLoadingRegion } from '@/components/ui/notebook-loading';
import { NotebookPagination } from '@/components/ui/notebook-pagination';
import { getMyBookings } from '@/lib/api/bookings';
import { ApiError } from '@/lib/api/error';
import { useLanguage } from '@/lib/i18n';

import styles from './student-bookings.module.css';

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
  const pageText = studentBookingsCopy[language];
  const requestText = bookingRequestCopy[language];
  const [filter, setFilter] = useState<BookingFilter>('ALL');
  const [items, setItems] = useState<BookingView[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<unknown | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [loadedSelection, setLoadedSelection] = useState<string | null>(null);
  const selectionKey = `${filter}:${page}:${reloadKey}`;
  const selectionLoaded = loadedSelection === selectionKey;
  const loading = isLoading || !selectionLoaded;
  const countsAvailable = !loading && error === null && total !== null;
  const statusLabels: Record<BookingStatus, string> = {
    PENDING: requestText.pending,
    CONFIRMED: requestText.confirmed,
    COMPLETED: requestText.completed,
    CANCELED: requestText.canceled,
    EXPIRED: requestText.expired,
  };
  const filterLabel = (value: BookingFilter) => (value === 'ALL' ? text.all : statusLabels[value]);

  useEffect(() => {
    let active = true;
    getMyBookings({
      ...(filter === 'ALL' ? {} : { status: filter }),
      page,
      pageSize: BOOKINGS_PAGE_SIZE,
    })
      .then((response) => {
        if (!active) return;
        setItems(response.items);
        setTotal(response.total);
        setError(null);
        setLoadedSelection(selectionKey);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setItems([]);
        setTotal(null);
        setError(caught);
        setLoadedSelection(selectionKey);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [filter, page, reloadKey, selectionKey]);

  return (
    <div className={styles.page}>
      <div className={styles.heading}>
        <NotebookHeading eyebrow={text.bookingsEyebrow} title={pageText.title} />
        <p className={styles.count} aria-live="polite" data-booking-count>
          {countsAvailable
            ? pageText.count
                .replace('{count}', String(total))
                .replace('{status}', filterLabel(filter))
            : pageText.countUnavailable}
        </p>
      </div>
      <div className={styles.index}>
        <div className={styles.filters} role="group" aria-label={text.status}>
          {filters.map((value) => (
            <button
              key={value}
              type="button"
              className={styles.filter}
              aria-pressed={filter === value}
              onClick={() => {
                if (filter === value && page === 1) return;
                setIsLoading(true);
                setFilter(value);
                setPage(1);
              }}
            >
              {filterLabel(value)}
            </button>
          ))}
        </div>
        <PaperCard className={styles.paper} aria-busy={loading}>
          {loading && (
            <div className={styles.state}>
              <NotebookLoadingRegion label={text.loading} />
            </div>
          )}
          {!loading && error !== null && (
            <div className={`${styles.state} ${styles.error}`} role="alert">
              <p>{getBookingErrorMessage(error, text)}</p>
              {error instanceof ApiError && error.status === 401 ? (
                <Link href="/" className={styles.link}>
                  {text.signIn}
                </Link>
              ) : (
                <button
                  type="button"
                  className={styles.link}
                  onClick={() => {
                    setIsLoading(true);
                    setReloadKey((value) => value + 1);
                  }}
                >
                  {text.tryAgain}
                </button>
              )}
            </div>
          )}
          {!loading && error === null && items.length === 0 && (
            <div className={styles.state}>
              <h2 className="font-note">
                {filter === 'ALL' ? text.emptyTitle : pageText.emptyFilteredTitle}
              </h2>
              <p>{filter === 'ALL' ? text.emptyBody : pageText.emptyFilteredBody}</p>
              <Link href="/tutors" className={styles.ticket}>
                <span className={styles.ticketLabel}>{text.browseTutors}</span>
                <span className={styles.ticketStub} aria-hidden="true">
                  <DashboardIcon name="arrow-right" className="h-4 w-4" />
                </span>
              </Link>
            </div>
          )}
          {!loading && error === null && items.length > 0 && (
            <>
              <div>
                {items.map((booking) => (
                  <StudentBookingLedgerRow
                    key={booking.id}
                    booking={booking}
                    text={text}
                    language={language}
                  />
                ))}
              </div>
              {total !== null && total > BOOKINGS_PAGE_SIZE && (
                <div className={styles.pagination}>
                  <NotebookPagination
                    page={page}
                    total={total}
                    pageSize={BOOKINGS_PAGE_SIZE}
                    label={text.pagination}
                    onPageChange={(nextPage) => {
                      setIsLoading(true);
                      setPage(nextPage);
                    }}
                  />
                </div>
              )}
            </>
          )}
        </PaperCard>
      </div>
    </div>
  );
}
