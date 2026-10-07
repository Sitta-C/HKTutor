'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import DashboardShell from '@/components/dashboard/dashboard-shell';
import {
  ListingIcon,
  ListingPageState,
  ListingStatusBadge,
  listingButtonClass,
} from '@/components/listings/listing-ui';
import { GraphPaper, PaperCard, StickyNote } from '@/components/ui/notebook';
import { NotebookLoadingRegion } from '@/components/ui/notebook-loading';
import { useNotebookToast } from '@/components/ui/notebook-toast';
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

import styles from './tutor-listings-page.module.css';

import type { ListingPublicationStatus, TeachingListing } from '@/lib/api/types';

type ListingFilter = 'ALL' | ListingPublicationStatus;
type ListingConfirmation = { listingId: string; action: 'archive' | 'publish' };

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
  const toast = useNotebookToast();
  const router = useRouter();
  const copy = language === 'th' ? thaiCopy : englishCopy;
  const [listings, setListings] = useState<TeachingListing[]>([]);
  const [filter, setFilter] = useState<ListingFilter>('ALL');
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmationCandidate, setConfirmationCandidate] = useState<ListingConfirmation | null>(
    null,
  );
  const confirmationDialogRef = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<string | null>(null);
  const tutorProfile = profile ? getTutorProfile(profile) : null;
  const isVerified = tutorProfile?.verificationStatus === 'VERIFIED';
  const listingToConfirm = listings.find(
    (listing) => listing.id === confirmationCandidate?.listingId,
  );

  useEffect(() => {
    const dialog = confirmationDialogRef.current;
    if (!dialog) return;
    if (confirmationCandidate !== null && !dialog.open) dialog.showModal();
    if (confirmationCandidate === null && dialog.open) dialog.close();
  }, [confirmationCandidate]);

  useEffect(() => {
    if (!user || user.role !== 'TUTOR') return;

    let active = true;
    getTutorListings()
      .then((items) => {
        if (!active) return;
        setListings(items);
        setLoadFailed(false);
      })
      .catch(() => {
        if (!active) return;
        setError(copy.loadError);
        setLoadFailed(true);
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

  const requestConfirmation = (listingId: string, action: ListingConfirmation['action']) => {
    setError(null);
    setConfirmationCandidate({ listingId, action });
  };

  const handlePublish = async (listingId: string) => {
    if (!isVerified) {
      setError(copy.actionError);
      toast.error(copy.actionError);
      return;
    }
    setBusyId(listingId);
    setError(null);
    try {
      const updated = await publishTutorListing(listingId);
      setListings((current) => current.map((item) => (item.id === listingId ? updated : item)));
      setConfirmationCandidate(null);
      toast.success(copy.publishedSuccess);
    } catch {
      setError(copy.actionError);
      toast.error(copy.actionError);
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
      toast.success(copy.restoredSuccess);
    } catch {
      setError(copy.actionError);
      toast.error(copy.actionError);
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
      setConfirmationCandidate(null);
      toast.success(copy.archivedSuccess);
    } catch {
      setError(copy.actionError);
      toast.error(copy.actionError);
    } finally {
      setBusyId(null);
    }
  };

  const handleLogout = async () => {
    await logout();
    router.replace('/');
  };

  if (sessionLoading || !user) {
    return <ListingPageState>{copy.loading}</ListingPageState>;
  }

  if (user.role !== 'TUTOR') return null;
  if (profileError || !profileUser || !tutorProfile) {
    return <ListingPageState error>{profileError ?? copy.loadError}</ListingPageState>;
  }

  const statusLabels = {
    DRAFT: copy.draft,
    PUBLISHED: copy.published,
    ARCHIVED: copy.archived,
  };
  const countsAvailable = !isLoading && !loadFailed;
  const isPublishConfirmation = confirmationCandidate?.action === 'publish';
  const confirmationIcon = isPublishConfirmation ? 'check' : 'archive';

  return (
    <DashboardShell user={profileUser} onLogout={handleLogout}>
      <div className={styles.page}>
        <header className="mb-6 mt-7 flex flex-col items-stretch justify-between gap-5 sm:flex-row sm:items-center sm:gap-6">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold tracking-wide text-tutor-deep">{copy.eyebrow}</p>
            <h1 className="mt-2 flex flex-wrap items-center gap-3 text-3xl font-bold tracking-[-0.045em] text-notebook-ink sm:text-4xl">
              <span>{copy.title}</span>
              <span className="inline-flex items-center rounded-full border border-blue-200 bg-sticky-blue px-2.5 py-1 text-xs font-bold tracking-wide text-tutor-deep">
                {copy.tutorRole}
              </span>
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-notebook-muted sm:text-base">
              {copy.subtitle}
            </p>
          </div>
          <Link
            href="/dashboard/listings/new"
            className={listingButtonClass(
              'primary',
              `w-full shrink-0 whitespace-normal sm:w-auto sm:whitespace-nowrap ${styles.newListing} ${styles.primary}`,
            )}
          >
            <ListingIcon name="add" />
            {copy.newListing}
          </Link>
        </header>

        <PaperCard className={styles.summary} aria-label={copy.overviewLabel}>
          <dl className={styles.counts}>
            <div className={styles.metric}>
              <dt>{copy.totalListings}</dt>
              <dd>{countsAvailable ? counts.ALL : '—'}</dd>
            </div>
            <div className={styles.metric}>
              <dt>{copy.published}</dt>
              <dd>{countsAvailable ? counts.PUBLISHED : '—'}</dd>
            </div>
          </dl>
          <div className={styles.nextStep}>
            <p>{copy.nextStep}</p>
            <strong>{countsAvailable ? nextStep : '—'}</strong>
          </div>
        </PaperCard>

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

        <div className="mt-5">
          <div className={styles.toolbar}>
            <div className={styles.filters} role="group" aria-label={copy.filterLabel}>
              {(['ALL', 'PUBLISHED', 'DRAFT', 'ARCHIVED'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFilter(value)}
                  disabled={!countsAvailable}
                  aria-pressed={filter === value}
                  className={styles.filter}
                >
                  {value === 'ALL' ? copy.all : statusLabels[value]}{' '}
                  <span className="tabular-nums text-tutor-deep">
                    {countsAvailable ? counts[value] : '—'}
                  </span>
                </button>
              ))}
            </div>

            <label className={styles.mobileFilter}>
              <span className="sr-only">{copy.filterLabel}</span>
              <select
                value={filter}
                disabled={!countsAvailable}
                onChange={(event) => setFilter(event.target.value as ListingFilter)}
                className="min-h-12 w-full rounded-lg border border-paper-edge bg-paper px-4 text-sm font-bold text-notebook-ink outline-none focus:border-tutor focus:ring-4 focus:ring-sticky-blue/70"
              >
                {(['ALL', 'PUBLISHED', 'DRAFT', 'ARCHIVED'] as const).map((value) => (
                  <option key={value} value={value}>
                    {value === 'ALL' ? copy.all : statusLabels[value]} (
                    {countsAvailable ? counts[value] : '—'})
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.search}>
              <ListingIcon name="search" />
              <span className="sr-only">{copy.searchLabel}</span>
              <input
                type="search"
                disabled={!countsAvailable}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={copy.searchPlaceholder}
                className="min-w-0 w-full bg-transparent text-base text-notebook-ink outline-none placeholder:text-stone-400 sm:text-sm"
              />
            </label>
          </div>

          <div aria-busy={isLoading}>
            {isLoading ? (
              <NotebookLoadingRegion label={copy.loading} />
            ) : loadFailed ? null : visibleListings.length === 0 ? (
              <GraphPaper className="flex flex-col items-center justify-center border-dashed px-5 py-8 text-center">
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
              <PaperCard className={styles.ledger} aria-label={copy.listingsLabel}>
                {visibleListings.map((listing) => (
                  <article
                    key={listing.id}
                    className={styles.row}
                    aria-labelledby={`listing-${listing.id}`}
                  >
                    <div className={styles.rowHeader}>
                      <div className="min-w-0">
                        <p className={styles.grade}>
                          <ListingIcon name="listing" />
                          {listing.gradeLevel.name}
                        </p>
                        <h2 id={`listing-${listing.id}`} className={styles.courseTitle}>
                          {listing.subject.name}
                        </h2>
                      </div>
                      <ListingStatusBadge
                        status={listing.publicationStatus}
                        labels={statusLabels}
                        variant="ledger"
                      />
                    </div>

                    <div className={styles.description}>
                      <p className="line-clamp-2 whitespace-pre-wrap text-sm leading-6 text-notebook-muted sm:line-clamp-1">
                        {listing.description}
                      </p>
                    </div>

                    <div className={styles.rowFooter}>
                      <div className={styles.facts}>
                        <p className={styles.price}>
                          <span className="sr-only">{copy.rate}: </span>
                          {formatPrice(listing.pricePerHour, language)}
                          <span className="ml-1 text-xs font-semibold text-notebook-muted">
                            /{copy.hour}
                          </span>
                        </p>
                        <p className={styles.date}>
                          {listing.publicationStatus === 'PUBLISHED' && listing.publishedAt
                            ? copy.publishedOn
                            : copy.updated}{' '}
                          <time
                            dateTime={
                              listing.publicationStatus === 'PUBLISHED' && listing.publishedAt
                                ? listing.publishedAt
                                : listing.updatedAt
                            }
                          >
                            {formatBangkokShortDate(
                              listing.publicationStatus === 'PUBLISHED' && listing.publishedAt
                                ? listing.publishedAt
                                : listing.updatedAt,
                              language,
                            )}
                          </time>
                        </p>
                      </div>
                      <div className={styles.actions}>
                        <Link
                          href={`/dashboard/listings/${listing.id}/edit`}
                          className={ledgerButtonClass('secondary')}
                        >
                          <ListingIcon name="edit" />
                          {copy.edit}
                        </Link>
                        {listing.publicationStatus === 'DRAFT' && (
                          <button
                            type="button"
                            disabled={busyId === listing.id || !isVerified}
                            id={`publish-trigger-${listing.id}`}
                            aria-haspopup="dialog"
                            aria-controls="listing-confirmation-dialog"
                            onClick={() => requestConfirmation(listing.id, 'publish')}
                            className={ledgerButtonClass('primary')}
                          >
                            {busyId === listing.id ? copy.working : copy.publish}
                          </button>
                        )}
                        {listing.publicationStatus === 'PUBLISHED' && (
                          <button
                            type="button"
                            id={`archive-trigger-${listing.id}`}
                            aria-haspopup="dialog"
                            aria-controls="listing-confirmation-dialog"
                            onClick={() => requestConfirmation(listing.id, 'archive')}
                            className={ledgerButtonClass('secondary', styles.archiveAction)}
                          >
                            <ListingIcon name="archive" />
                            {copy.archive}
                          </button>
                        )}
                        {listing.publicationStatus === 'ARCHIVED' && (
                          <>
                            <button
                              type="button"
                              disabled={busyId === listing.id || !isVerified}
                              onClick={() => void handleRestoreDraft(listing.id)}
                              className={ledgerButtonClass('secondary')}
                            >
                              {busyId === listing.id ? copy.working : copy.restoreDraft}
                            </button>
                            <button
                              type="button"
                              disabled={busyId === listing.id || !isVerified}
                              id={`publish-trigger-${listing.id}`}
                              aria-haspopup="dialog"
                              aria-controls="listing-confirmation-dialog"
                              onClick={() => requestConfirmation(listing.id, 'publish')}
                              className={ledgerButtonClass('primary')}
                            >
                              {busyId === listing.id ? copy.working : copy.publish}
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </article>
                ))}
              </PaperCard>
            )}
          </div>
        </div>
      </div>
      <dialog
        ref={confirmationDialogRef}
        id="listing-confirmation-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="listing-confirmation-title"
        aria-describedby="listing-confirmation-description listing-confirmation-summary"
        aria-busy={busyId !== null}
        className={styles.confirmationDialog}
        data-action={confirmationCandidate?.action}
        onCancel={(event) => {
          if (busyId !== null) event.preventDefault();
        }}
        onClose={() => setConfirmationCandidate(null)}
      >
        <div className={styles.dialogHeader}>
          <span className={styles.dialogIcon} aria-hidden="true">
            <ListingIcon name={confirmationIcon} />
          </span>
          <h2 id="listing-confirmation-title" className={styles.dialogTitle}>
            {isPublishConfirmation ? copy.publishConfirm : copy.archiveConfirm}
          </h2>
        </div>
        <p id="listing-confirmation-description" className={styles.dialogDescription}>
          {isPublishConfirmation ? copy.publishExplanation : copy.archiveExplanation}
        </p>
        <div id="listing-confirmation-summary" className={styles.dialogSummary}>
          <div className={styles.dialogBinding} aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          {listingToConfirm && (
            <div className={styles.dialogCourse}>
              <p className="text-xs text-notebook-muted">{listingToConfirm.gradeLevel.name}</p>
              <h3 className="text-base font-bold [overflow-wrap:anywhere]">
                {listingToConfirm.subject.name}
              </h3>
              <p className="mt-1 text-base font-bold tabular-nums">
                {formatPrice(listingToConfirm.pricePerHour, language)}
                <span className="ml-1 text-xs font-normal text-notebook-muted">/{copy.hour}</span>
              </p>
            </div>
          )}
        </div>
        {error && (
          <p role="alert" className="mt-4 text-sm text-red-700">
            {error}
          </p>
        )}
        <div className={styles.dialogActions}>
          <button
            type="button"
            autoFocus
            disabled={busyId !== null}
            onClick={() => setConfirmationCandidate(null)}
            className={listingButtonClass('secondary', styles.dialogAction)}
          >
            {copy.cancel}
          </button>
          <button
            type="button"
            disabled={busyId !== null || !listingToConfirm}
            onClick={() => {
              if (!listingToConfirm) return;
              if (isPublishConfirmation) {
                void handlePublish(listingToConfirm.id);
              } else {
                void handleArchive(listingToConfirm.id);
              }
            }}
            className={listingButtonClass(
              'primary',
              `${styles.dialogAction} ${styles.dialogConfirm}`,
            )}
          >
            <ListingIcon name={confirmationIcon} />
            {busyId !== null ? copy.working : copy.confirm}
          </button>
        </div>
      </dialog>
    </DashboardShell>
  );
}

function ledgerButtonClass(tone: 'primary' | 'secondary' | 'danger', className = ''): string {
  return listingButtonClass(tone, `${styles.action} ${styles[tone]} ${className}`);
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
  subtitle: 'Manage the subjects, grades, and rates students will see.',
  newListing: 'New listing',
  overviewLabel: 'Listing overview',
  listingsLabel: 'Teaching listings',
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
  publishConfirm: 'Publish this listing?',
  publishExplanation:
    'Students will be able to see this offer. Check the details before confirming.',
  restoreDraft: 'Restore draft',
  archive: 'Archive',
  archiveConfirm: 'Archive this listing?',
  archiveExplanation:
    'Students will no longer see this offer. You can restore it to a draft later.',
  confirm: 'Confirm',
  cancel: 'Cancel',
  working: 'Working…',
  loading: 'Loading your teaching listings…',
  loadError: 'Unable to load your teaching listings.',
  actionError: 'Unable to update this listing. Check your profile status and try again.',
  publishedSuccess: 'Listing published.',
  archivedSuccess: 'Listing archived.',
  restoredSuccess: 'Listing restored to draft.',
};

const thaiCopy: typeof englishCopy = {
  eyebrow: 'ประกาศสอน',
  tutorRole: 'ติวเตอร์',
  title: 'คอร์สสอนของคุณ',
  subtitle: 'จัดการวิชา ระดับชั้น และราคาที่นักเรียนจะเห็น',
  newListing: 'สร้างประกาศใหม่',
  overviewLabel: 'ภาพรวมประกาศสอน',
  listingsLabel: 'รายการประกาศสอน',
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
  publishConfirm: 'เผยแพร่ประกาศนี้?',
  publishExplanation: 'นักเรียนจะเห็นประกาศนี้ ตรวจสอบรายละเอียดก่อนยืนยันการเผยแพร่',
  restoreDraft: 'คืนเป็นฉบับร่าง',
  archive: 'เก็บถาวร',
  archiveConfirm: 'เก็บประกาศนี้ไว้ถาวร?',
  archiveExplanation: 'นักเรียนจะไม่เห็นประกาศนี้ คุณคืนเป็นฉบับร่างได้ภายหลัง',
  confirm: 'ยืนยัน',
  cancel: 'ยกเลิก',
  working: 'กำลังดำเนินการ…',
  loading: 'กำลังโหลดประกาศสอน…',
  loadError: 'ไม่สามารถโหลดประกาศสอนได้',
  actionError: 'ไม่สามารถอัปเดตประกาศนี้ได้ โปรดตรวจสอบสถานะโปรไฟล์แล้วลองอีกครั้ง',
  publishedSuccess: 'เผยแพร่ประกาศแล้ว',
  archivedSuccess: 'เก็บประกาศถาวรแล้ว',
  restoredSuccess: 'คืนประกาศเป็นฉบับร่างแล้ว',
};
