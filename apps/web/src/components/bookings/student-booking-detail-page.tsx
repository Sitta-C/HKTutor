'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import {
  BookingStatusBadge,
  formatBangkokRange,
  formatDuration,
  formatMoney,
  getBookingErrorMessage,
} from '@/components/bookings/booking-ui';
import {
  GraphPaper,
  NotebookHeading,
  PaperCard,
  StickyNote,
  WashiTape,
  notebookButtonClass,
} from '@/components/ui/notebook';
import { NotebookLoadingRegion } from '@/components/ui/notebook-loading';
import { getMyBooking } from '@/lib/api/bookings';
import { useLanguage } from '@/lib/i18n';

import type { BookingDetail } from '@/lib/api/types';

export default function StudentBookingDetailPage({ bookingId }: { bookingId: string }) {
  const { copy, language } = useLanguage();
  const text = copy.dashboard.booking;
  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [error, setError] = useState<unknown | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadedBookingId, setLoadedBookingId] = useState<string | null>(null);
  const isCurrentBookingLoaded = loadedBookingId === bookingId;

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

  if (isLoading || !isCurrentBookingLoaded) {
    return <NotebookLoadingRegion label={text.loading} />;
  }

  if (error || !booking) {
    return (
      <div
        className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800"
        role="alert"
      >
        <p>{getBookingErrorMessage(error, text)}</p>
        <Link href="/dashboard/bookings" className="mt-4 inline-block font-bold underline">
          {text.backToBookings}
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1120px] py-8 pb-12">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <NotebookHeading eyebrow={text.bookingDetails} title={booking.tutor.displayName} />
        <BookingStatusBadge status={booking.status} text={text} />
      </div>

      <PaperCard className="relative overflow-hidden p-6 shadow-[0_18px_40px_-12px_rgba(46,39,25,0.14)] sm:p-8">
        <WashiTape tone="blue" className="-right-5 top-4 rotate-12" />
        <div className="grid gap-4 md:grid-cols-3">
          <InfoBox label={text.subject} value={booking.listing.subjectName} />
          <InfoBox label={text.grade} value={booking.listing.gradeLevelName} />
          <InfoBox
            label={text.lessonTime}
            value={formatBangkokRange(booking.slot.startAtUtc, booking.slot.endAtUtc, language)}
          />
        </div>
        <StickyNote tone="yellow" className="mt-6 p-5">
          <p className="text-xs font-extrabold uppercase tracking-[0.1em] text-notebook-muted">
            {text.lessonTime}
          </p>
          <p className="mt-2 text-lg font-extrabold text-notebook-ink">
            {formatBangkokRange(booking.slot.startAtUtc, booking.slot.endAtUtc, language)}
          </p>
          <p className="mt-1 text-sm text-notebook-muted">
            {text.bangkokTime} ·{' '}
            {formatDuration(booking.slot.startAtUtc, booking.slot.endAtUtc, text)}
          </p>
        </StickyNote>
        <div className="mt-6">
          <h2 className="font-note text-2xl font-bold text-notebook-ink">{text.description}</h2>
          <p className="mt-2 text-sm leading-6 text-notebook-muted">
            {booking.listing.description}
          </p>
        </div>
        <div className="mt-6 grid gap-3 border-t border-dashed border-paper-edge pt-5 text-sm md:grid-cols-3">
          <InfoBox
            label={text.subtotal}
            value={formatMoney(booking.subtotalAmount, booking.currency)}
          />
          <InfoBox
            label={text.discount}
            value={formatMoney(booking.discountAmount, booking.currency)}
          />
          <InfoBox label={text.total} value={formatMoney(booking.netAmount, booking.currency)} />
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/dashboard/bookings" className={notebookButtonClass({ tone: 'secondary' })}>
            {text.backToBookings}
          </Link>
          <Link href="/tutors" className={notebookButtonClass({ tone: 'secondary' })}>
            {text.findTutor}
          </Link>
        </div>
      </PaperCard>
    </div>
  );
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <GraphPaper className="rounded-xl p-4">
      <p className="text-xs font-extrabold uppercase tracking-[0.1em] text-notebook-muted">
        {label}
      </p>
      <p className="mt-2 text-sm font-extrabold text-notebook-ink">{value}</p>
    </GraphPaper>
  );
}
