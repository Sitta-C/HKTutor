'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import {
  BookingDocketStatus,
  BookingDocketSummary,
  BookingDocketTotal,
} from '@/components/bookings/booking-docket';
import { bookingRequestCopy } from '@/components/bookings/booking-request-copy';
import { formatBangkokDateTime, getBookingErrorMessage } from '@/components/bookings/booking-ui';
import { DashboardIcon } from '@/components/dashboard/dashboard-icon';
import { NotebookHeading, PaperCard } from '@/components/ui/notebook';
import { NotebookLoadingRegion } from '@/components/ui/notebook-loading';
import { useNotebookToast } from '@/components/ui/notebook-toast';
import { createBookingOnce, getBookingQuote } from '@/lib/api/bookings';
import { ApiError } from '@/lib/api/error';
import { useLanguage } from '@/lib/i18n';
import { refreshStudentBookingCountAfterCreate } from '@/lib/student-booking-count';

import styles from './booking-docket.module.css';

import type { BookingText } from '@/components/bookings/booking-ui';
import type { BookingQuote, BookingResponse } from '@/lib/api/types';

export default function BookingConfirmationPage() {
  const { copy, language } = useLanguage();
  const toast = useNotebookToast();
  const text = copy.dashboard.booking;
  const requestText = bookingRequestCopy[language];
  const router = useRouter();
  const searchParams = useSearchParams();
  const listingId = searchParams.get('listingId');
  const slotId = searchParams.get('slotId');
  const [quote, setQuote] = useState<BookingQuote | null>(null);
  const [created, setCreated] = useState<BookingResponse | null>(null);
  const [quoteError, setQuoteError] = useState<unknown | null>(null);
  const [submitError, setSubmitError] = useState<unknown | null>(null);
  const [isQuoteLoading, setIsQuoteLoading] = useState(true);
  const [loadedSelection, setLoadedSelection] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitInFlight = useRef(false);
  const selectionKey = `${listingId ?? ''}:${slotId ?? ''}`;
  const selectionLoaded = loadedSelection === selectionKey;
  const activeQuote = selectionLoaded ? quote : null;
  const activeQuoteError = selectionLoaded ? quoteError : null;
  const activeCreated = selectionLoaded ? created : null;
  const activeSubmitError = selectionLoaded ? submitError : null;
  const missingSelection = !listingId || !slotId;

  useEffect(() => {
    let active = true;

    if (!listingId || !slotId) {
      return () => {
        active = false;
      };
    }

    void getBookingQuote(listingId, slotId)
      .then((result) => {
        if (!active) return;
        setQuote(result);
        setQuoteError(null);
        setLoadedSelection(selectionKey);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setQuote(null);
        setQuoteError(caught);
        setLoadedSelection(selectionKey);
      })
      .finally(() => {
        if (active) setIsQuoteLoading(false);
      });

    return () => {
      active = false;
    };
  }, [listingId, selectionKey, slotId]);

  const submit = async () => {
    if (!activeQuote || !listingId || !slotId || submitInFlight.current || activeCreated) return;

    setIsSubmitting(true);
    setSubmitError(null);
    setCreated(null);

    try {
      const response = await createBookingOnce({ listingId, slotId }, submitInFlight);
      if (response) {
        setCreated(response);
        refreshStudentBookingCountAfterCreate();
        toast.success(requestText.sent);
      } else {
        setSubmitError(new Error(text.submissionInProgress));
        toast.error(text.submissionInProgress);
      }
    } catch (caught: unknown) {
      setCreated(null);
      setSubmitError(caught);
      toast.error(getBookingErrorMessage(caught, text));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={styles.page}>
      <NotebookHeading
        eyebrow={text.pageEyebrow}
        title={activeCreated ? requestText.sent : text.reviewTitle}
        description={activeCreated ? undefined : requestText.reviewDescription}
        className={styles.heading ?? ''}
      />

      {!missingSelection && (!selectionLoaded || isQuoteLoading) && (
        <PaperCard className={styles.paper}>
          <div className={styles.loading}>
            <NotebookLoadingRegion label={requestText.loading} />
          </div>
        </PaperCard>
      )}

      {missingSelection && (
        <BookingError error={new ApiError('Missing booking selection', 400)} text={text} />
      )}

      {!isQuoteLoading && activeQuoteError !== null && (
        <BookingError error={activeQuoteError} text={text} />
      )}

      {!isQuoteLoading && activeQuote && !activeCreated && (
        <PaperCard className={styles.paper} aria-label={text.bookingSummary}>
          <BookingDocketSummary
            summary={activeQuote}
            amounts={activeQuote}
            language={language}
            text={text}
            requestText={requestText}
          />
          <div className={styles.footer}>
            <p className={styles.notice}>{requestText.notice}</p>
            <div className={styles.stub}>
              <BookingDocketTotal
                label={requestText.total}
                amount={activeQuote.netAmount}
                currency={activeQuote.currency}
              />
              <div className={styles.actionRegion}>
                {activeSubmitError !== null && (
                  <SubmitError
                    error={activeSubmitError}
                    text={text}
                    tutorId={activeQuote.tutor.tutorId}
                    listingId={activeQuote.listing.id}
                  />
                )}
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.ticket}
                    disabled={isSubmitting}
                    aria-busy={isSubmitting}
                    onClick={() => void submit()}
                  >
                    <span className={styles.ticketLabel}>
                      {isSubmitting ? text.sendingRequest : requestText.send}
                    </span>
                    <span className={styles.ticketStub} aria-hidden="true">
                      <DashboardIcon name="arrow-right" className="h-4 w-4" />
                    </span>
                  </button>
                  <Link
                    href={`/tutors/${encodeURIComponent(activeQuote.tutor.tutorId)}?listingId=${encodeURIComponent(activeQuote.listing.id)}`}
                    className={styles.link}
                  >
                    {text.changeTime}
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </PaperCard>
      )}

      {activeCreated && activeQuote && (
        <PaperCard className={styles.paper} aria-label={text.bookingSummary}>
          <div className={styles.success} role="status">
            <div className={styles.successBadge}>
              <DashboardIcon
                name={activeCreated.status === 'PENDING' ? 'clock' : 'info'}
                className="h-5 w-5"
              />
              <BookingDocketStatus status={activeCreated.status} text={requestText} />
            </div>
            <p>
              {activeCreated.status === 'PENDING'
                ? requestText.pendingNotice
                : requestText.submittedNotice}
            </p>
          </div>
          <BookingDocketSummary
            summary={activeQuote}
            amounts={activeCreated}
            language={language}
            text={text}
            requestText={requestText}
          />
          <div className={styles.footer}>
            <div className={styles.stub}>
              <BookingDocketTotal
                label={requestText.total}
                amount={activeCreated.netAmount}
                currency={activeCreated.currency}
              />
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.ticket}
                  onClick={() =>
                    router.push(`/dashboard/bookings/${encodeURIComponent(activeCreated.id)}`)
                  }
                >
                  <span className={styles.ticketLabel}>{requestText.details}</span>
                  <span className={styles.ticketStub} aria-hidden="true">
                    <DashboardIcon name="bookings" className="h-4 w-4" />
                  </span>
                </button>
                <Link href="/dashboard/bookings" className={styles.link}>
                  {text.backToBookings}
                </Link>
                <Link href="/tutors" className={styles.link}>
                  {text.findTutor}
                </Link>
              </div>
            </div>
            <p className={styles.created}>
              {text.created}:{' '}
              <time dateTime={activeCreated.createdAt}>
                {formatBangkokDateTime(activeCreated.createdAt, language)}
              </time>
            </p>
          </div>
        </PaperCard>
      )}
    </div>
  );
}

function BookingError({ error, text }: { error: unknown; text: BookingText }) {
  return (
    <div className={styles.error} role="alert">
      <p>{getBookingErrorMessage(error, text)}</p>
      <div className={styles.errorActions}>
        {error instanceof ApiError && error.status === 401 && (
          <Link href="/" className={styles.link}>
            {text.signIn}
          </Link>
        )}
        <Link href="/tutors" className={styles.link}>
          {text.findTutor}
        </Link>
      </div>
    </div>
  );
}

function SubmitError({
  error,
  text,
  tutorId,
  listingId,
}: {
  error: unknown;
  text: BookingText;
  tutorId: string;
  listingId: string;
}) {
  const conflict = error instanceof ApiError && error.status === 409;
  return (
    <div className={styles.error} role="alert">
      <p>{getBookingErrorMessage(error, text)}</p>
      {conflict && (
        <Link
          href={`/tutors/${encodeURIComponent(tutorId)}?listingId=${encodeURIComponent(listingId)}&conflict=1`}
          className={styles.link}
        >
          {text.chooseAnotherTime}
        </Link>
      )}
      {error instanceof ApiError && error.status === 401 && (
        <Link href="/" className={styles.link}>
          {text.signIn}
        </Link>
      )}
    </div>
  );
}
