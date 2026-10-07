'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { DashboardIcon } from '@/components/dashboard/dashboard-icon';
import { ProfileAvatar } from '@/components/profile/profile-avatar';
import { publicTutorDetailCopy } from '@/components/tutors/public-tutor-detail-copy';
import {
  formatPublicTutorSlot,
  groupPublicTutorSlots,
} from '@/components/tutors/public-tutor-detail-model';
import { tutorSearchCopy } from '@/components/tutors/tutor-search-copy';
import {
  NotebookHeading,
  PaperCard,
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

import styles from './public-tutor-availability.module.css';

import type { PublicAvailabilitySlot, PublicTutorDetail } from '@/lib/api/types';

export default function PublicTutorAvailabilityPage({ tutorId }: { tutorId: string }) {
  const { copy, language } = useLanguage();
  const { user } = useAuth();
  const text = copy.dashboard.tutorAvailability;
  const detailText = publicTutorDetailCopy[language];
  const searchText = tutorSearchCopy[language];
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedListingId = searchParams.get('listingId');
  const conflict = searchParams.get('conflict') === '1';
  const [detail, setDetail] = useState<PublicTutorDetail | null>(null);
  const [slots, setSlots] = useState<PublicAvailabilitySlot[]>([]);
  const [selectedListingId, setSelectedListingId] = useState(requestedListingId ?? '');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
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
  const days = useMemo(() => groupPublicTutorSlots(slots, language), [slots, language]);
  const selectedDay = days.find((day) => day.key === selectedDate);
  const visibleDays = selectedDay ? [selectedDay] : days;

  if (isLoading || !isCurrentTutorLoaded) {
    return <NotebookLoadingRegion label={text.loading} />;
  }

  if (error || !detail) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <div className={styles.error} role="alert">
        <p>{notFound ? text.notFound : text.error}</p>
        <Link href="/tutors" className="mt-4 inline-block font-bold underline">
          {text.back}
        </Link>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <Link href="/tutors" className={styles.back}>
          ← {text.back}
        </Link>
        <NotebookHeading eyebrow={text.eyebrow} title={detailText.title} />
      </header>

      {conflict && (
        <StickyNote tone="yellow" className={styles.conflict} role="alert">
          {text.conflict}
        </StickyNote>
      )}

      <PaperCard className={styles.profile} aria-labelledby="public-tutor-name">
        <span className={`${styles.tab} ${styles.tutorTab}`}>{detailText.tutor}</span>
        <WashiTape tone="blue" className={`${styles.tape}`} />
        <div className={styles.profileHeader}>
          <div className="min-w-0">
            <div className={styles.person}>
              <ProfileAvatar
                name={detail.tutor.displayName}
                publicTutorId={tutorId}
                avatarUpdatedAt={detail.tutor.avatarUpdatedAt}
                fallback={Array.from(detail.tutor.displayName.trim())[0] || 'T'}
                sizes="44px"
                className={styles.avatar ?? ''}
              />
              <div className="min-w-0">
                <h2 id="public-tutor-name">{detail.tutor.displayName}</h2>
                <p className={styles.verification}>{searchText.verified}</p>
              </div>
            </div>
            <p className={styles.rating}>
              {detail.tutor.ratingAverage === null ? (
                <span>{searchText.newTutor}</span>
              ) : (
                <span className={styles.score}>
                  <DashboardIcon name="star" className="h-4 w-4 text-amber-700" />
                  {detail.tutor.ratingAverage.toFixed(1)}
                </span>
              )}
              <span>
                · {detail.tutor.reviewCount} {searchText.reviews}
              </span>
            </p>
          </div>
          <StickyNote tone="yellow" className={styles.experience}>
            <strong className="font-note">
              {detail.tutor.experienceYears} {detailText.years}
            </strong>
            <span>{detailText.experience}</span>
          </StickyNote>
        </div>
        <div className={styles.about}>
          <h3>{detailText.about}</h3>
          <p className={styles.bio}>{detail.tutor.bio}</p>
        </div>
      </PaperCard>

      <div className={styles.layout}>
        <PaperCard className={styles.directory} aria-labelledby="public-tutor-courses">
          <div className={styles.sectionHeading}>
            <h2 id="public-tutor-courses" className="font-note">
              {text.listings}
            </h2>
            <span>
              {detail.listings.length} {detailText.courses}
            </span>
          </div>
          {detail.listings.length === 0 ? (
            <p className={styles.empty}>{detailText.noListings}</p>
          ) : (
            <ul>
              {detail.listings.map((listing) => {
                const selected = effectiveListingId === listing.listingId;
                return (
                  <li key={listing.listingId} className={styles.course} data-selected={selected}>
                    <div className={styles.offer}>
                      <div className="min-w-0">
                        <span className={styles.grade}>{listing.grade}</span>
                        <h3>{listing.subject}</h3>
                      </div>
                      <div className={styles.price}>
                        <strong>{formatTutorRate(listing.pricePerHour, language)} ฿</strong>
                        <span>/ {detailText.hour}</span>
                      </div>
                    </div>
                    <p className={styles.description}>{listing.description}</p>
                    <div className={styles.courseActions}>
                      {selected && (
                        <span className={styles.selectedMark}>
                          <DashboardIcon name="check" className="h-4 w-4" />
                          {detailText.selected}
                        </span>
                      )}
                      <button
                        type="button"
                        aria-pressed={selected}
                        aria-label={`${detailText.select}: ${listing.subject} · ${listing.grade}`}
                        className={notebookButtonClass({
                          tone: 'secondary',
                          className: styles.courseButton,
                        })}
                        onClick={() => setSelectedListingId(listing.listingId)}
                      >
                        {selected ? detailText.selectedButton : detailText.select}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </PaperCard>

        <PaperCard className={styles.pad} aria-labelledby="public-tutor-times">
          <span className={styles.tab}>{detailText.appointmentPad}</span>
          <h2 id="public-tutor-times" className="font-note">
            {text.availability}
          </h2>
          <p className={styles.padHint}>
            {text.availabilityHint} · {detailText.window}
          </p>
          <div className={styles.selectedCourse} aria-live="polite" aria-atomic="true">
            {selectedListing ? (
              <>
                <div className="min-w-0">
                  <p className={styles.selectedLabel}>{detailText.selected}</p>
                  <h3>
                    {selectedListing.subject} · {selectedListing.grade}
                  </h3>
                </div>
                <span className={styles.selectedRate}>
                  {formatTutorRate(selectedListing.pricePerHour, language)} ฿ / {detailText.hour}
                </span>
              </>
            ) : (
              <p>{detailText.selectFirst}</p>
            )}
          </div>
          {slots.length === 0 ? (
            <p className={styles.empty}>{text.noSlots}</p>
          ) : (
            <>
              <div className={styles.dateIndex} role="group" aria-label={detailText.dateIndex}>
                <button
                  type="button"
                  aria-pressed={!selectedDay}
                  onClick={() => setSelectedDate(null)}
                >
                  {detailText.allDates}
                </button>
                {days.map((day) => (
                  <button
                    type="button"
                    key={day.key}
                    aria-pressed={selectedDay?.key === day.key}
                    aria-label={day.label}
                    onClick={() => setSelectedDate(day.key)}
                  >
                    {day.indexLabel}
                  </button>
                ))}
              </div>
              <p className="sr-only" role="status">
                {detailText.showing
                  .replace(
                    '{count}',
                    String(visibleDays.reduce((count, day) => count + day.slots.length, 0)),
                  )
                  .replace('{date}', selectedDay?.label ?? detailText.allDates)}
              </p>
              <div className={styles.days}>
                {visibleDays.map((day) => (
                  <section key={day.key} className={styles.day} aria-label={day.label}>
                    <h3 className={styles.date} aria-label={day.label}>
                      <span className={styles.dayNumber}>{day.day}</span>
                      <span>
                        {day.month} {day.year}
                      </span>
                      <span>{day.weekday}</span>
                    </h3>
                    <ul className={styles.slotList}>
                      {day.slots.map((slot) => {
                        const time = formatPublicTutorSlot(slot, language);
                        const actionLabel =
                          user && user.role !== 'STUDENT'
                            ? text.studentOnly
                            : user
                              ? text.choose
                              : text.signInToChoose;
                        return (
                          <li key={slot.id} className={styles.slot}>
                            <div className={styles.slotTime}>
                              <p>
                                {time.endDate ? `${time.start} →` : `${time.start}–${time.end}`}
                              </p>
                              {time.endDate && (
                                <span>
                                  {detailText.until} {time.endDate} · {time.end}
                                </span>
                              )}
                            </div>
                            <button
                              type="button"
                              className={notebookButtonClass({ className: styles.slotButton })}
                              disabled={
                                !selectedListing || Boolean(user && user.role !== 'STUDENT')
                              }
                              aria-label={`${actionLabel} · ${time.label}`}
                              onClick={() => {
                                if (!selectedListing) return;
                                const bookingPath = `/dashboard/bookings/new?listingId=${encodeURIComponent(selectedListing.listingId)}&slotId=${encodeURIComponent(slot.id)}`;
                                router.push(user ? bookingPath : withReturnTo('/', bookingPath));
                              }}
                            >
                              {actionLabel}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))}
              </div>
            </>
          )}
          <p className={styles.padFooter}>{detailText.availabilityNote}</p>
        </PaperCard>
      </div>
      <p className={styles.continueHint}>{detailText.continueHint}</p>
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
