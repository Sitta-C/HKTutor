'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import {
  BookingDocketAmounts,
  BookingDocketStatus,
  BookingDocketSummary,
  BookingDocketTotal,
} from '@/components/bookings/booking-docket';
import { bookingRequestCopy } from '@/components/bookings/booking-request-copy';
import { getBookingErrorMessage } from '@/components/bookings/booking-ui';
import { studentBookingsCopy } from '@/components/bookings/student-bookings-copy';
import { DashboardIcon } from '@/components/dashboard/dashboard-icon';
import { NotebookHeading, PaperCard } from '@/components/ui/notebook';
import { NotebookLoadingRegion } from '@/components/ui/notebook-loading';
import { getMyBooking } from '@/lib/api/bookings';
import { useLanguage } from '@/lib/i18n';

import styles from './student-bookings.module.css';

import type { BookingDetail } from '@/lib/api/types';

export default function StudentBookingDetailPage({ bookingId }: { bookingId: string }) {
  const { copy, language } = useLanguage();
  const text = copy.dashboard.booking;
  const pageText = studentBookingsCopy[language];
  const requestText = bookingRequestCopy[language];
  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [error, setError] = useState<unknown | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadedBookingId, setLoadedBookingId] = useState<string | null>(null);
  const isCurrentBookingLoaded = loadedBookingId === bookingId;
  const loading = isLoading || !isCurrentBookingLoaded;

  useEffect(() => {
    let active = true;

    getMyBooking(bookingId)
      .then((result) => {
        if (!active) return;
        setBooking(result);
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
  }, [bookingId]);

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
            <div className={styles.detailFooter}>
              <p className={styles.notice} data-status={booking.status}>
                {booking.status === 'PENDING'
                  ? pageText.pendingNotice
                  : booking.status === 'CONFIRMED'
                    ? pageText.confirmedNotice
                    : pageText.otherNotice}
              </p>
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
