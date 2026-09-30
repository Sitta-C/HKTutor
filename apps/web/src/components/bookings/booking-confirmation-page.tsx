'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import {
  BookingStatusBadge,
  getBookingStatusLabel,
  formatBangkokDateTime,
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
import { createBookingOnce, getBookingQuote } from '@/lib/api/bookings';
import { ApiError } from '@/lib/api/error';
import { useLanguage } from '@/lib/i18n';

import type { BookingText } from '@/components/bookings/booking-ui';
import type { BookingQuote, BookingResponse } from '@/lib/api/types';
import type { ReactNode } from 'react';

export default function BookingConfirmationPage() {
  const { copy, language } = useLanguage();
  const text = copy.dashboard.booking;
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
      } else {
        setSubmitError(new Error(text.submissionInProgress));
      }
    } catch (caught: unknown) {
      setCreated(null);
      setSubmitError(caught);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1120px] py-8 pb-12">
      <NotebookHeading
        eyebrow={text.pageEyebrow}
        title={text.reviewTitle}
        description={text.reviewDescription}
        className="mb-8"
      />

      {!missingSelection && (!selectionLoaded || isQuoteLoading) && (
        <StickyNote tone="yellow" className="p-6 text-sm font-semibold shadow-sm" role="status">
          {text.loading}
        </StickyNote>
      )}

      {missingSelection && (
        <BookingError error={new ApiError('Missing booking selection', 400)} text={text} />
      )}

      {!isQuoteLoading && activeQuoteError !== null && (
        <BookingError error={activeQuoteError} text={text} />
      )}

      {!isQuoteLoading && activeQuote && !activeCreated && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
          <PaperCard className="relative overflow-hidden p-6 shadow-[0_18px_40px_-12px_rgba(46,39,25,0.14)] sm:p-8">
            <WashiTape tone="blue" className="-left-5 top-4 -rotate-12" />
            <div className="flex items-start gap-4">
              <div
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-student-deep font-extrabold text-white shadow-sm"
                aria-hidden="true"
              >
                {getInitials(activeQuote.tutor.displayName)}
              </div>
              <div>
                <h2 className="text-2xl font-extrabold text-notebook-ink">
                  {activeQuote.tutor.displayName}
                </h2>
                <p className="mt-1 text-sm font-semibold text-student-deep">
                  {text.tutorVerification.replace(
                    '{status}',
                    activeQuote.tutor.verificationStatus ?? 'VERIFIED',
                  )}
                </p>
              </div>
            </div>

            <StickyNote tone="green" className="mt-6 p-5">
              <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-notebook-muted">
                {text.selectedListing}
              </p>
              <h3 className="mt-2 text-xl font-extrabold text-notebook-ink">
                {activeQuote.listing.subjectName} · {activeQuote.listing.gradeLevelName}
              </h3>
              <p className="mt-2 text-sm leading-6 text-notebook-muted">
                {activeQuote.listing.description}
              </p>
            </StickyNote>

            <GraphPaper className="mt-5 p-5">
              <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-notebook-muted">
                {text.lessonTime}
              </p>
              <p className="mt-2 text-lg font-extrabold text-notebook-ink">
                {formatBangkokRange(
                  activeQuote.slot.startAtUtc,
                  activeQuote.slot.endAtUtc,
                  language,
                )}
              </p>
              <p className="mt-1 text-sm text-notebook-muted">
                {text.bangkokTime} ·{' '}
                {formatDuration(activeQuote.slot.startAtUtc, activeQuote.slot.endAtUtc, text)}
              </p>
            </GraphPaper>

            <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800">
              {text.requestNotice}
            </p>
          </PaperCard>

          <PaperCard className="relative h-fit overflow-hidden p-6 shadow-[0_18px_40px_-12px_rgba(46,39,25,0.14)] sm:p-8">
            <WashiTape tone="pink" className="-right-5 top-3 rotate-12" />
            <h2 className="font-note text-2xl font-bold text-notebook-ink">
              {text.bookingSummary}
            </h2>
            <p className="mt-1 text-sm text-notebook-muted">{text.serverAmountNote}</p>
            <div className="mt-6 space-y-3 text-sm">
              <MoneyRow
                label={text.hourlyRate}
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
              <div className="flex items-center justify-between border-t border-dashed border-paper-edge pt-4 text-base font-extrabold text-notebook-ink">
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
              className={notebookButtonClass({ className: 'mt-6 w-full' })}
              disabled={isSubmitting}
              aria-busy={isSubmitting}
              onClick={() => void submit()}
            >
              {isSubmitting ? text.sendingRequest : text.sendBookingRequest}
            </button>
            <Link
              href={`/tutors/${encodeURIComponent(activeQuote.tutor.tutorId)}?listingId=${encodeURIComponent(activeQuote.listing.id)}`}
              className="mt-3 block text-center text-sm font-bold text-notebook-muted underline decoration-dashed underline-offset-4"
            >
              {text.changeTime}
            </Link>
          </PaperCard>
        </div>
      )}

      {activeCreated && activeQuote && (
        <PaperCard className="relative overflow-hidden border-emerald-200 p-6 shadow-[0_18px_40px_-12px_rgba(46,39,25,0.14)] sm:p-8">
          <WashiTape tone="blue" className="-right-5 top-3 rotate-12" />
          <StickyNote tone="green" className="p-5">
            <h2 className="font-note text-3xl font-bold text-student-deep">
              {text.bookingRequestSent}
            </h2>
            <p className="mt-2 text-sm leading-6 text-emerald-800">
              {text.requestCreatedStatus.replace(
                '{status}',
                getBookingStatusLabel(activeCreated.status, text),
              )}
            </p>
          </StickyNote>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <SummaryBox
              label={text.status}
              value={<BookingStatusBadge status={activeCreated.status} text={text} />}
            />
            <SummaryBox
              label={text.tutorAndSubject}
              value={`${activeQuote.tutor.displayName} · ${activeQuote.listing.subjectName} · ${activeQuote.listing.gradeLevelName}`}
            />
            <SummaryBox
              label={text.amount}
              value={formatMoney(activeCreated.netAmount, activeCreated.currency)}
            />
          </div>
          <p className="mt-5 text-sm text-notebook-muted">
            {text.created}: {formatBangkokDateTime(activeCreated.createdAt, language)}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              className={notebookButtonClass()}
              onClick={() =>
                router.push(`/dashboard/bookings/${encodeURIComponent(activeCreated.id)}`)
              }
            >
              {text.view} {text.bookingDetails}
            </button>
            <Link href="/dashboard/bookings" className={notebookButtonClass({ tone: 'secondary' })}>
              {text.backToBookings}
            </Link>
            <Link href="/tutors" className={notebookButtonClass({ tone: 'secondary' })}>
              {text.findTutor}
            </Link>
          </div>
        </PaperCard>
      )}
    </div>
  );
}

function BookingError({ error, text }: { error: unknown; text: BookingText }) {
  return (
    <div
      className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800"
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
      className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-800"
      role="alert"
    >
      <p>{getBookingErrorMessage(error, text)}</p>
      {conflict && (
        <Link
          href={`/tutors/${encodeURIComponent(tutorId)}?listingId=${encodeURIComponent(listingId)}&conflict=1`}
          className="mt-2 inline-block font-bold underline"
        >
          {text.chooseAnotherTime}
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
    <div className="flex items-center justify-between gap-4 text-notebook-muted">
      <span>{label}</span>
      <strong className="text-notebook-ink">{value}</strong>
    </div>
  );
}

function SummaryBox({ label, value }: { label: string; value: ReactNode }) {
  return (
    <GraphPaper className="rounded-xl p-4">
      <p className="text-xs font-extrabold uppercase tracking-[0.1em] text-notebook-muted">
        {label}
      </p>
      <div className="mt-2 text-sm font-extrabold text-notebook-ink">{value}</div>
    </GraphPaper>
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
