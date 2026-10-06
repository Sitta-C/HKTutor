'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import {
  GraphPaper,
  NotebookHeading,
  PaperCard,
  StatusBadge,
  StickyNote,
  WashiTape,
  notebookButtonClass,
} from '@/components/ui/notebook';
import { NotebookLoadingRegion } from '@/components/ui/notebook-loading';
import { ApiError } from '@/lib/api/error';
import { getPublicTutor, getPublicTutorAvailability } from '@/lib/api/tutors';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/lib/i18n';
import { withReturnTo } from '@/lib/return-to';

import type { PublicAvailabilitySlot, PublicTutorDetail } from '@/lib/api/types';

export default function PublicTutorAvailabilityPage({ tutorId }: { tutorId: string }) {
  const { copy, language } = useLanguage();
  const { user } = useAuth();
  const text = copy.dashboard.tutorAvailability;
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedListingId = searchParams.get('listingId');
  const conflict = searchParams.get('conflict') === '1';
  const [detail, setDetail] = useState<PublicTutorDetail | null>(null);
  const [slots, setSlots] = useState<PublicAvailabilitySlot[]>([]);
  const [selectedListingId, setSelectedListingId] = useState(requestedListingId ?? '');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<unknown | null>(null);
  const [loadedTutorId, setLoadedTutorId] = useState<string | null>(null);
  const isCurrentTutorLoaded = loadedTutorId === tutorId;

  useEffect(() => {
    let active = true;

    const availabilityFrom = new Date();
    const availabilityTo = new Date(availabilityFrom);
    availabilityTo.setDate(availabilityTo.getDate() + 30);

    Promise.all([
      getPublicTutor(tutorId),
      getPublicTutorAvailability(tutorId, { from: availabilityFrom, to: availabilityTo }),
    ])
      .then(([nextDetail, nextSlots]) => {
        if (!active) return;
        setDetail(nextDetail);
        setSlots(nextSlots);
        setError(null);
        setLoadedTutorId(tutorId);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(caught);
        setLoadedTutorId(tutorId);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [tutorId]);

  const effectiveListingId = detail?.listings.some(
    (listing) => listing.listingId === selectedListingId,
  )
    ? selectedListingId
    : (detail?.listings.find((listing) => listing.listingId === requestedListingId)?.listingId ??
      detail?.listings[0]?.listingId ??
      '');
  const selectedListing = useMemo(
    () => detail?.listings.find((listing) => listing.listingId === effectiveListingId) ?? null,
    [detail, effectiveListingId],
  );

  if (isLoading || !isCurrentTutorLoaded) {
    return <NotebookLoadingRegion label={text.loading} />;
  }

  if (error || !detail) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <div
        className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800"
        role="alert"
      >
        <p>{notFound ? text.notFound : text.error}</p>
        <Link href="/tutors" className="mt-4 inline-block font-bold underline">
          {text.back}
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1120px] py-8 lg:py-10">
      <section className="mb-8 max-w-4xl">
        <Link
          href="/tutors"
          className="text-sm font-bold text-notebook-muted underline decoration-dashed underline-offset-4"
        >
          ← {text.back}
        </Link>
        <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
          <NotebookHeading
            eyebrow={text.eyebrow}
            title={detail.tutor.displayName}
            description={detail.tutor.bio}
          />
          <StatusBadge tone="student" className="mb-1">
            {text.verified}
          </StatusBadge>
        </div>
      </section>

      {conflict && (
        <StickyNote tone="yellow" className="mb-6 p-4 text-sm font-semibold" role="alert">
          {text.conflict}
        </StickyNote>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.2fr)]">
        <PaperCard className="relative overflow-hidden p-5 shadow-[0_18px_40px_-12px_rgba(46,39,25,0.14)] sm:p-6">
          <WashiTape tone="pink" className="-left-5 top-3 -rotate-12" />
          <h2 className="font-note text-2xl font-bold">{text.listings}</h2>
          <div className="mt-5 space-y-3">
            {detail.listings.map((listing) => (
              <button
                key={listing.listingId}
                type="button"
                className={`w-full rounded-xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-student-deep/30 ${effectiveListingId === listing.listingId ? 'border-student-deep bg-sticky-green shadow-sm' : 'border-paper-edge bg-paper hover:bg-sticky-yellow/30'}`}
                onClick={() => setSelectedListingId(listing.listingId)}
              >
                <span className="block text-base font-extrabold">
                  {listing.subject} · {listing.grade}
                </span>
                <span className="mt-1 block text-sm text-notebook-muted">
                  {listing.description}
                </span>
                <span className="mt-2 block text-sm font-bold text-student-deep">
                  {formatTutorRate(listing.pricePerHour, language)} {text.pricePerHour}
                </span>
              </button>
            ))}
          </div>
        </PaperCard>

        <PaperCard className="relative overflow-hidden p-5 shadow-[0_18px_40px_-12px_rgba(46,39,25,0.14)] sm:p-6">
          <WashiTape tone="blue" className="-right-5 top-3 rotate-12" />
          <h2 className="font-note text-2xl font-bold">{text.availability}</h2>
          <p className="mt-1 text-sm text-notebook-muted">{text.availabilityHint}</p>
          {selectedListing && (
            <StickyNote tone="green" className="mt-4 p-3 text-sm font-bold">
              {text.chooseListing}: {selectedListing.subject} · {selectedListing.grade}
            </StickyNote>
          )}
          {slots.length === 0 ? (
            <GraphPaper className="mt-5 border-dashed p-8 text-center text-sm text-notebook-muted">
              {text.noSlots}
            </GraphPaper>
          ) : (
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {slots.map((slot) => (
                <GraphPaper key={slot.id} className="rounded-xl p-4">
                  <p className="text-sm font-extrabold text-notebook-ink">
                    {formatSlot(slot, language)}
                  </p>
                  <button
                    type="button"
                    className={notebookButtonClass({ className: 'mt-3 w-full' })}
                    disabled={!selectedListing || Boolean(user && user.role !== 'STUDENT')}
                    onClick={() => {
                      if (!selectedListing) return;
                      const bookingPath = `/dashboard/bookings/new?listingId=${encodeURIComponent(selectedListing.listingId)}&slotId=${encodeURIComponent(slot.id)}`;
                      router.push(user ? bookingPath : withReturnTo('/', bookingPath));
                    }}
                  >
                    {user && user.role !== 'STUDENT'
                      ? text.studentOnly
                      : user
                        ? text.choose
                        : text.signInToChoose}
                  </button>
                </GraphPaper>
              ))}
            </div>
          )}
        </PaperCard>
      </div>
    </div>
  );
}

function formatTutorRate(value: number, language: 'en' | 'th'): string {
  return new Intl.NumberFormat(language === 'th' ? 'th-TH' : 'en-US', {
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value);
}

export function PublicTutorAvailabilityLoading() {
  const { copy } = useLanguage();
  return <NotebookLoadingRegion label={copy.dashboard.tutorAvailability.loading} />;
}

function formatSlot(slot: PublicAvailabilitySlot, language: 'en' | 'th'): string {
  const locale = language === 'th' ? 'th-TH' : 'en-GB';
  const date = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
  }).format(new Date(slot.startAtUtc));
  const time = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Bangkok',
    hour12: false,
  });
  return `${date} · ${time.format(new Date(slot.startAtUtc))}–${time.format(new Date(slot.endAtUtc))}`;
}
