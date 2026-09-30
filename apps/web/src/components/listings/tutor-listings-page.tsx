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
  listingButtonClass,
} from '@/components/listings/listing-ui';
import { GraphPaper, PaperCard, StickyNote, WashiTape } from '@/components/ui/notebook';
import {
  archiveTutorListing,
  getTutorListings,
  publishTutorListing,
  restoreTutorListing,
} from '@/lib/api/listings';
import { formatBangkokShortDate } from '@/lib/date-time';
import { useLanguage } from '@/lib/i18n';
import { getTutorProfile } from '@/lib/profile-navigation';
import { useProfileSession } from '@/lib/use-profile-session';

import type { ListingPublicationStatus, TeachingListing } from '@/lib/api/types';

type ListingFilter = 'ALL' | ListingPublicationStatus;

export default function TutorListingsPage() {
  const {
    isLoading: sessionLoading,
    logout,
    profile,
    profileError,
    profileUser,
    user,
  } = useProfileSession({
    preserveReturnTo: true,
    profileMode: 'required',
    profileErrorMode: 'report',
    requiredRole: 'TUTOR',
  });
  const { language } = useLanguage();
  const router = useRouter();
  const copy = language === 'th' ? thaiCopy : englishCopy;
  const [listings, setListings] = useState<TeachingListing[]>([]);
  const [filter, setFilter] = useState<ListingFilter>('ALL');
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [archiveCandidate, setArchiveCandidate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tutorProfile = profile ? getTutorProfile(profile) : null;
  const isVerified = tutorProfile?.verificationStatus === 'VERIFIED';

  useEffect(() => {
    if (!user || user.role !== 'TUTOR') return;

    let active = true;
    getTutorListings()
      .then((items) => {
        if (!active) return;
        setListings(items);
      })
      .catch(() => {
        if (!active) return;
        setError(copy.loadError);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [copy.loadError, user]);

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
    if (counts.DRAFT > 0) return copy.reviewDrafts;
    return isVerified ? copy.keepTeaching : copy.verifyProfile;
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
    if (!isVerified) {
      setError(copy.actionError);
      return;
    }
    setBusyId(listingId);
    setError(null);
    try {
      const updated = await publishTutorListing(listingId);
      setListings((current) => current.map((item) => (item.id === listingId ? updated : item)));
    } catch {
      setError(copy.actionError);
    } finally {
      setBusyId(null);
    }
  };

  const handleRestoreDraft = async (listingId: string) => {
    setBusyId(listingId);
    setError(null);
    try {
      const updated = await restoreTutorListing(listingId);
      setListings((current) => current.map((item) => (item.id === listingId ? updated : item)));
    } catch {
      setError(copy.actionError);
    } finally {
      setBusyId(null);
    }
  };

  const handleArchive = async (listingId: string) => {
    setBusyId(listingId);
    setError(null);
    try {
      const updated = await archiveTutorListing(listingId);
      setListings((current) => current.map((item) => (item.id === listingId ? updated : item)));
      setArchiveCandidate(null);
    } catch {
      setError(copy.actionError);
    } finally {
      setBusyId(null);
    }
  };

  const handleLogout = async () => {
    await logout();
    router.replace('/');
  };

  if (sessionLoading || isLoading || !user) {
    return <ListingPageState>{copy.loading}</ListingPageState>;
  }

  if (user.role !== 'TUTOR') return null;
  if (profileError || !profileUser || !tutorProfile) {
    return <ListingPageState>{profileError ?? copy.loadError}</ListingPageState>;
  }

  const statusLabels = {
    DRAFT: copy.draft,
    PUBLISHED: copy.published,
    ARCHIVED: copy.archived,
  };

  return (
    <DashboardShell
      user={profileUser}
      onLogout={handleLogout}
      headerNavRight={
        <Link href="/dashboard/listings/new" data-dashboard-action>
          {copy.newListing}
        </Link>
      }
    >
      <div className="min-w-0 pb-12">
        <header className="mb-6 mt-7">
          <p className="font-note text-xl font-semibold leading-none text-amber-700 sm:text-2xl">
            {copy.eyebrow}
          </p>
          <h1 className="mt-2 flex flex-wrap items-center gap-3 text-3xl font-bold tracking-[-0.045em] text-notebook-ink sm:text-4xl">
            <span>{copy.title}</span>
            <span className="inline-flex items-center rounded-full border border-blue-200 bg-sticky-blue px-2.5 py-1 text-xs font-bold tracking-wide text-tutor-deep">
              {copy.tutorRole}
            </span>
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-notebook-muted sm:text-base">
            {copy.subtitle}
          </p>
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
          <StickyNote tone="yellow" className="mt-5 flex gap-3 p-4 text-sm leading-6">
            <span
              className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/75 text-amber-700"
              aria-hidden="true"
            >
              <ListingIcon name="info" />
            </span>
            <div>
              <strong className="block text-notebook-ink">{copy.verificationTitle}</strong>
              <span className="text-notebook-muted">{copy.verificationBody}</span>{' '}
              <Link
                href="/dashboard/profile"
                className="font-extrabold text-notebook-ink underline decoration-margin-guide decoration-2 underline-offset-4"
              >
                {copy.openProfile}
              </Link>
            </div>
          </StickyNote>
        )}

        {error && (
          <div
            role="alert"
            className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700"
          >
            {error}
          </div>
        )}

        <PaperCard className="mt-5 overflow-hidden p-0">
          <WashiTape tone="blue" className="-top-2 left-8 rotate-2" />
          <div className="flex flex-col gap-4 border-b border-dashed border-paper-edge bg-paper/80 p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="hidden flex-wrap gap-2 sm:flex" aria-label={copy.filterLabel}>
              {(['ALL', 'PUBLISHED', 'DRAFT', 'ARCHIVED'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  aria-pressed={filter === value}
                  className={`min-h-11 rounded-full border px-3.5 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tutor/30 focus-visible:ring-offset-2 ${
                    filter === value
                      ? 'border-tutor-deep bg-tutor-deep text-white shadow-sm'
                      : 'border-paper-edge bg-paper text-notebook-muted hover:border-tutor hover:bg-sticky-blue/45 hover:text-notebook-ink'
                  }`}
                >
                  {value === 'ALL' ? copy.all : statusLabels[value]}{' '}
                  <span className={filter === value ? 'text-blue-100' : 'text-tutor-deep'}>
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
                className="min-h-12 w-full rounded-lg border border-paper-edge bg-paper px-4 text-sm font-bold text-notebook-ink outline-none focus:border-tutor focus:ring-4 focus:ring-sticky-blue/70"
              >
                {(['ALL', 'PUBLISHED', 'DRAFT', 'ARCHIVED'] as const).map((value) => (
                  <option key={value} value={value}>
                    {value === 'ALL' ? copy.all : statusLabels[value]} ({counts[value]})
                  </option>
                ))}
              </select>
            </label>

            <label className="flex min-h-12 w-full items-center gap-2 rounded-lg border border-paper-edge bg-paper px-3.5 text-notebook-muted transition focus-within:border-tutor focus-within:ring-4 focus-within:ring-sticky-blue/70 lg:max-w-sm">
              <ListingIcon name="search" />
              <span className="sr-only">{copy.searchLabel}</span>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={copy.searchPlaceholder}
                className="w-full bg-transparent text-sm text-notebook-ink outline-none placeholder:text-stone-400"
              />
            </label>
          </div>

          <div className="p-4 sm:p-5">
            {visibleListings.length === 0 ? (
              <GraphPaper className="flex min-h-72 flex-col items-center justify-center border-dashed px-5 py-12 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-sticky-blue text-tutor-deep shadow-sm">
                  <ListingIcon name="listing" />
                </span>
                <h2 className="mt-4 text-lg font-black text-notebook-ink">
                  {listings.length === 0 ? copy.emptyTitle : copy.noResultsTitle}
                </h2>
                <p className="mt-2 max-w-md text-sm leading-6 text-notebook-muted">
                  {listings.length === 0 ? copy.emptyBody : copy.noResultsBody}
                </p>
                {listings.length === 0 && (
                  <Link
                    href="/dashboard/listings/new"
                    className={listingButtonClass('primary', 'mt-5')}
                  >
                    <ListingIcon name="add" />
                    {copy.createFirst}
                  </Link>
                )}
              </GraphPaper>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {visibleListings.map((listing) => (
                  <PaperCard
                    key={listing.id}
                    className="flex min-h-[21rem] min-w-0 flex-col overflow-hidden p-5 transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-paper sm:p-6"
                  >
                    <WashiTape
                      tone={listing.publicationStatus === 'ARCHIVED' ? 'pink' : 'blue'}
                      className="-right-5 -top-1 rotate-12 opacity-70"
                    />
                    <div className="flex flex-col items-start gap-3 sm:flex-row sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-tutor-deep">
                          {listing.subject.name}
                        </p>
                        <h2 className="mt-1 [overflow-wrap:anywhere] text-xl font-black tracking-[-0.025em] text-notebook-ink">
                          {listing.subject.name} · {listing.gradeLevel.name}
                        </h2>
                      </div>
                      <ListingStatusBadge
                        status={listing.publicationStatus}
                        labels={statusLabels}
                      />
                    </div>

                    <div className="mt-4 min-h-[5.5rem]">
                      <p className="text-[0.68rem] font-extrabold uppercase tracking-[0.13em] text-notebook-muted">
                        {copy.studentDescription}
                      </p>
                      <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-notebook-muted">
                        {listing.description}
                      </p>
                    </div>

                    <div className="mt-5 grid grid-cols-2 gap-3 border-y border-dashed border-paper-edge py-4">
                      <div>
                        <p className="text-[0.68rem] font-extrabold uppercase tracking-[0.12em] text-notebook-muted">
                          {copy.rate}
                        </p>
                        <p className="mt-1 text-lg font-black tracking-[-0.03em] text-notebook-ink">
                          {formatPrice(listing.pricePerHour, language)}
                          <span className="ml-1 text-xs font-semibold text-notebook-muted">
                            /{copy.hour}
                          </span>
                        </p>
                      </div>
                      <div>
                        <p className="text-[0.68rem] font-extrabold uppercase tracking-[0.12em] text-notebook-muted">
                          {listing.publicationStatus === 'PUBLISHED' && listing.publishedAt
                            ? copy.publishedOn
                            : copy.updated}
                        </p>
                        <p className="mt-1 text-sm font-bold text-notebook-ink">
                          {formatBangkokShortDate(
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
                        href={`/dashboard/listings/${listing.id}/edit`}
                        className={listingButtonClass('secondary', 'flex-1')}
                      >
                        <ListingIcon name="edit" />
                        {copy.edit}
                      </Link>
                      {listing.publicationStatus === 'DRAFT' && (
                        <button
                          type="button"
                          disabled={busyId === listing.id || !isVerified}
                          onClick={() => void handlePublish(listing.id)}
                          className={listingButtonClass('primary', 'flex-1')}
                        >
                          {busyId === listing.id ? copy.working : copy.publish}
                        </button>
                      )}
                      {listing.publicationStatus === 'PUBLISHED' &&
                        (archiveCandidate === listing.id ? (
                          <div className="flex min-h-11 flex-1 items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-1.5">
                            <span className="min-w-0 flex-1 px-1 text-xs font-bold text-red-700">
                              {copy.archiveConfirm}
                            </span>
                            <button
                              type="button"
                              disabled={busyId === listing.id}
                              onClick={() => void handleArchive(listing.id)}
                              className={listingButtonClass('danger', 'min-h-10 px-3 py-2 text-xs')}
                            >
                              {copy.confirm}
                            </button>
                            <button
                              type="button"
                              onClick={() => setArchiveCandidate(null)}
                              className={listingButtonClass(
                                'secondary',
                                'min-h-10 px-2 py-2 text-xs',
                              )}
                            >
                              {copy.cancel}
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setArchiveCandidate(listing.id)}
                            className={listingButtonClass(
                              'secondary',
                              'flex-1 border-red-200 text-red-700 hover:bg-red-50',
                            )}
                          >
                            <ListingIcon name="archive" />
                            {copy.archive}
                          </button>
                        ))}
                      {listing.publicationStatus === 'ARCHIVED' && (
                        <>
                          <button
                            type="button"
                            disabled={busyId === listing.id || !isVerified}
                            onClick={() => void handleRestoreDraft(listing.id)}
                            className={listingButtonClass('secondary', 'flex-1')}
                          >
                            {busyId === listing.id ? copy.working : copy.restoreDraft}
                          </button>
                          <button
                            type="button"
                            disabled={busyId === listing.id}
                            onClick={() => void handlePublish(listing.id)}
                            className={listingButtonClass('primary', 'flex-1')}
                          >
                            {busyId === listing.id ? copy.working : copy.publish}
                          </button>
                        </>
                      )}
                    </div>
                  </PaperCard>
                ))}
              </div>
            )}
          </div>
        </PaperCard>
      </div>
    </DashboardShell>
  );
}

function formatPrice(value: number, language: 'en' | 'th') {
  return new Intl.NumberFormat(language === 'th' ? 'th-TH' : 'en-US', {
    style: 'currency',
    currency: 'THB',
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value);
}

const englishCopy = {
  eyebrow: 'Teaching listings',
  tutorRole: 'Tutor',
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
  verificationTitle: 'Verification is pending',
  verificationBody:
    'You can create and edit drafts now. Publishing becomes available after verification.',
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
  restoreDraft: 'Restore draft',
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
  tutorRole: 'ติวเตอร์',
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
  verificationTitle: 'กำลังรอตรวจสอบโปรไฟล์',
  verificationBody: 'คุณสร้างและแก้ไขฉบับร่างได้ และจะเผยแพร่ได้หลังจากโปรไฟล์ผ่านการยืนยัน',
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
  restoreDraft: 'คืนเป็นฉบับร่าง',
  archive: 'เก็บถาวร',
  archiveConfirm: 'เก็บรายการนี้?',
  confirm: 'ยืนยัน',
  cancel: 'ยกเลิก',
  working: 'กำลังดำเนินการ…',
  loading: 'กำลังโหลดประกาศสอน…',
  loadError: 'ไม่สามารถโหลดประกาศสอนได้',
  actionError: 'ไม่สามารถอัปเดตประกาศนี้ได้ โปรดตรวจสอบสถานะโปรไฟล์แล้วลองอีกครั้ง',
};
