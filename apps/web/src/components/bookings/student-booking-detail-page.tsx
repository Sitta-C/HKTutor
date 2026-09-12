'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import {
  bookingCopy,
  BookingStatusBadge,
  formatBangkokRange,
  formatDuration,
  formatMoney,
  getBookingErrorMessage,
} from '@/components/bookings/booking-ui';
import { getMyBooking } from '@/lib/api/bookings';
import { useLanguage } from '@/lib/i18n';

import type { BookingDetail } from '@/lib/api/types';

export default function StudentBookingDetailPage({ bookingId }: { bookingId: string }) {
  const { language } = useLanguage();
  const text = bookingCopy[language];
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
    return (
      <p className="rounded-2xl bg-white p-6 text-sm font-semibold text-[#625b53]" role="status">
        {text.loading}
      </p>
    );
  }

  if (error || !booking) {
    return (
      <div
        className="rounded-2xl border border-[#e2b7ae] bg-[#fff4f1] p-6 text-sm text-[#a34334]"
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
    <main className="booking-page">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="mb-2 text-xs font-extrabold uppercase tracking-[0.18em] text-[#c07a2e]">
            {text.bookingDetails}
          </p>
          <h1 className="text-4xl font-black tracking-[-0.06em] text-[#171714]">
            {booking.tutor.displayName}
          </h1>
        </div>
        <BookingStatusBadge status={booking.status} text={text} />
      </div>

      <section className="rounded-[1.5rem] border border-[#ebe6dd] bg-white p-6 shadow-[0_18px_40px_-12px_rgba(46,39,25,0.14)] sm:p-8">
        <div className="grid gap-4 md:grid-cols-3">
          <InfoBox label={text.subject} value={booking.listing.subjectName} />
          <InfoBox label={text.grade} value={booking.listing.gradeLevelName} />
          <InfoBox
            label={text.lessonTime}
            value={formatBangkokRange(booking.slot.startAtUtc, booking.slot.endAtUtc, language)}
          />
        </div>
        <div className="mt-6 rounded-2xl bg-[#f8f5ef] p-5">
          <p className="text-xs font-extrabold uppercase tracking-[0.1em] text-[#8a857b]">
            {text.lessonTime}
          </p>
          <p className="mt-2 text-lg font-extrabold text-[#171714]">
            {formatBangkokRange(booking.slot.startAtUtc, booking.slot.endAtUtc, language)}
          </p>
          <p className="mt-1 text-sm text-[#70695f]">
            {text.bangkokTime} ·{' '}
            {formatDuration(booking.slot.startAtUtc, booking.slot.endAtUtc, text)}
          </p>
        </div>
        <div className="mt-6">
          <h2 className="text-lg font-extrabold text-[#171714]">{text.description}</h2>
          <p className="mt-2 text-sm leading-6 text-[#625b53]">{booking.listing.description}</p>
        </div>
        <div className="mt-6 grid gap-3 border-t border-[#ebe6dd] pt-5 text-sm md:grid-cols-3">
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
          <Link href="/dashboard/bookings" className="booking-secondary-button">
            {text.backToBookings}
          </Link>
          <Link href="/tutors" className="booking-secondary-button">
            {text.findTutor}
          </Link>
        </div>
      </section>
    </main>
  );
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-[#f8f5ef] p-4">
      <p className="text-xs font-extrabold uppercase tracking-[0.1em] text-[#8a857b]">{label}</p>
      <p className="mt-2 text-sm font-extrabold text-[#332e28]">{value}</p>
    </div>
  );
}
