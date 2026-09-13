'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

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
    return (
      <p className="rounded-2xl bg-white p-6 text-sm font-semibold text-[#625b53]" role="status">
        {text.loading}
      </p>
    );
  }

  if (error || !detail) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <div
        className="rounded-2xl border border-[#e2b7ae] bg-[#fff4f1] p-6 text-sm text-[#a34334]"
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
    <div className="tutor-search-page text-[#171714]">
      <section className="mb-8 max-w-4xl">
        <Link href="/tutors" className="text-sm font-bold text-[#625b53] underline">
          ← {text.back}
        </Link>
        <p className="mt-6 mb-2 text-xs font-extrabold uppercase tracking-[0.18em] text-[#c07a2e]">
          {text.eyebrow}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-4xl font-black tracking-[-0.06em] sm:text-5xl">
            {detail.tutor.displayName}
          </h1>
          <span
            className={`rounded-full px-3 py-1.5 text-xs font-extrabold ${
              detail.tutor.verificationStatus === 'VERIFIED'
                ? 'bg-[rgba(34,196,154,0.14)] text-[#0e8a73]'
                : 'bg-[#fff0d8] text-[#9b6b2c]'
            }`}
          >
            {detail.tutor.verificationStatus === 'VERIFIED'
              ? text.verified
              : text.pendingVerification}
          </span>
        </div>
        <p className="mt-3 max-w-2xl text-base leading-7 text-[#625b53]">{detail.tutor.bio}</p>
      </section>

      {conflict && (
        <p
          className="mb-6 rounded-2xl border border-[#f0dfbd] bg-[#fffaf0] p-4 text-sm font-semibold text-[#9b6b2c]"
          role="alert"
        >
          {text.conflict}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.2fr)]">
        <section className="rounded-[1.5rem] border border-[#ebe6dd] bg-white p-5 shadow-[0_18px_40px_-12px_rgba(46,39,25,0.14)] sm:p-6">
          <h2 className="text-xl font-extrabold">{text.listings}</h2>
          <div className="mt-5 space-y-3">
            {detail.listings.map((listing) => (
              <button
                key={listing.listingId}
                type="button"
                className={`w-full rounded-2xl border p-4 text-left transition ${effectiveListingId === listing.listingId ? 'border-[#0e8a73] bg-[#e9fbf4]' : 'border-[#ebe6dd] hover:bg-[#fcfbf8]'}`}
                onClick={() => setSelectedListingId(listing.listingId)}
              >
                <span className="block text-base font-extrabold">
                  {listing.subject} · {listing.grade}
                </span>
                <span className="mt-1 block text-sm text-[#625b53]">{listing.description}</span>
                <span className="mt-2 block text-sm font-bold text-[#0e8a73]">
                  {listing.pricePerHour} THB/hour
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-[1.5rem] border border-[#ebe6dd] bg-white p-5 shadow-[0_18px_40px_-12px_rgba(46,39,25,0.14)] sm:p-6">
          <h2 className="text-xl font-extrabold">{text.availability}</h2>
          <p className="mt-1 text-sm text-[#8a857b]">{text.availabilityHint}</p>
          {selectedListing && (
            <p className="mt-4 rounded-xl bg-[#f8f5ef] p-3 text-sm font-bold text-[#332e28]">
              {text.chooseListing}: {selectedListing.subject} · {selectedListing.grade}
            </p>
          )}
          {slots.length === 0 ? (
            <p className="mt-5 rounded-2xl border border-dashed border-[#e3ddd2] bg-[#fcfbf8] p-8 text-center text-sm text-[#70695f]">
              {text.noSlots}
            </p>
          ) : (
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {slots.map((slot) => (
                <div key={slot.id} className="rounded-2xl border border-[#ebe6dd] p-4">
                  <p className="text-sm font-extrabold text-[#171714]">
                    {formatSlot(slot, language)}
                  </p>
                  <button
                    type="button"
                    className="mt-3 w-full rounded-full bg-[#1c1a16] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#353129] disabled:cursor-not-allowed disabled:opacity-50"
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
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export function PublicTutorAvailabilityLoading() {
  const { copy } = useLanguage();
  return (
    <p className="p-6 text-sm font-semibold" role="status">
      {copy.dashboard.tutorAvailability.loading}
    </p>
  );
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
