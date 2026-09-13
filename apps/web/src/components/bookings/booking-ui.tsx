'use client';

import Link from 'next/link';

import { ApiError } from '@/lib/api/error';
import { useLanguage } from '@/lib/i18n';

import type { BookingStatus, BookingView } from '@/lib/api/types';
import type { Language, Translation } from '@/lib/i18n';

export type BookingLanguage = Language;
export type BookingText = Translation['dashboard']['booking'];

export function BookingLoading() {
  const { copy } = useLanguage();
  return (
    <p className="p-6 text-sm font-semibold" role="status">
      {copy.dashboard.booking.loading}
    </p>
  );
}

export function formatBangkokRange(
  startAtUtc: string,
  endAtUtc: string,
  language: BookingLanguage,
): string {
  const locale = language === 'th' ? 'th-TH' : 'en-GB';
  const dateOptions: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
  };
  const timeOptions: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Bangkok',
    hour12: false,
  };
  const start = new Date(startAtUtc);
  const end = new Date(endAtUtc);
  return `${new Intl.DateTimeFormat(locale, dateOptions).format(start)} · ${new Intl.DateTimeFormat(locale, timeOptions).format(start)}–${new Intl.DateTimeFormat(locale, timeOptions).format(end)}`;
}

export function formatBangkokDateTime(valueAtUtc: string, language: BookingLanguage): string {
  const locale = language === 'th' ? 'th-TH' : 'en-GB';
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(valueAtUtc));
}

export function formatDuration(startAtUtc: string, endAtUtc: string, text: BookingText): string {
  const hours = (new Date(endAtUtc).getTime() - new Date(startAtUtc).getTime()) / 3_600_000;
  const rounded = Number.isInteger(hours) ? String(hours) : String(Number(hours.toFixed(2)));
  return `${rounded} ${hours === 1 ? text.hour : text.hours}`;
}

export function formatMoney(amount: string, currency: string): string {
  return `${amount} ${currency}`;
}

export function getBookingErrorMessage(error: unknown, text: BookingText): string {
  if (error instanceof ApiError) {
    if (error.status === 400) return text.validationError;
    if (error.status === 401) return text.unauthenticated;
    if (error.status === 403) return text.forbidden;
    if (error.status === 404) return text.notFound;
    if (error.status === 409) return text.conflict;
  }
  return error instanceof Error && error.message ? error.message : text.unknown;
}

export function isBookingError(error: unknown, status: number): boolean {
  return error instanceof ApiError && error.status === status;
}

export function BookingStatusBadge({ status, text }: { status: BookingStatus; text: BookingText }) {
  const labels: Record<BookingStatus, string> = {
    CANCELED: text.canceled,
    COMPLETED: text.completed,
    CONFIRMED: text.confirmed,
    EXPIRED: text.expired,
    PENDING: text.pending,
  };
  return (
    <span className={`booking-status booking-status-${status.toLowerCase()}`}>
      {labels[status]}
    </span>
  );
}

export function BookingSummaryRow({
  booking,
  language,
  text,
}: {
  booking: BookingView;
  language: BookingLanguage;
  text: BookingText;
}) {
  return (
    <article className="booking-list-row">
      <div className="booking-list-avatar" aria-hidden="true">
        {getInitials(booking.tutor.displayName)}
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-base font-extrabold text-[#1a1916]">
          {booking.tutor.displayName}
        </h2>
        <p className="mt-1 text-sm font-semibold text-[#332e28]">
          {booking.listing.subjectName} · {booking.listing.gradeLevelName}
        </p>
        <p className="mt-1 text-sm text-[#70695f]">
          {formatBangkokRange(booking.slot.startAtUtc, booking.slot.endAtUtc, language)} ·{' '}
          {formatMoney(booking.netAmount, booking.currency)}
        </p>
      </div>
      <div className="booking-list-actions">
        <BookingStatusBadge status={booking.status} text={text} />
        <Link
          href={`/dashboard/bookings/${encodeURIComponent(booking.id)}`}
          className="booking-secondary-button"
        >
          {text.view}
        </Link>
      </div>
    </article>
  );
}

function getInitials(displayName: string): string {
  const initials = displayName
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('');
  return initials.toUpperCase() || '?';
}
