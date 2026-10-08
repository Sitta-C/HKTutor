'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { BookingDecisionDialog } from '@/components/bookings/booking-decision-dialog';
import { getBookingStatusLabel } from '@/components/bookings/booking-ui';
import { TutorBookingCard } from '@/components/bookings/tutor-booking-card';
import { tutorBookingInboxCopy } from '@/components/bookings/tutor-booking-inbox-copy';
import {
  DEFAULT_TUTOR_INBOX_FILTER,
  TUTOR_INBOX_FILTERS,
  TUTOR_INBOX_PAGE_SIZE,
  adjustFilteredTotal,
  applyTutorBookingDecision,
  describeDecisionSuccess,
  resolveTutorBookingDecisionError,
  toTutorBookingsQuery,
} from '@/components/bookings/tutor-booking-inbox-model';
import { DashboardIcon } from '@/components/dashboard/dashboard-icon';
import { NotebookHeading, PaperCard } from '@/components/ui/notebook';
import { NotebookLoadingRegion } from '@/components/ui/notebook-loading';
import { NotebookPagination } from '@/components/ui/notebook-pagination';
import { useNotebookToast } from '@/components/ui/notebook-toast';
import { confirmTutorBooking, getTutorBookings, rejectTutorBooking } from '@/lib/api/bookings';
import { useLanguage } from '@/lib/i18n';

import styles from './tutor-booking-inbox.module.css';

import type {
  TutorBookingDecision,
  TutorBookingDecisionError,
  TutorInboxFilter,
} from '@/components/bookings/tutor-booking-inbox-model';
import type { TutorBookingView } from '@/lib/api/types';

interface DecisionTarget {
  booking: TutorBookingView;
  decision: TutorBookingDecision;
}

interface SubmittingDecision {
  bookingId: string;
  decision: TutorBookingDecision;
}

function clearCardError(
  current: Record<string, TutorBookingDecisionError>,
  bookingId: string,
): Record<string, TutorBookingDecisionError> {
  if (!(bookingId in current)) return current;
  const next = { ...current };
  delete next[bookingId];
  return next;
}

export default function TutorBookingInbox() {
  const { copy: sharedCopy, language } = useLanguage();
  const copy = tutorBookingInboxCopy[language];
  const statusText = sharedCopy.dashboard.booking;
  const toast = useNotebookToast();
  const [filter, setFilter] = useState<TutorInboxFilter>(DEFAULT_TUTOR_INBOX_FILTER);
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [items, setItems] = useState<TutorBookingView[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [target, setTarget] = useState<DecisionTarget | null>(null);
  const [submitting, setSubmitting] = useState<SubmittingDecision | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [cardErrors, setCardErrors] = useState<Record<string, TutorBookingDecisionError>>({});
  // Guards a double click inside one render tick, which React state alone cannot stop.
  const inFlight = useRef(new Set<string>());

  // Loading state is prepared by the handler that triggers a reload, so the effect only fetches.
  const prepareLoad = () => {
    setIsLoading(true);
    setLoadFailed(false);
    setCardErrors({});
  };

  const reload = () => {
    prepareLoad();
    setReloadKey((value) => value + 1);
  };

  const changeFilter = (value: TutorInboxFilter) => {
    if (value === filter && page === 1) return;
    prepareLoad();
    setFilter(value);
    setPage(1);
  };

  const changePage = (nextPage: number) => {
    if (nextPage === page) return;
    prepareLoad();
    setPage(nextPage);
  };

  useEffect(() => {
    let active = true;

    getTutorBookings(toTutorBookingsQuery(filter, page))
      .then((response) => {
        if (!active) return;
        setItems(response.items);
        setTotal(response.total);
      })
      .catch(() => {
        if (!active) return;
        setItems([]);
        // The count stays unavailable rather than claiming zero after a failed load.
        setTotal(null);
        setLoadFailed(true);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [filter, page, reloadKey]);

  const submitDecision = async (text: string) => {
    if (!target) return;
    const { booking, decision } = target;
    if (inFlight.current.has(booking.id)) return;

    inFlight.current.add(booking.id);
    setSubmitting({ bookingId: booking.id, decision });
    setDialogError(null);

    try {
      const result =
        decision === 'CONFIRM'
          ? await confirmTutorBooking(booking.id, { note: text })
          : await rejectTutorBooking(booking.id, { reason: text });

      // Only the server-reported status is rendered, so a failed call never leaves a stale row.
      setItems((current) => applyTutorBookingDecision(current, result));
      setTotal((current) =>
        current === null ? current : adjustFilteredTotal(current, filter, result.status),
      );
      setCardErrors((current) => clearCardError(current, booking.id));
      setTarget(null);
      toast.success(describeDecisionSuccess(result, copy));
    } catch (caught: unknown) {
      const failure = resolveTutorBookingDecisionError(caught, copy);
      if (failure.requiresRefresh) {
        // The row stays until the server is asked again, so the message and its Refresh button
        // stay on the row the tutor acted on and the counts keep matching the visible ledger.
        setCardErrors((current) => ({ ...current, [booking.id]: failure }));
        setTarget(null);
      } else {
        setDialogError(failure.message);
      }
    } finally {
      inFlight.current.delete(booking.id);
      setSubmitting(null);
    }
  };

  const filterLabel = (value: TutorInboxFilter) =>
    value === 'ALL' ? copy.all : getBookingStatusLabel(value, statusText);
  const countsAvailable = !isLoading && !loadFailed && total !== null;

  return (
    <div className={styles.page}>
      <div className={styles.heading}>
        <NotebookHeading eyebrow={copy.eyebrow} title={copy.title} description={copy.subtitle} />
        <p className={styles.count} aria-live="polite">
          {countsAvailable
            ? copy.count.replace('{count}', String(total)).replace('{status}', filterLabel(filter))
            : copy.countUnavailable}
        </p>
      </div>

      <div className={styles.index}>
        <div className={styles.filters} role="group" aria-label={copy.filterLabel}>
          {TUTOR_INBOX_FILTERS.map((value) => (
            <button
              key={value}
              type="button"
              className={styles.filter}
              aria-pressed={filter === value}
              onClick={() => changeFilter(value)}
            >
              {filterLabel(value)}
            </button>
          ))}
        </div>

        <PaperCard className={styles.paper} aria-busy={isLoading}>
          {isLoading && (
            <div className={styles.state}>
              <NotebookLoadingRegion label={copy.loading} />
            </div>
          )}

          {!isLoading && loadFailed && (
            <div className={`${styles.state} ${styles.error}`} role="alert">
              <p>{copy.loadError}</p>
              <button type="button" className={styles.link} onClick={reload}>
                {copy.tryAgain}
              </button>
            </div>
          )}

          {!isLoading && !loadFailed && items.length === 0 && (
            <div className={styles.state}>
              <h2 className="font-note">
                {filter === 'ALL' ? copy.emptyTitle : copy.emptyFilterTitle}
              </h2>
              <p>{filter === 'ALL' ? copy.emptyBody : copy.emptyFilterBody}</p>
              <div className={styles.stateLinks}>
                <Link href="/dashboard/availability" className={styles.ticket}>
                  <span className={styles.ticketLabel}>{copy.manageAvailability}</span>
                  <span className={styles.ticketStub} aria-hidden="true">
                    <DashboardIcon name="arrow-right" className="h-4 w-4" />
                  </span>
                </Link>
                <Link href="/dashboard/listings" className={styles.ticket}>
                  <span className={styles.ticketLabel}>{copy.myListings}</span>
                  <span className={styles.ticketStub} aria-hidden="true">
                    <DashboardIcon name="arrow-right" className="h-4 w-4" />
                  </span>
                </Link>
              </div>
            </div>
          )}

          {!isLoading && !loadFailed && items.length > 0 && (
            <>
              <div>
                {items.map((booking) => (
                  <TutorBookingCard
                    key={booking.id}
                    booking={booking}
                    copy={copy}
                    statusText={statusText}
                    decisionError={cardErrors[booking.id] ?? null}
                    submittingDecision={
                      submitting?.bookingId === booking.id ? submitting.decision : null
                    }
                    language={language}
                    onDecide={(decision) => {
                      setDialogError(null);
                      setTarget({ booking, decision });
                    }}
                    onRefresh={reload}
                  />
                ))}
              </div>
              {total !== null && total > TUTOR_INBOX_PAGE_SIZE && (
                <div className={styles.pagination}>
                  <NotebookPagination
                    page={page}
                    total={total}
                    pageSize={TUTOR_INBOX_PAGE_SIZE}
                    label={copy.pagination}
                    variant="ticket"
                    onPageChange={changePage}
                  />
                </div>
              )}
            </>
          )}
        </PaperCard>
      </div>

      {target && (
        <BookingDecisionDialog
          key={`${target.decision}:${target.booking.id}`}
          booking={target.booking}
          copy={copy}
          decision={target.decision}
          errorMessage={dialogError}
          isSubmitting={submitting?.bookingId === target.booking.id}
          language={language}
          onCancel={() => {
            if (submitting?.bookingId === target.booking.id) return;
            setTarget(null);
            setDialogError(null);
          }}
          onSubmit={(text) => void submitDecision(text)}
        />
      )}
    </div>
  );
}
