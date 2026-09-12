'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import {
  bookingCopy,
  BookingStatusBadge,
  formatBangkokRange,
  formatDuration,
  formatMoney,
  getBookingErrorMessage,
} from '@/components/bookings/booking-ui';
import { createBookingOnce, getBookingQuote } from '@/lib/api/bookings';
import { ApiError } from '@/lib/api/error';
import { useLanguage } from '@/lib/i18n';

import type { BookingText } from '@/components/bookings/booking-ui';
import type { BookingQuote, BookingResponse } from '@/lib/api/types';
import type { ReactNode } from 'react';

export default function BookingConfirmationPage() {
  const { language } = useLanguage();
  const text = bookingCopy[language];
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
      if (response) setCreated(response);
    } catch (caught: unknown) {
      setCreated(null);
      setSubmitError(caught);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="booking-page">
      <section className="mb-8 max-w-3xl">
        <p className="mb-2 text-xs font-extrabold uppercase tracking-[0.18em] text-[#c07a2e]">
          Booking
        </p>
        <h1 className="text-4xl font-black tracking-[-0.06em] text-[#171714] sm:text-5xl">
          Review your lesson request
        </h1>
        <p className="mt-3 text-base leading-7 text-[#625b53]">
          Choose one open time and send a request. A successful booking starts as PENDING.
        </p>
      </section>

      {!missingSelection && (!selectionLoaded || isQuoteLoading) && (
        <p
          className="rounded-2xl bg-white p-6 text-sm font-semibold text-[#625b53] shadow-sm"
          role="status"
        >
          {text.loading}
        </p>
      )}

      {missingSelection && (
        <BookingError error={new ApiError('Missing booking selection', 400)} text={text} />
      )}

      {!isQuoteLoading && activeQuoteError !== null && (
        <BookingError error={activeQuoteError} text={text} />
      )}

      {!isQuoteLoading && activeQuote && !activeCreated && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
          <section className="rounded-[1.5rem] border border-[#ebe6dd] bg-white p-6 shadow-[0_18px_40px_-12px_rgba(46,39,25,0.14)] sm:p-8">
            <div className="flex items-start gap-4">
              <div className="booking-list-avatar" aria-hidden="true">
                {getInitials(activeQuote.tutor.displayName)}
              </div>
              <div>
                <h2 className="text-2xl font-extrabold text-[#171714]">
                  {activeQuote.tutor.displayName}
                </h2>
                <p className="mt-1 text-sm font-semibold text-[#0e8a73]">VERIFIED TUTOR</p>
              </div>
            </div>

            <div className="mt-6 rounded-2xl bg-[#f8f5ef] p-5">
              <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-[#8a857b]">
                Selected listing
              </p>
              <h3 className="mt-2 text-xl font-extrabold text-[#171714]">
                {activeQuote.listing.subjectName} · {activeQuote.listing.gradeLevelName}
              </h3>
              <p className="mt-2 text-sm leading-6 text-[#625b53]">
                {activeQuote.listing.description}
              </p>
            </div>

            <div className="mt-5 rounded-2xl border border-[#ebe6dd] p-5">
              <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-[#8a857b]">
                {text.lessonTime}
              </p>
              <p className="mt-2 text-lg font-extrabold text-[#171714]">
                {formatBangkokRange(
                  activeQuote.slot.startAtUtc,
                  activeQuote.slot.endAtUtc,
                  language,
                )}
              </p>
              <p className="mt-1 text-sm text-[#70695f]">
                {text.bangkokTime} ·{' '}
                {formatDuration(activeQuote.slot.startAtUtc, activeQuote.slot.endAtUtc, text)}
              </p>
            </div>

            <p className="mt-5 rounded-2xl border border-[#f0dfbd] bg-[#fffaf0] p-4 text-sm leading-6 text-[#9b6b2c]">
              Request, not confirmation. The tutor will confirm the pending booking later.
            </p>
          </section>

          <aside className="h-fit rounded-[1.5rem] border border-[#ebe6dd] bg-white p-6 shadow-[0_18px_40px_-12px_rgba(46,39,25,0.14)] sm:p-8">
            <h2 className="text-xl font-extrabold text-[#171714]">Booking summary</h2>
            <p className="mt-1 text-sm text-[#8a857b]">Amounts are confirmed by the server.</p>
            <div className="mt-6 space-y-3 text-sm">
              <MoneyRow
                label="Hourly rate"
                value={formatMoney(activeQuote.listing.pricePerHour, activeQuote.currency)}
              />
              <MoneyRow
                label={text.duration}
                value={formatDuration(activeQuote.slot.startAtUtc, activeQuote.slot.endAtUtc, text)}
              />
              <MoneyRow
                label={text.subtotal}
                value={formatMoney(activeQuote.subtotalAmount, activeQuote.currency)}
              />
              <MoneyRow
                label={text.discount}
                value={formatMoney(activeQuote.discountAmount, activeQuote.currency)}
              />
              <div className="flex items-center justify-between border-t border-[#ebe6dd] pt-4 text-base font-extrabold text-[#171714]">
                <span>{text.total}</span>
                <span>{formatMoney(activeQuote.netAmount, activeQuote.currency)}</span>
              </div>
            </div>

            {activeSubmitError !== null && (
              <SubmitError
                error={activeSubmitError}
                text={text}
                tutorId={activeQuote.tutor.tutorId}
                listingId={activeQuote.listing.id}
              />
            )}

            <button
              type="button"
              className="mt-6 w-full rounded-full bg-[#1c1a16] px-5 py-3.5 text-sm font-extrabold text-white transition hover:bg-[#353129] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSubmitting}
              aria-busy={isSubmitting}
              onClick={() => void submit()}
            >
              {isSubmitting ? 'Sending request…' : 'Send booking request'}
            </button>
            <Link
              href={`/tutors/${encodeURIComponent(activeQuote.tutor.tutorId)}?listingId=${encodeURIComponent(activeQuote.listing.id)}`}
              className="mt-3 block text-center text-sm font-bold text-[#625b53] underline"
            >
              Change time
            </Link>
          </aside>
        </div>
      )}

      {activeCreated && activeQuote && (
        <section className="rounded-[1.5rem] border border-[#bcebdc] bg-white p-6 shadow-[0_18px_40px_-12px_rgba(46,39,25,0.14)] sm:p-8">
          <div className="rounded-2xl bg-[#e9fbf4] p-5">
            <h2 className="text-2xl font-extrabold text-[#0e8a73]">Booking request sent</h2>
            <p className="mt-2 text-sm leading-6 text-[#3f7165]">
              Your request was created as {activeCreated.status}. The selected time is now reserved.
            </p>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <SummaryBox
              label={text.status}
              value={<BookingStatusBadge status={activeCreated.status} text={text} />}
            />
            <SummaryBox
              label="Tutor and subject"
              value={`${activeQuote.tutor.displayName} · ${activeQuote.listing.subjectName} · ${activeQuote.listing.gradeLevelName}`}
            />
            <SummaryBox
              label={text.amount}
              value={formatMoney(activeCreated.netAmount, activeCreated.currency)}
            />
          </div>
          <p className="mt-5 text-sm text-[#70695f]">
            {text.created}:{' '}
            {formatBangkokRange(activeCreated.createdAt, activeCreated.createdAt, language)}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              className="rounded-full bg-[#1c1a16] px-5 py-3 text-sm font-extrabold text-white"
              onClick={() =>
                router.push(`/dashboard/bookings/${encodeURIComponent(activeCreated.id)}`)
              }
            >
              {text.view} {text.bookingDetails}
            </button>
            <Link href="/dashboard/bookings" className="booking-secondary-button">
              {text.backToBookings}
            </Link>
            <Link href="/tutors" className="booking-secondary-button">
              {text.findTutor}
            </Link>
          </div>
        </section>
      )}
    </main>
  );
}

function BookingError({ error, text }: { error: unknown; text: BookingText }) {
  return (
    <div
      className="rounded-2xl border border-[#e2b7ae] bg-[#fff4f1] p-6 text-sm text-[#a34334]"
      role="alert"
    >
      <p>{getBookingErrorMessage(error, text)}</p>
      <div className="mt-4 flex flex-wrap gap-3">
        {error instanceof ApiError && error.status === 401 && (
          <Link href="/" className="font-bold underline">
            {text.signIn}
          </Link>
        )}
        <Link href="/tutors" className="font-bold underline">
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
    <div
      className="mt-5 rounded-2xl border border-[#e2b7ae] bg-[#fff4f1] p-4 text-sm leading-6 text-[#a34334]"
      role="alert"
    >
      <p>{getBookingErrorMessage(error, text)}</p>
      {conflict && (
        <Link
          href={`/tutors/${encodeURIComponent(tutorId)}?listingId=${encodeURIComponent(listingId)}&conflict=1`}
          className="mt-2 inline-block font-bold underline"
        >
          Choose another time
        </Link>
      )}
      {error instanceof ApiError && error.status === 401 && (
        <Link href="/" className="mt-2 inline-block font-bold underline">
          {text.signIn}
        </Link>
      )}
    </div>
  );
}

function MoneyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-[#625b53]">
      <span>{label}</span>
      <strong className="text-[#332e28]">{value}</strong>
    </div>
  );
}

function SummaryBox({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-2xl bg-[#f8f5ef] p-4">
      <p className="text-xs font-extrabold uppercase tracking-[0.1em] text-[#8a857b]">{label}</p>
      <div className="mt-2 text-sm font-extrabold text-[#332e28]">{value}</div>
    </div>
  );
}

function getInitials(displayName: string): string {
  return (
    displayName
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || '?'
  );
}
