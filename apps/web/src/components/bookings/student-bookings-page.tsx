'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import {
  bookingCopy,
  BookingSummaryRow,
  getBookingErrorMessage,
} from '@/components/bookings/booking-ui';
import { getMyBookings } from '@/lib/api/bookings';
import { ApiError } from '@/lib/api/error';
import { useLanguage } from '@/lib/i18n';

import type { BookingText } from '@/components/bookings/booking-ui';
import type { BookingStatus, BookingView } from '@/lib/api/types';

type BookingFilter = 'ALL' | BookingStatus;

const filters: BookingFilter[] = [
  'ALL',
  'PENDING',
  'CONFIRMED',
  'COMPLETED',
  'CANCELED',
  'EXPIRED',
];

export default function StudentBookingsPage() {
  const { language } = useLanguage();
  const text = bookingCopy[language];
  const [filter, setFilter] = useState<BookingFilter>('ALL');
  const [items, setItems] = useState<BookingView[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<unknown | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = () => {
    setIsLoading(true);
    setError(null);
    setReloadKey((value) => value + 1);
  };

  useEffect(() => {
    let active = true;

    getMyBookings(filter === 'ALL' ? {} : { status: filter })
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
  }, [filter, reloadKey]);

  return (
    <main className="booking-page">
      <section className="mb-8 max-w-3xl">
        <p className="mb-2 text-xs font-extrabold uppercase tracking-[0.18em] text-[#c07a2e]">
          {text.myBookings}
        </p>
        <h1 className="text-4xl font-black tracking-[-0.06em] text-[#171714] sm:text-5xl">
          {text.myBookings}
        </h1>
        <p className="mt-3 text-base leading-7 text-[#625b53]">
          {total} {text.bookingCount}
        </p>
      </section>

      <section className="rounded-[1.5rem] border border-[#ebe6dd] bg-white p-5 shadow-[0_18px_40px_-12px_rgba(46,39,25,0.14)] sm:p-7">
        <div className="mb-6 flex flex-wrap gap-2" aria-label={text.status}>
          {filters.map((item) => (
            <button
              key={item}
              type="button"
              className={`rounded-full border px-4 py-2 text-sm font-bold transition ${
                filter === item
                  ? 'border-[#0e8a73] bg-[#dff7ef] text-[#0e8a73]'
                  : 'border-[#ebe6dd] bg-white text-[#625b53] hover:bg-[#f8f5ef]'
              }`}
              aria-pressed={filter === item}
              onClick={() => {
                setIsLoading(true);
                setError(null);
                setFilter(item);
              }}
            >
              {getFilterLabel(item, text)}
            </button>
          ))}
        </div>

        {isLoading && (
          <p
            className="rounded-2xl bg-[#f8f5ef] p-5 text-sm font-semibold text-[#625b53]"
            role="status"
          >
            {text.loading}
          </p>
        )}

        {!isLoading && error !== null && (
          <div
            className="rounded-2xl border border-[#e2b7ae] bg-[#fff4f1] p-5 text-sm text-[#a34334]"
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
          <div className="rounded-2xl border border-dashed border-[#e3ddd2] bg-[#fcfbf8] p-10 text-center">
            <h2 className="text-xl font-extrabold text-[#171714]">{text.emptyTitle}</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#70695f]">
              {text.emptyBody}
            </p>
            <Link
              href="/tutors"
              className="mt-5 inline-flex rounded-full bg-[#1c1a16] px-5 py-3 text-sm font-bold text-white"
            >
              {text.browseTutors}
            </Link>
          </div>
        )}

        {!isLoading && !error && items.length > 0 && (
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
        )}
      </section>
    </main>
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
