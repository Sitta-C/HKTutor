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
  adjustFilteredTotal,
  applyTutorBookingDecision,
  countInboxPages,
  describeDecisionSuccess,
  resolveTutorBookingDecisionError,
  toTutorBookingsQuery,
} from '@/components/bookings/tutor-booking-inbox-model';
import {
  GraphPaper,
  NotebookHeading,
  PaperCard,
  StickyNote,
  WashiTape,
  notebookButtonClass,
} from '@/components/ui/notebook';
import { useNotebookToast } from '@/components/ui/notebook-toast';
import { confirmTutorBooking, getTutorBookings, rejectTutorBooking } from '@/lib/api/bookings';
import { useLanguage } from '@/lib/i18n';

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
  const [total, setTotal] = useState(0);
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
    if (value === filter) {
      reload();
      return;
    }
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
        setTotal(0);
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
      setTotal((current) => adjustFilteredTotal(current, filter, result.status));
      setCardErrors((current) => clearCardError(current, booking.id));
      setTarget(null);
      toast.success(describeDecisionSuccess(result, copy));
    } catch (caught: unknown) {
      const failure = resolveTutorBookingDecisionError(caught, copy);
      if (failure.requiresRefresh) {
        // The row stays until the server is asked again, so the message and its Refresh button
        // stay on the card the tutor acted on and the counts keep matching the visible list.
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

  const totalPages = countInboxPages(total);
  const summary =
    filter === 'PENDING' ? `${total} ${copy.requestCount}` : `${total} ${copy.bookingCount}`;

  return (
    <div className="mx-auto w-full max-w-[1120px] py-8 pb-12">
      <NotebookHeading
        eyebrow={copy.eyebrow}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span>{copy.title}</span>
            <span className="inline-flex items-center rounded-full border border-blue-200 bg-sticky-blue px-2.5 py-1 text-xs font-bold tracking-wide text-tutor-deep">
              {copy.tutorRole}
            </span>
          </span>
        }
        description={copy.subtitle}
        className="mb-8"
      />

      <PaperCard className="relative overflow-hidden p-5 shadow-[0_18px_40px_-12px_rgba(46,39,25,0.14)] sm:p-7">
        <WashiTape tone="blue" className="-right-5 top-3 rotate-12" />

        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-semibold text-notebook-muted">{summary}</p>
          <button
            type="button"
            onClick={reload}
            disabled={isLoading}
            className={notebookButtonClass({
              tone: 'secondary',
              className: 'min-h-10 px-3 py-2 text-xs',
            })}
          >
            {copy.refresh}
          </button>
        </div>

        <div className="mb-6 flex flex-wrap gap-2" role="group" aria-label={copy.filterLabel}>
          {TUTOR_INBOX_FILTERS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => changeFilter(value)}
              className={`min-h-11 rounded-full border px-4 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tutor/30 focus-visible:ring-offset-2 ${
                filter === value
                  ? 'border-tutor-deep bg-tutor-deep text-white shadow-sm'
                  : 'border-paper-edge bg-paper text-notebook-muted hover:border-tutor hover:bg-sticky-blue/45 hover:text-notebook-ink'
              }`}
            >
              {value === 'ALL' ? copy.all : getBookingStatusLabel(value, statusText)}
            </button>
          ))}
        </div>

        {isLoading && (
          <StickyNote tone="blue" className="p-5 text-sm font-semibold" role="status">
            <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-tutor-deep" />
            {copy.loading}
          </StickyNote>
        )}

        {!isLoading && loadFailed && (
          <div
            className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800"
            role="alert"
          >
            <p>{copy.loadError}</p>
            <button type="button" className="mt-3 font-bold underline" onClick={reload}>
              {copy.tryAgain}
            </button>
          </div>
        )}

        {!isLoading && !loadFailed && items.length === 0 && (
          <GraphPaper className="border-dashed p-10 text-center">
            <h2 className="font-note text-2xl font-bold text-notebook-ink">
              {filter === 'ALL' ? copy.emptyTitle : copy.emptyFilterTitle}
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-notebook-muted">
              {filter === 'ALL' ? copy.emptyBody : copy.emptyFilterBody}
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-3">
              <Link href="/dashboard/availability" className={notebookButtonClass()}>
                {copy.manageAvailability}
              </Link>
              <Link
                href="/dashboard/listings"
                className={notebookButtonClass({ tone: 'secondary' })}
              >
                {copy.myListings}
              </Link>
            </div>
          </GraphPaper>
        )}

        {!isLoading && !loadFailed && items.length > 0 && (
          <div>
            <ul className="space-y-3" aria-label={copy.listLabel}>
              {items.map((booking) => (
                <li key={booking.id}>
                  <TutorBookingCard
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
                </li>
              ))}
            </ul>

            {totalPages > 1 && (
              <nav
                className="mt-6 flex items-center justify-between gap-4 border-t border-dashed border-paper-edge pt-5"
                aria-label={copy.pagination}
              >
                <button
                  type="button"
                  disabled={page === 1}
                  onClick={() => changePage(Math.max(1, page - 1))}
                  className={notebookButtonClass({
                    tone: 'secondary',
                    className: 'min-h-10 px-4 py-2',
                  })}
                >
                  {copy.previousPage}
                </button>
                <span className="text-sm font-semibold text-notebook-muted">
                  {copy.pageOf
                    .replace('{page}', String(page))
                    .replace('{totalPages}', String(totalPages))}
                </span>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => changePage(Math.min(totalPages, page + 1))}
                  className={notebookButtonClass({
                    tone: 'secondary',
                    className: 'min-h-10 px-4 py-2',
                  })}
                >
                  {copy.nextPage}
                </button>
              </nav>
            )}
          </div>
        )}
      </PaperCard>

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
