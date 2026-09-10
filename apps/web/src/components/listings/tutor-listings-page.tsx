'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import DashboardShell from '@/components/dashboard/dashboard-shell';
import {
  ListingIcon,
  ListingMetric,
  ListingPageState,
  ListingStatusBadge,
} from '@/components/listings/listing-ui';
import { ApiError } from '@/lib/api/error';
import { archiveTutorListing, getTutorListings, publishTutorListing } from '@/lib/api/listings';
import { getMyProfile } from '@/lib/api/profiles';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/lib/i18n';

import type { ListingPublicationStatus, TeachingListing } from '@/lib/api/types';

type ListingFilter = 'ALL' | ListingPublicationStatus;

export default function TutorListingsPage() {
  const { isLoading: authLoading, logout, user } = useAuth();
  const { language } = useLanguage();
  const router = useRouter();
  const copy = language === 'th' ? thaiCopy : englishCopy;
  const [listings, setListings] = useState<TeachingListing[]>([]);
  const [filter, setFilter] = useState<ListingFilter>('ALL');
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [archiveCandidate, setArchiveCandidate] = useState<string | null>(null);
  const [isVerified, setIsVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace('/');
      return;
    }
    if (user.role !== 'TUTOR') {
      router.replace('/dashboard');
      return;
    }

    let active = true;
    Promise.all([getTutorListings(), getMyProfile()])
      .then(([items, profile]) => {
        if (!active) return;
        setListings(items);
        setIsVerified(
          Boolean(
            profile.profile &&
            'verificationStatus' in profile.profile &&
            profile.profile.verificationStatus === 'VERIFIED',
          ),
        );
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : copy.loadError);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [authLoading, copy.loadError, router, user]);

  const counts = useMemo(
    () => ({
      ALL: listings.length,
      DRAFT: listings.filter((item) => item.publicationStatus === 'DRAFT').length,
      PUBLISHED: listings.filter((item) => item.publicationStatus === 'PUBLISHED').length,
      ARCHIVED: listings.filter((item) => item.publicationStatus === 'ARCHIVED').length,
    }),
    [listings],
  );

  const nextStep = useMemo(() => {
    if (!isVerified) return copy.verifyProfile;
    if (counts.DRAFT > 0) return copy.reviewDrafts;
    return copy.keepTeaching;
  }, [copy.keepTeaching, copy.reviewDrafts, copy.verifyProfile, counts.DRAFT, isVerified]);

  const visibleListings = useMemo(() => {
    const query = search.trim().toLocaleLowerCase(language === 'th' ? 'th' : 'en');
    return listings.filter((listing) => {
      if (filter !== 'ALL' && listing.publicationStatus !== filter) return false;
      if (!query) return true;
      return [listing.subject.name, listing.gradeLevel.name, listing.description]
        .join(' ')
        .toLocaleLowerCase(language === 'th' ? 'th' : 'en')
        .includes(query);
    });
  }, [filter, language, listings, search]);

  const handlePublish = async (listingId: string) => {
    if (!isVerified) return;
    setBusyId(listingId);
    setError(null);
    try {
      await publishTutorListing(listingId);
      setListings((current) =>
        current.map((item) =>
          item.listingId === listingId
            ? { ...item, publicationStatus: 'PUBLISHED', publishedAt: new Date().toISOString() }
            : item,
        ),
      );
    } catch (caught: unknown) {
      setError(readListingError(caught, copy.actionError));
    } finally {
      setBusyId(null);
    }
  };

  const handleArchive = async (listingId: string) => {
    setBusyId(listingId);
    setError(null);
    try {
      const updated = await archiveTutorListing(listingId);
      setListings((current) =>
        current.map((item) => (item.listingId === listingId ? updated : item)),
      );
      setArchiveCandidate(null);
    } catch (caught: unknown) {
      setError(readListingError(caught, copy.actionError));
    } finally {
      setBusyId(null);
    }
  };

  const handleLogout = async () => {
    await logout();
    router.replace('/');
  };

  if (authLoading || isLoading || !user) {
    return <ListingPageState>{copy.loading}</ListingPageState>;
  }

  if (user.role !== 'TUTOR') return null;

  const statusLabels = {
    DRAFT: copy.draft,
    PUBLISHED: copy.published,
    ARCHIVED: copy.archived,
  };

  return (
    <DashboardShell
      user={user}
      onLogout={handleLogout}
      visualVariant="profile"
      headerNavRight={
        <Link href="/dashboard/listings/new" className="dash-cta">
          {copy.newListing}
        </Link>
      }
    >
      <div className="min-w-0 py-5 pb-12 sm:py-8">
        <header className="border-b border-[#ded8ce] pb-7">
          <div>
            <p className="text-[0.7rem] font-extrabold uppercase tracking-[0.22em] text-[#b87434]">
              {copy.eyebrow}
            </p>
            <h1 className="mt-2 text-[clamp(2rem,5vw,3rem)] font-black leading-none tracking-[-0.055em] text-[#241a14]">
              {copy.title}
            </h1>
            <p className="mt-3 max-w-2xl text-[0.95rem] leading-7 text-[#665f57]">
              {copy.subtitle}
            </p>
          </div>
        </header>

        <section className="mt-6 grid gap-3 sm:grid-cols-3" aria-label={copy.overviewLabel}>
          <ListingMetric
            icon="listing"
            label={copy.totalListings}
            value={String(counts.ALL)}
            detail={copy.totalListingsDetail}
          />
          <ListingMetric
            icon="check"
            label={copy.published}
            value={String(counts.PUBLISHED)}
            detail={copy.publishedDetail}
          />
          <ListingMetric
            icon={isVerified ? 'check' : 'info'}
            label={copy.nextStep}
            value={nextStep}
            detail={isVerified ? copy.verifiedDetail : copy.unverifiedDetail}
          />
        </section>

        {!isVerified && (
          <div className="mt-5 flex gap-3 rounded-md border border-[#e8c99f] bg-[#fff8ed] p-4 text-sm leading-6 text-[#7e5428]">
            <span
              className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#f5dfbd] text-[#9b6531]"
              aria-hidden="true"
            >
              <ListingIcon name="info" />
            </span>
            <div>
              <strong className="block text-[#573819]">{copy.verificationTitle}</strong>
              <span>{copy.verificationBody}</span>{' '}
              <Link
                href="/dashboard/profile"
                className="font-extrabold underline decoration-[#d18b43] underline-offset-4"
              >
                {copy.openProfile}
              </Link>
            </div>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mt-6 rounded-md border border-[#e2b7ae] bg-[#fff4f1] p-4 text-sm text-[#a34334]"
          >
            {error}
          </div>
        )}

        <section className="mt-5 rounded-md border border-[#e1dbd1] bg-white shadow-[0_14px_35px_-24px_rgba(67,45,25,0.45)]">
          <div className="flex flex-col gap-4 border-b border-[#ebe6dd] p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="hidden flex-wrap gap-2 sm:flex" aria-label={copy.filterLabel}>
              {(['ALL', 'PUBLISHED', 'DRAFT', 'ARCHIVED'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  aria-pressed={filter === value}
                  className={`min-h-11 rounded-md border px-3.5 text-sm font-bold transition focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#d18b43] ${
                    filter === value
                      ? 'border-[#34271e] bg-[#34271e] text-white'
                      : 'border-[#ded8ce] bg-[#fffdf9] text-[#625b53] hover:border-[#bda98f] hover:text-[#241a14]'
                  }`}
                >
                  {value === 'ALL' ? copy.all : statusLabels[value]}{' '}
                  <span className={filter === value ? 'text-[#ffd6a2]' : 'text-[#a46d36]'}>
                    {counts[value]}
                  </span>
                </button>
              ))}
            </div>

            <label className="sm:hidden">
              <span className="sr-only">{copy.filterLabel}</span>
              <select
                value={filter}
                onChange={(event) => setFilter(event.target.value as ListingFilter)}
                className="min-h-12 w-full rounded-md border border-[#d9d2c6] bg-[#fffdf9] px-4 text-sm font-bold text-[#241a14]"
              >
                {(['ALL', 'PUBLISHED', 'DRAFT', 'ARCHIVED'] as const).map((value) => (
                  <option key={value} value={value}>
                    {value === 'ALL' ? copy.all : statusLabels[value]} ({counts[value]})
                  </option>
                ))}
              </select>
            </label>

            <label className="flex min-h-12 w-full items-center gap-2 rounded-md border border-[#d9d2c6] bg-[#fffdf9] px-3.5 transition focus-within:border-[#d18b43] focus-within:ring-4 focus-within:ring-[#d18b43]/10 lg:max-w-sm">
              <ListingIcon name="search" />
              <span className="sr-only">{copy.searchLabel}</span>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={copy.searchPlaceholder}
                className="w-full bg-transparent text-sm text-[#241a14] outline-none placeholder:text-[#8a857b]"
              />
            </label>
          </div>

          <div className="p-4 sm:p-5">
            {visibleListings.length === 0 ? (
              <div className="flex min-h-72 flex-col items-center justify-center rounded-md border border-dashed border-[#d9d2c6] bg-[#fbf8f2] px-5 py-12 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-md bg-[#f2e3d2] text-[#9b6531]">
                  <ListingIcon name="listing" />
                </span>
                <h2 className="mt-4 text-lg font-black text-[#241a14]">
                  {listings.length === 0 ? copy.emptyTitle : copy.noResultsTitle}
                </h2>
                <p className="mt-2 max-w-md text-sm leading-6 text-[#6b645c]">
                  {listings.length === 0 ? copy.emptyBody : copy.noResultsBody}
                </p>
                {listings.length === 0 && (
                  <Link
                    href="/dashboard/listings/new"
                    className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-md bg-[#34271e] px-4 text-sm font-extrabold text-white"
                  >
                    <ListingIcon name="add" />
                    {copy.createFirst}
                  </Link>
                )}
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {visibleListings.map((listing) => (
                  <article
                    key={listing.listingId}
                    className="flex min-h-[21rem] min-w-0 flex-col rounded-md border border-[#e4ded4] bg-[#fffdf9] p-5 transition hover:border-[#cdbfae] hover:shadow-[0_15px_30px_-24px_rgba(59,39,21,0.55)] sm:p-6"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-[#b87434]">
                          {listing.subject.name}
                        </p>
                        <h2 className="mt-1 [overflow-wrap:anywhere] text-xl font-black tracking-[-0.025em] text-[#241a14]">
                          {listing.subject.name} · {listing.gradeLevel.name}
                        </h2>
                      </div>
                      <ListingStatusBadge
                        status={listing.publicationStatus}
                        labels={statusLabels}
                      />
                    </div>

                    <div className="mt-4 min-h-[5.5rem]">
                      <p className="text-[0.68rem] font-extrabold uppercase tracking-[0.13em] text-[#8a8178]">
                        {copy.studentDescription}
                      </p>
                      <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-[#686158]">
                        {listing.description}
                      </p>
                    </div>

                    <div className="mt-5 grid grid-cols-2 gap-3 border-y border-[#ebe6dd] py-4">
                      <div>
                        <p className="text-[0.68rem] font-extrabold uppercase tracking-[0.12em] text-[#8a8178]">
                          {copy.rate}
                        </p>
                        <p className="mt-1 text-lg font-black tracking-[-0.03em] text-[#241a14]">
                          {formatPrice(listing.pricePerHour, language)}
                          <span className="ml-1 text-xs font-semibold text-[#6c655d]">
                            /{copy.hour}
                          </span>
                        </p>
                      </div>
                      <div>
                        <p className="text-[0.68rem] font-extrabold uppercase tracking-[0.12em] text-[#8a8178]">
                          {listing.publicationStatus === 'PUBLISHED' && listing.publishedAt
                            ? copy.publishedOn
                            : copy.updated}
                        </p>
                        <p className="mt-1 text-sm font-bold text-[#4e443b]">
                          {formatDate(
                            listing.publicationStatus === 'PUBLISHED' && listing.publishedAt
                              ? listing.publishedAt
                              : listing.updatedAt,
                            language,
                          )}
                        </p>
                      </div>
                    </div>

                    <div className="mt-auto flex flex-col gap-2 pt-4 sm:flex-row sm:items-center">
                      <Link
                        href={`/dashboard/listings/${listing.listingId}/edit`}
                        className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md border border-[#d9d2c6] bg-white px-3.5 text-sm font-extrabold text-[#3e342c] transition hover:border-[#bba990] hover:bg-[#faf5ed]"
                      >
                        <ListingIcon name="edit" />
                        {copy.edit}
                      </Link>
                      {listing.publicationStatus === 'DRAFT' && (
                        <button
                          type="button"
                          disabled={!isVerified || busyId === listing.listingId}
                          onClick={() => void handlePublish(listing.listingId)}
                          className="min-h-11 flex-1 rounded-md bg-[#34271e] px-3.5 text-sm font-extrabold text-white transition hover:bg-[#4b3729] disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          {busyId === listing.listingId ? copy.working : copy.publish}
                        </button>
                      )}
                      {listing.publicationStatus === 'PUBLISHED' &&
                        (archiveCandidate === listing.listingId ? (
                          <div className="flex min-h-11 flex-1 items-center gap-2 rounded-md border border-[#e6c0b7] bg-[#fff4f1] p-1.5">
                            <span className="min-w-0 flex-1 px-1 text-xs font-bold text-[#91493d]">
                              {copy.archiveConfirm}
                            </span>
                            <button
                              type="button"
                              disabled={busyId === listing.listingId}
                              onClick={() => void handleArchive(listing.listingId)}
                              className="min-h-11 rounded-sm bg-[#9b4e40] px-3 text-xs font-extrabold text-white"
                            >
                              {copy.confirm}
                            </button>
                            <button
                              type="button"
                              onClick={() => setArchiveCandidate(null)}
                              className="min-h-11 rounded-sm px-2 text-xs font-extrabold text-[#5e5a52]"
                            >
                              {copy.cancel}
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setArchiveCandidate(listing.listingId)}
                            className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md border border-[#ead7d1] px-3 text-sm font-extrabold text-[#985043] transition hover:bg-[#fff0ec]"
                          >
                            <ListingIcon name="archive" />
                            {copy.archive}
                          </button>
                        ))}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </DashboardShell>
  );
}

function readListingError(error: unknown, fallback: string) {
  if (error instanceof ApiError && error.status === 403) return fallback;
  return error instanceof Error ? error.message : fallback;
}

function formatPrice(value: number, language: 'en' | 'th') {
  return new Intl.NumberFormat(language === 'th' ? 'th-TH' : 'en-US', {
    style: 'currency',
    currency: 'THB',
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value);
}

function formatDate(value: string, language: 'en' | 'th') {
  return new Intl.DateTimeFormat(language === 'th' ? 'th-TH' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Bangkok',
  }).format(new Date(value));
}

const englishCopy = {
  eyebrow: 'Teaching listings',
  title: 'Your teaching offers',
  subtitle:
    'Create focused listings that tell students exactly what you teach, for whom, and at what price.',
  newListing: 'New listing',
  overviewLabel: 'Listing overview',
  totalListings: 'All listings',
  totalListingsDetail: 'Drafts and published offers in your workspace',
  publishedDetail: 'Visible to students after profile verification',
  nextStep: 'Next step',
  verifyProfile: 'Verify profile',
  reviewDrafts: 'Review drafts',
  keepTeaching: 'Keep teaching',
  verifiedDetail: 'Your profile is ready to publish',
  unverifiedDetail: 'Complete verification to go live',
  verificationTitle: 'Publishing is currently unavailable',
  verificationBody:
    'You can create and edit drafts now. Complete tutor verification before publishing.',
  openProfile: 'Open profile',
  all: 'All',
  published: 'Published',
  draft: 'Draft',
  archived: 'Archived',
  filterLabel: 'Filter teaching listings',
  searchLabel: 'Search teaching listings',
  searchPlaceholder: 'Search subject, grade, or description',
  emptyTitle: 'Create your first teaching listing',
  emptyBody:
    'A clear listing helps students understand your subject, target grade, approach, and hourly rate.',
  noResultsTitle: 'No listings match this view',
  noResultsBody: 'Try another status or clear the search field.',
  createFirst: 'Create first listing',
  studentDescription: 'Student-facing description',
  rate: 'Rate',
  hour: 'hour',
  updated: 'Updated',
  publishedOn: 'Published',
  edit: 'Edit',
  publish: 'Publish',
  archive: 'Archive',
  archiveConfirm: 'Archive this?',
  confirm: 'Confirm',
  cancel: 'Cancel',
  working: 'Working…',
  loading: 'Loading your teaching listings…',
  loadError: 'Unable to load your teaching listings.',
  actionError: 'Unable to update this listing. Check your profile status and try again.',
};

const thaiCopy: typeof englishCopy = {
  eyebrow: 'ประกาศสอน',
  title: 'คอร์สสอนของคุณ',
  subtitle:
    'สร้างประกาศที่ชัดเจน เพื่อให้นักเรียนเข้าใจทันทีว่าคุณสอนอะไร เหมาะกับใคร และราคาเท่าไร',
  newListing: 'สร้างประกาศใหม่',
  overviewLabel: 'ภาพรวมประกาศสอน',
  totalListings: 'ประกาศทั้งหมด',
  totalListingsDetail: 'รวมฉบับร่างและประกาศที่เผยแพร่แล้ว',
  publishedDetail: 'นักเรียนจะมองเห็นเมื่อโปรไฟล์ผ่านการยืนยัน',
  nextStep: 'ขั้นตอนถัดไป',
  verifyProfile: 'ยืนยันโปรไฟล์',
  reviewDrafts: 'ตรวจฉบับร่าง',
  keepTeaching: 'สร้างต่อได้เลย',
  verifiedDetail: 'โปรไฟล์พร้อมเผยแพร่แล้ว',
  unverifiedDetail: 'ยืนยันโปรไฟล์เพื่อเผยแพร่',
  verificationTitle: 'ยังไม่สามารถเผยแพร่ได้',
  verificationBody:
    'คุณสร้างและแก้ไขฉบับร่างได้ทันที และเผยแพร่ได้เมื่อโปรไฟล์ติวเตอร์ผ่านการยืนยัน',
  openProfile: 'เปิดโปรไฟล์',
  all: 'ทั้งหมด',
  published: 'เผยแพร่แล้ว',
  draft: 'ฉบับร่าง',
  archived: 'เก็บถาวร',
  filterLabel: 'กรองประกาศสอน',
  searchLabel: 'ค้นหาประกาศสอน',
  searchPlaceholder: 'ค้นหาวิชา ระดับชั้น หรือคำอธิบาย',
  emptyTitle: 'สร้างประกาศสอนแรกของคุณ',
  emptyBody: 'ประกาศที่ชัดเจนช่วยให้นักเรียนเข้าใจรายวิชา ระดับชั้น แนวทางการสอน และราคาต่อชั่วโมง',
  noResultsTitle: 'ไม่พบประกาศในมุมมองนี้',
  noResultsBody: 'ลองเลือกสถานะอื่นหรือล้างคำค้นหา',
  createFirst: 'สร้างประกาศแรก',
  studentDescription: 'คำอธิบายที่นักเรียนจะเห็น',
  rate: 'ราคา',
  hour: 'ชั่วโมง',
  updated: 'แก้ไข',
  publishedOn: 'เผยแพร่เมื่อ',
  edit: 'แก้ไข',
  publish: 'เผยแพร่',
  archive: 'เก็บถาวร',
  archiveConfirm: 'เก็บรายการนี้?',
  confirm: 'ยืนยัน',
  cancel: 'ยกเลิก',
  working: 'กำลังดำเนินการ…',
  loading: 'กำลังโหลดประกาศสอน…',
  loadError: 'ไม่สามารถโหลดประกาศสอนได้',
  actionError: 'ไม่สามารถอัปเดตประกาศนี้ได้ โปรดตรวจสอบสถานะโปรไฟล์แล้วลองอีกครั้ง',
};
