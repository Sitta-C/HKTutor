'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { BookingCancellation } from '@/components/bookings/booking-cancellation';
import {
  BookingDocketAmounts,
  BookingDocketStatus,
  BookingDocketSummary,
  BookingDocketTotal,
} from '@/components/bookings/booking-docket';
import { bookingRequestCopy } from '@/components/bookings/booking-request-copy';
import { getBookingErrorMessage } from '@/components/bookings/booking-ui';
import { ClassDetailsPanel } from '@/components/bookings/class-details-panel';
import { PromptPayPaymentPanel } from '@/components/bookings/promptpay-payment-panel';
import { RescheduleRequestPanel } from '@/components/bookings/reschedule-request-panel';
import { studentBookingsCopy } from '@/components/bookings/student-bookings-copy';
import { DashboardIcon } from '@/components/dashboard/dashboard-icon';
import { NotebookHeading, PaperCard } from '@/components/ui/notebook';
import { NotebookLoadingRegion } from '@/components/ui/notebook-loading';
import { getMyBooking } from '@/lib/api/bookings';
import { useLanguage } from '@/lib/i18n';

import styles from './student-bookings.module.css';

import type { BookingDetail, RescheduleRequestStatus } from '@/lib/api/types';

export default function StudentBookingDetailPage({ bookingId }: { bookingId: string }) {
  const { copy, language } = useLanguage();
  const text = copy.dashboard.booking;
  const pageText = studentBookingsCopy[language];
  const requestText = bookingRequestCopy[language];
  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [error, setError] = useState<unknown | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [loadedBookingId, setLoadedBookingId] = useState<string | null>(null);
  const [bookingRevision, setBookingRevision] = useState(0);
  const [rescheduleBusy, setRescheduleBusy] = useState(false);
  const [cancellationBusy, setCancellationBusy] = useState(false);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [rescheduleStale, setRescheduleStale] = useState(false);
  const [cancellationStale, setCancellationStale] = useState(false);
  const [rescheduleOutcome, setRescheduleOutcome] = useState<RescheduleRequestStatus | null>(null);
  const latestBookingRevision = useRef(0);
  const restoreClassroomRefreshFocusRef = useRef(false);
  const isCurrentBookingLoaded = loadedBookingId === bookingId;
  const loading = isLoading || !isCurrentBookingLoaded;

  useEffect(() => {
    let active = true;

    getMyBooking(bookingId)
      .then((result) => {
        if (!active) return;
        setBooking(result);
        setRescheduleStale(false);
        setCancellationStale(false);
        setRescheduleOutcome(null);
        setError(null);
        setLoadedBookingId(bookingId);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setBooking(null);
        setError(caught);
        setLoadedBookingId(bookingId);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [bookingId, reloadKey]);

  const handlePaymentBookingChange = useCallback(
    (nextBooking: BookingDetail): void => {
      if (bookingRevision === latestBookingRevision.current) {
        setBooking(nextBooking);
      }
    },
    [bookingRevision],
  );

  return (
    <div className={styles.page}>
      <NotebookHeading
        eyebrow={text.bookingsEyebrow}
        title={text.bookingDetails}
        className={styles.heading ?? ''}
      />
      <PaperCard className={styles.paper} aria-busy={loading}>
        {loading ? (
          <div className={styles.state}>
            <NotebookLoadingRegion label={text.loading} />
          </div>
        ) : error || !booking ? (
          <div className={`${styles.state} ${styles.error}`} role="alert">
            <p>{getBookingErrorMessage(error, text)}</p>
            <Link href="/dashboard/bookings" className={styles.link}>
              {text.backToBookings}
            </Link>
          </div>
        ) : (
          <>
            <div className={styles.detailStatus}>
              <span>{text.bookingDetails}</span>
              <BookingDocketStatus status={booking.status} text={requestText} appearance="tag" />
            </div>
            <BookingDocketSummary
              summary={booking}
              amounts={booking}
              language={language}
              text={text}
              requestText={requestText}
              presentation="detail"
              timeLabel={booking.status === 'PENDING' ? requestText.time : text.lessonTime}
            />
            <ClassDetailsPanel
              key={`${booking.id}:${booking.slot.id}`}
              bookingId={booking.id}
              status={booking.status}
              paymentStatus={booking.paymentStatus}
              variant="compact"
              refreshDisabled={rescheduleBusy || cancellationBusy || paymentBusy}
              restoreRefreshFocusRef={restoreClassroomRefreshFocusRef}
              onRefresh={() => {
                // Refresh the shared snapshot before remounting classroom reads. Older payment
                // callbacks must not replace the newly loaded status or schedule.
                latestBookingRevision.current += 1;
                setBookingRevision(latestBookingRevision.current);
                restoreClassroomRefreshFocusRef.current = true;
                setIsLoading(true);
                setReloadKey((value) => value + 1);
              }}
            />
            <div className={styles.detailFooter}>
              <p className={styles.notice} data-status={booking.status}>
                {booking.status === 'PENDING'
                  ? pageText.pendingNotice
                  : booking.status === 'CONFIRMED'
                    ? pageText.confirmedNotice
                    : pageText.otherNotice}
              </p>

              <div className={styles.paymentColumns}>
                <div className={styles.amountColumn}>
                  <div className={styles.detailAmounts}>
                    <BookingDocketAmounts amounts={booking} text={text} />
                  </div>

                  <div className={styles.detailTotal}>
                    <BookingDocketTotal
                      amount={booking.netAmount}
                      currency={booking.currency}
                      label={pageText.amount}
                    />
                  </div>
                </div>

                <PromptPayPaymentPanel
                  key={`${booking.id}:${booking.slot.id}`}
                  booking={booking}
                  disabled={
                    rescheduleBusy || rescheduleStale || cancellationBusy || cancellationStale
                  }
                  onSubmittingChange={setPaymentBusy}
                  onBookingChange={handlePaymentBookingChange}
                />
              </div>
            </div>
            <div className={styles.detailActions}>
              <RescheduleRequestPanel
                key={`${booking.id}:${booking.slot.id}:${booking.status}`}
                booking={booking}
                className="border-0 p-0"
                tutorId={booking.tutor.tutorId}
                disabled={cancellationBusy || cancellationStale || paymentBusy}
                onBusyChange={(busy) => {
                  setRescheduleBusy(busy);
                  if (busy) {
                    latestBookingRevision.current += 1;
                    setBookingRevision(latestBookingRevision.current);
                  }
                }}
                onRequiresRefresh={() => setRescheduleStale(true)}
                outcome={rescheduleOutcome}
                onOutcome={setRescheduleOutcome}
                onApproved={(result) => {
                  latestBookingRevision.current += 1;
                  setBookingRevision(latestBookingRevision.current);
                  setBooking((current) =>
                    current?.id === result.booking.id
                      ? {
                          ...current,
                          slot: result.newSlot,
                          status: result.booking.status,
                          netAmount: result.booking.netAmount,
                          subtotalAmount: result.booking.subtotalAmount,
                          updatedAt: result.booking.updatedAt,
                        }
                      : current,
                  );
                }}
                onRefresh={() => {
                  setIsLoading(true);
                  setReloadKey((value) => value + 1);
                }}
              />
              <BookingCancellation
                key={booking.id}
                booking={booking}
                compact
                disabled={
                  rescheduleBusy ||
                  rescheduleStale ||
                  paymentBusy ||
                  booking.paymentPending === true
                }
                onBusyChange={setCancellationBusy}
                onRequiresRefresh={() => setCancellationStale(true)}
                onCanceled={(result) => {
                  // Invalidate callbacks captured by payment reads before this server-confirmed write.
                  // The ref changes synchronously, including before React commits the new state.
                  latestBookingRevision.current += 1;
                  setBookingRevision(latestBookingRevision.current);
                  setBooking((current) =>
                    current?.id === result.bookingId
                      ? { ...current, status: result.status }
                      : current,
                  );
                }}
                onRefresh={() => {
                  setIsLoading(true);
                  setReloadKey((value) => value + 1);
                }}
              />
            </div>
          </>
        )}
      </PaperCard>
      {!loading && booking && error === null && (
        <div className={styles.detailLinks}>
          <Link href="/dashboard/bookings" className={styles.ticket}>
            <span className={styles.ticketLabel}>{text.backToBookings}</span>
            <span className={styles.ticketStub} aria-hidden="true">
              <DashboardIcon name="arrow-right" className="h-4 w-4" />
            </span>
          </Link>
          <Link href="/tutors" className={styles.link}>
            {text.findTutor}
          </Link>
        </div>
      )}
    </div>
  );
}
