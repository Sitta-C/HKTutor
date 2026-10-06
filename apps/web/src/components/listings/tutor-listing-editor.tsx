'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { DashboardIcon } from '@/components/dashboard/dashboard-icon';
import DashboardShell from '@/components/dashboard/dashboard-shell';
import {
  ListingIcon,
  ListingPageState,
  ListingStatusBadge,
  listingButtonClass,
  listingFieldClass,
} from '@/components/listings/listing-ui';
import {
  emptyListingForm,
  formatTutorExperience,
  readListingEditorError,
  stepListingPrice,
  validateListingForm,
} from '@/components/listings/tutor-listing-editor-model';
import { OwnProfileAvatar } from '@/components/profile/profile-avatar';
import { PaperCard, StickyNote, WashiTape } from '@/components/ui/notebook';
import { NotebookSelect } from '@/components/ui/notebook-select';
import { useNotebookToast } from '@/components/ui/notebook-toast';
import {
  createTutorListing,
  getListingCatalogs,
  getTutorListing,
  publishTutorListing,
  updateTutorListing,
  updateTutorListingStatus,
} from '@/lib/api/listings';
import { useLanguage } from '@/lib/i18n';
import { getTutorProfile } from '@/lib/profile-navigation';
import { useProfileSession } from '@/lib/use-profile-session';

import styles from './tutor-listing-editor.module.css';

import type {
  ListingFormData,
  ListingFormErrors,
} from '@/components/listings/tutor-listing-editor-model';
import type {
  GradeLevelOption,
  ListingPublicationStatus,
  SaveTeachingListingPayload,
  SubjectOption,
  TeachingListing,
} from '@/lib/api/types';
import type { FormEvent } from 'react';

interface TutorListingEditorProps {
  listingId?: string;
  profileImageUrl?: string | null;
}

export default function TutorListingEditor({
  listingId,
  profileImageUrl = null,
}: TutorListingEditorProps) {
  const {
    isLoading: sessionLoading,
    logout,
    profile: sessionProfile,
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
  const [form, setForm] = useState<ListingFormData>(emptyListingForm);
  const [initialForm, setInitialForm] = useState<ListingFormData>(emptyListingForm);
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [gradeLevels, setGradeLevels] = useState<GradeLevelOption[]>([]);
  const [listing, setListing] = useState<TeachingListing | null>(null);
  const [errors, setErrors] = useState<ListingFormErrors>({});
  const [pageError, setPageError] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [submitAction, setSubmitAction] = useState<'save' | 'publish' | 'restore' | null>(null);

  const profile = sessionProfile ? getTutorProfile(sessionProfile) : null;
  const isEditing = Boolean(listingId);
  const isVerified = profile?.verificationStatus === 'VERIFIED';
  const isArchived = listing?.publicationStatus === 'ARCHIVED';
  const catalogUnavailable = catalogError !== null;
  const createBlocked = !isEditing && catalogUnavailable;
  const isDirty = JSON.stringify(form) !== JSON.stringify(initialForm);

  useEffect(() => {
    if (sessionLoading || profileError || !user || user.role !== 'TUTOR' || !profile) return;

    let active = true;
    Promise.all([
      getListingCatalogs().catch(() => null),
      listingId ? getTutorListing(listingId) : Promise.resolve(null),
    ])
      .then(([catalogs, currentListing]) => {
        if (!active) return;

        let subjectOptions = catalogs?.subjects ?? [];
        let gradeOptions = catalogs?.gradeLevels ?? [];
        if (currentListing) {
          if (!subjectOptions.some((item) => item.id === currentListing.subject.id)) {
            subjectOptions = [...subjectOptions, currentListing.subject];
          }
          if (!gradeOptions.some((item) => item.id === currentListing.gradeLevel.id)) {
            gradeOptions = [...gradeOptions, currentListing.gradeLevel];
          }
        }

        setSubjects(subjectOptions);
        setGradeLevels(gradeOptions);
        setCatalogError(catalogs ? null : copy.catalogUnavailable);
        setListing(currentListing);

        if (currentListing) {
          const loadedForm = {
            subjectId: currentListing.subject.id,
            gradeLevelId: currentListing.gradeLevel.id,
            pricePerHour: String(currentListing.pricePerHour),
            description: currentListing.description,
          };
          setForm(loadedForm);
          setInitialForm(loadedForm);
        }
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setPageError(
          readListingEditorError(caught, copy.loadError, listingId ? copy.notFound : undefined),
        );
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [
    copy.catalogUnavailable,
    copy.loadError,
    copy.notFound,
    listingId,
    profile,
    profileError,
    sessionLoading,
    user,
  ]);

  useEffect(() => {
    if (!isDirty) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
  }, [isDirty]);

  const selectedSubject = useMemo(
    () => subjects.find((subject) => subject.id === form.subjectId),
    [form.subjectId, subjects],
  );
  const selectedGrade = useMemo(
    () => gradeLevels.find((grade) => grade.id === form.gradeLevelId),
    [form.gradeLevelId, gradeLevels],
  );
  const descriptionLength = form.description.trim().length;
  const publishChecks = [
    { complete: Boolean(form.subjectId), label: copy.checkSubject },
    { complete: Boolean(form.gradeLevelId), label: copy.checkGrade },
    {
      complete:
        Boolean(form.pricePerHour) &&
        Number.isFinite(Number(form.pricePerHour)) &&
        Number(form.pricePerHour) > 0 &&
        /^\d+(\.\d{1,2})?$/.test(form.pricePerHour),
      label: copy.checkPrice,
    },
    {
      complete: descriptionLength >= 20 && descriptionLength <= 1000,
      label: copy.checkDescription,
    },
  ];
  const completedChecks = publishChecks.filter((check) => check.complete).length;

  const updateField = <Key extends keyof ListingFormData>(
    key: Key,
    value: ListingFormData[Key],
  ) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void saveListing('save');
  };

  const saveListing = async (action: 'save' | 'publish') => {
    if (action === 'publish' && !isVerified) {
      toast.error(copy.verificationError);
      return;
    }
    const nextErrors = validateListingForm(form, copy);
    setErrors(nextErrors);
    setPageError(null);
    if (Object.keys(nextErrors).length > 0) return;

    const payload: SaveTeachingListingPayload = {
      subjectId: form.subjectId,
      gradeLevelId: form.gradeLevelId,
      pricePerHour: Number(form.pricePerHour),
      description: form.description.trim(),
    };

    setSubmitAction(action);
    let savedListingId = listingId;
    try {
      if (savedListingId) {
        const updated = await updateTutorListing(savedListingId, payload);
        setListing(updated);
      } else {
        savedListingId = await createTutorListing(payload);
      }

      if (action === 'publish') {
        const publishedListing = await publishTutorListing(savedListingId);
        setListing(publishedListing);
      }

      setInitialForm({ ...form, description: payload.description });
      toast.success(copy.savedSuccess);
      if (!listingId || action === 'publish') {
        router.push('/dashboard/listings');
      } else {
        setForm((current) => ({ ...current, description: payload.description }));
      }
    } catch (caught: unknown) {
      if (!listingId && savedListingId) {
        router.replace(`/dashboard/listings/${savedListingId}/edit`);
      }
      toast.error(readListingEditorError(caught, copy.saveError, copy.notFound));
    } finally {
      setSubmitAction(null);
    }
  };

  const restoreDraft = async () => {
    if (!listingId) return;
    setSubmitAction('restore');
    setPageError(null);
    try {
      const restoredListing = await updateTutorListingStatus(listingId, 'DRAFT');
      setListing(restoredListing);
      toast.success(copy.restoredSuccess);
    } catch (caught: unknown) {
      toast.error(readListingEditorError(caught, copy.saveError, copy.notFound));
    } finally {
      setSubmitAction(null);
    }
  };

  const handleCancel = () => {
    if (!isDirty || window.confirm(copy.discardConfirm)) router.push('/dashboard/listings');
  };

  const handleLogout = async () => {
    await logout();
    router.replace('/');
  };

  if (sessionLoading || !user) {
    return (
      <ListingPageState kind={isEditing ? 'listingEdit' : 'listingCreate'}>
        {copy.loading}
      </ListingPageState>
    );
  }
  if (user.role !== 'TUTOR') return null;
  if (profileError || !profile || !profileUser) {
    return <ListingPageState error>{profileError ?? pageError ?? copy.loadError}</ListingPageState>;
  }
  if (isLoading) {
    return (
      <ListingPageState kind={isEditing ? 'listingEdit' : 'listingCreate'}>
        {copy.loading}
      </ListingPageState>
    );
  }

  const status = listing?.publicationStatus ?? 'DRAFT';
  const statusLabels: Record<ListingPublicationStatus, string> = {
    DRAFT: copy.draft,
    PUBLISHED: copy.published,
    ARCHIVED: copy.archived,
  };
  const profileDisplayName = profileUser.displayName?.trim() || profileUser.email;
  return (
    <DashboardShell user={profileUser} onLogout={handleLogout}>
      <div className="min-w-0 pb-12">
        <Link
          href="/dashboard/listings"
          className="mt-1 inline-flex min-h-11 items-center gap-2 text-sm font-bold text-notebook-muted underline decoration-margin-guide decoration-2 underline-offset-4 transition hover:text-notebook-ink"
        >
          <span aria-hidden="true">←</span> {copy.back}
        </Link>
        <header className="mb-6 mt-2">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="font-note text-xl font-semibold leading-none text-amber-700 sm:text-2xl">
                {copy.eyebrow}
              </p>
              <h1 className="mt-2 flex flex-wrap items-center gap-3 text-3xl font-bold tracking-[-0.045em] text-notebook-ink sm:text-4xl">
                <span>{isEditing ? copy.editTitle : copy.createTitle}</span>
                <span className="inline-flex items-center rounded-full border border-blue-200 bg-sticky-blue px-2.5 py-1 text-xs font-bold tracking-wide text-tutor-deep">
                  {copy.tutorRole}
                </span>
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-notebook-muted sm:text-base">
                {copy.subtitle}
              </p>
            </div>
          </div>
        </header>

        {pageError && (
          <div
            role="alert"
            className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700"
          >
            {pageError}
          </div>
        )}
        {catalogError && (
          <div
            role="status"
            className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"
          >
            {catalogError}
          </div>
        )}

        <div className="mt-6 grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,.75fr)]">
          <PaperCard className="min-w-0 overflow-hidden p-0">
            <WashiTape tone="blue" className="-top-2 left-8 rotate-2" />
            <form noValidate onSubmit={handleSubmit}>
              <div className="flex flex-col gap-1 border-b border-dashed border-paper-edge px-5 pb-5 pt-6 sm:flex-row sm:items-start sm:justify-between sm:gap-4 sm:px-6">
                <h2 className="text-lg font-extrabold text-notebook-ink">{copy.detailsTitle}</h2>
                <p className="max-w-[250px] text-xs leading-5 text-notebook-muted sm:text-right">
                  {copy.detailsBody}
                </p>
              </div>

              <div className="grid gap-x-4 gap-y-5 p-5 sm:grid-cols-2 sm:p-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(160px,.85fr)]">
                <Field label={copy.subject} error={errors.subjectId} id="listing-subject-error">
                  <NotebookSelect
                    id="listing-subject"
                    value={form.subjectId}
                    onChange={(event) => updateField('subjectId', event.target.value)}
                    disabled={catalogUnavailable}
                    aria-invalid={Boolean(errors.subjectId)}
                    aria-describedby={errors.subjectId ? 'listing-subject-error' : undefined}
                  >
                    {!form.subjectId && <option value="">{copy.selectSubject}</option>}
                    {subjects.map((subject) => (
                      <option key={subject.id} value={subject.id}>
                        {subject.name}
                      </option>
                    ))}
                  </NotebookSelect>
                </Field>

                <Field label={copy.gradeLevel} error={errors.gradeLevelId} id="listing-grade-error">
                  <NotebookSelect
                    id="listing-grade"
                    value={form.gradeLevelId}
                    onChange={(event) => updateField('gradeLevelId', event.target.value)}
                    disabled={catalogUnavailable}
                    aria-invalid={Boolean(errors.gradeLevelId)}
                    aria-describedby={errors.gradeLevelId ? 'listing-grade-error' : undefined}
                  >
                    {!form.gradeLevelId && <option value="">{copy.selectGrade}</option>}
                    {gradeLevels.map((grade) => (
                      <option key={grade.id} value={grade.id}>
                        {grade.name}
                      </option>
                    ))}
                  </NotebookSelect>
                </Field>

                <Field
                  label={copy.price}
                  error={errors.pricePerHour}
                  id="listing-price-error"
                  className="sm:col-span-2 md:col-span-1"
                >
                  <div className="relative flex min-h-12 items-center rounded-lg border border-paper-edge bg-paper focus-within:border-tutor focus-within:ring-4 focus-within:ring-sticky-blue/70">
                    <input
                      id="listing-price"
                      type="number"
                      min="0.01"
                      step="any"
                      inputMode="decimal"
                      value={form.pricePerHour}
                      onChange={(event) => updateField('pricePerHour', event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                          event.preventDefault();
                          updateField(
                            'pricePerHour',
                            stepListingPrice(form.pricePerHour, event.key === 'ArrowUp' ? 1 : -1),
                          );
                        }
                      }}
                      placeholder="450"
                      className="h-12 min-w-0 w-full rounded-lg bg-transparent pl-3 pr-2 text-base font-medium text-notebook-ink focus-visible:outline-none aria-invalid:outline-2 aria-invalid:outline-red-400 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      aria-invalid={Boolean(errors.pricePerHour)}
                      aria-describedby={
                        errors.pricePerHour ? 'listing-price-error' : 'listing-price-help'
                      }
                    />
                    <span className="pointer-events-none shrink-0 pr-2 text-xs font-semibold text-notebook-muted">
                      {copy.currency}
                    </span>
                    <div className="flex shrink-0 flex-col self-stretch border-l border-paper-edge pointer-coarse:flex-row">
                      <button
                        type="button"
                        aria-label={copy.increasePrice}
                        onClick={() =>
                          updateField('pricePerHour', stepListingPrice(form.pricePerHour, 1))
                        }
                        className="flex flex-1 items-center justify-center rounded-tr-lg px-3 text-tutor-deep hover:bg-sticky-blue focus-visible:outline-2 focus-visible:outline-tutor-deep pointer-coarse:min-h-11 pointer-coarse:min-w-11"
                      >
                        <span aria-hidden="true">+</span>
                      </button>
                      <button
                        type="button"
                        aria-label={copy.decreasePrice}
                        disabled={Boolean(form.pricePerHour) && Number(form.pricePerHour) <= 0.01}
                        onClick={() =>
                          updateField('pricePerHour', stepListingPrice(form.pricePerHour, -1))
                        }
                        className="flex flex-1 items-center justify-center rounded-br-lg border-t border-paper-edge px-3 text-tutor-deep hover:bg-sticky-blue focus-visible:outline-2 focus-visible:outline-tutor-deep disabled:cursor-not-allowed disabled:text-notebook-muted pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:border-l pointer-coarse:border-t-0"
                      >
                        <span aria-hidden="true">−</span>
                      </button>
                    </div>
                  </div>
                  {!errors.pricePerHour && (
                    <p
                      id="listing-price-help"
                      className="mt-2 text-xs leading-5 text-notebook-muted"
                    >
                      {copy.priceHelp}
                    </p>
                  )}
                </Field>

                <Field
                  label={copy.description}
                  error={errors.description}
                  id="listing-description-error"
                  className="sm:col-span-2 md:col-span-3"
                  trailing={`${descriptionLength} / 1000`}
                >
                  <textarea
                    id="listing-description"
                    value={form.description}
                    onChange={(event) => updateField('description', event.target.value)}
                    rows={6}
                    maxLength={1000}
                    placeholder={copy.descriptionPlaceholder}
                    className={`${listingFieldClass} min-h-40 resize-y py-3 leading-6`}
                    aria-invalid={Boolean(errors.description)}
                    aria-describedby={
                      errors.description ? 'listing-description-error' : 'listing-description-help'
                    }
                  />
                  {!errors.description && (
                    <p
                      id="listing-description-help"
                      className="mt-2 text-xs leading-5 text-notebook-muted"
                    >
                      {copy.descriptionHelp}
                    </p>
                  )}
                  <div className="mt-3" aria-label={copy.descriptionProgress}>
                    <div className="h-1.5 overflow-hidden rounded-full bg-paper-edge">
                      <div
                        className={`h-full rounded-full transition-[width] ${
                          descriptionLength < 20 ? 'bg-amber-500' : 'bg-emerald-500'
                        }`}
                        style={{ width: `${Math.min(100, Math.max(0, descriptionLength / 10))}%` }}
                      />
                    </div>
                    <div className="mt-1.5 flex items-center justify-between gap-3 text-xs font-semibold">
                      <span
                        className={descriptionLength < 20 ? 'text-amber-700' : 'text-emerald-700'}
                      >
                        {descriptionLength < 20 ? copy.descriptionTooShort : copy.descriptionGood}
                      </span>
                      <span className="text-notebook-muted">{descriptionLength} / 1000</span>
                    </div>
                  </div>
                </Field>
              </div>

              <div className="mt-1 flex flex-col-reverse gap-3 border-t border-dashed border-paper-edge bg-paper-deep/55 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                <div className="flex items-center gap-2 text-xs font-semibold text-notebook-muted">
                  <span
                    className={`h-2 w-2 rounded-full ${isDirty ? 'bg-amber-500' : 'bg-emerald-500'}`}
                    aria-hidden="true"
                  />
                  {isDirty ? copy.unsaved : copy.upToDate}
                </div>
                <div className="flex flex-col-reverse gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={handleCancel}
                    className={listingButtonClass('secondary', 'w-full sm:w-auto')}
                  >
                    {copy.cancel}
                  </button>
                  <button
                    type="submit"
                    disabled={createBlocked || submitAction !== null}
                    className={listingButtonClass('secondary', 'w-full sm:w-auto')}
                  >
                    {submitAction === 'save'
                      ? copy.saving
                      : isEditing
                        ? copy.saveChanges
                        : copy.saveDraft}
                  </button>
                  {isArchived && (
                    <button
                      type="button"
                      disabled={submitAction !== null}
                      onClick={() => void restoreDraft()}
                      className={listingButtonClass('secondary', 'w-full sm:w-auto')}
                    >
                      {submitAction === 'restore' ? copy.saving : copy.restoreDraft}
                    </button>
                  )}
                  {status !== 'PUBLISHED' && (
                    <button
                      type="button"
                      disabled={createBlocked || !isVerified || submitAction !== null}
                      onClick={() => void saveListing('publish')}
                      className={listingButtonClass('primary', 'w-full sm:w-auto')}
                    >
                      {submitAction === 'publish' ? copy.publishing : copy.publish}
                    </button>
                  )}
                </div>
              </div>
            </form>
          </PaperCard>

          <aside className="min-w-0 xl:sticky xl:top-24 xl:self-start">
            <section className={styles.preview} aria-labelledby="listing-preview-title">
              <header className={styles.previewHeader}>
                <div>
                  <h2 id="listing-preview-title" className="font-note text-lg font-semibold">
                    {copy.previewTitle}
                  </h2>
                  <p className="mt-1 text-xs leading-5 text-notebook-muted">{copy.previewBody}</p>
                </div>
                <ListingStatusBadge status={status} labels={statusLabels} variant="ledger" />
              </header>
              <PaperCard className={styles.previewPaper}>
                <WashiTape tone="blue" className={`${styles.previewTape}`} />
                <div className={styles.previewPerson}>
                  <ListingPreviewAvatar
                    userId={user.id}
                    displayName={profileDisplayName}
                    imageUrl={profileImageUrl}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-notebook-ink">
                      {profileDisplayName}
                    </p>
                    <p className="mt-0.5 text-xs text-notebook-muted">
                      {formatTutorExperience(profile?.experienceYears ?? 0, language)}
                    </p>
                  </div>
                </div>

                <div className={styles.previewTrust}>
                  <span
                    className={`${styles.previewVerification} ${isVerified ? 'text-emerald-800' : 'text-amber-800'}`}
                  >
                    <ListingIcon name={isVerified ? 'check' : 'info'} />
                    {isVerified ? copy.verified : copy.verificationPending}
                  </span>
                  <span className={styles.previewRating}>
                    <ListingIcon name="star" />
                    {profile?.ratingAverage
                      ? `${profile.ratingAverage} · ${profile.reviewCount} ${copy.reviews}`
                      : copy.noReviews}
                  </span>
                </div>

                <div className={styles.previewOffer}>
                  <div className="min-w-0">
                    <p className={styles.previewGrade}>
                      {selectedGrade?.name || copy.gradeFallback}
                    </p>
                    <h3 className={styles.previewSubject}>
                      {selectedSubject?.name || copy.subjectFallback}
                    </h3>
                  </div>
                  <StickyNote tone="yellow" className={styles.previewPrice}>
                    <strong className={styles.previewAmount}>
                      {form.pricePerHour && Number(form.pricePerHour) > 0
                        ? formatPrice(Number(form.pricePerHour), language)
                        : '—'}
                    </strong>
                    <span className={styles.previewUnit}>/ {copy.hour}</span>
                  </StickyNote>
                </div>
                <p
                  className={`${styles.previewDescription} min-w-0 whitespace-pre-wrap break-words text-notebook-muted [overflow-wrap:anywhere]`}
                >
                  {form.description.trim() || copy.descriptionFallback}
                </p>
              </PaperCard>
            </section>

            <StickyNote
              tone="blue"
              className="mt-5 px-5 py-6 sm:px-6"
              role="region"
              aria-labelledby="listing-readiness-title"
            >
              <WashiTape
                tone="blue"
                className="-top-2 left-1/2 max-h-4 max-w-20 -translate-x-1/2"
              />
              <div className="flex items-center justify-between gap-3">
                <h2
                  id="listing-readiness-title"
                  className="font-note text-xl font-semibold text-notebook-ink"
                >
                  {copy.readinessTitle}
                </h2>
                <span
                  className="shrink-0 font-note text-4xl font-semibold leading-none text-tutor-deep"
                  role="status"
                >
                  {completedChecks}/{publishChecks.length}
                  <span className="sr-only"> {copy.readyLabel}</span>
                </span>
              </div>
              <ul className="mt-4">
                {publishChecks.map((check) => (
                  <li
                    key={check.label}
                    className={`flex items-start gap-2.5 border-b border-notebook-ink/10 py-3 text-sm leading-6 ${
                      check.complete ? 'text-notebook-ink' : 'text-notebook-muted'
                    }`}
                  >
                    <span className="mt-0.5 shrink-0">
                      <ListingIcon name={check.complete ? 'check' : 'info'} />
                    </span>
                    <span>{check.label}</span>
                  </li>
                ))}
              </ul>
              <div
                className={`mt-4 flex items-start gap-2.5 text-sm leading-6 ${
                  isVerified ? 'text-emerald-800' : 'text-amber-800'
                }`}
              >
                <DashboardIcon
                  name={isVerified ? 'shield' : 'info'}
                  className="mt-0.5 h-5 w-5 shrink-0"
                />
                <p>{isVerified ? copy.canPublish : copy.cannotPublish}</p>
              </div>
            </StickyNote>

            <StickyNote tone="yellow" className="mt-4 p-4 text-sm leading-6">
              <strong className="block text-notebook-ink">{copy.qualityTitle}</strong>
              <ul className="mt-2 space-y-1.5 text-xs text-notebook-muted">
                <li>• {copy.qualityOne}</li>
                <li>• {copy.qualityTwo}</li>
                <li>• {copy.qualityThree}</li>
              </ul>
            </StickyNote>
          </aside>
        </div>
      </div>
    </DashboardShell>
  );
}

function Field({
  children,
  className = '',
  error,
  id,
  label,
  trailing,
}: {
  children: React.ReactNode;
  className?: string;
  error?: string | undefined;
  id: string;
  label: string;
  trailing?: string;
}) {
  return (
    <div
      className={`flex min-w-0 flex-col gap-1.5 text-sm font-bold text-notebook-ink ${className}`}
    >
      <span className="flex items-center justify-between gap-3">
        <label htmlFor={id.replace('-error', '')}>{label}</label>
        {trailing && <span className="text-xs font-semibold text-notebook-muted">{trailing}</span>}
      </span>
      {children}
      {error && (
        <span id={id} className="mt-1 block text-xs font-semibold leading-5 text-red-700">
          {error}
        </span>
      )}
    </div>
  );
}

function ListingPreviewAvatar({
  displayName,
  imageUrl,
  userId,
}: {
  displayName: string;
  imageUrl?: string | null;
  userId: string;
}) {
  return (
    <OwnProfileAvatar
      userId={userId}
      name={displayName}
      imageUrl={imageUrl}
      fallback={displayName.charAt(0).toUpperCase() || 'T'}
      sizes="44px"
      className="h-11 w-11 border-2 border-paper bg-tutor-deep text-sm font-black text-white shadow-sm ring-1 ring-paper-edge"
    />
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
  eyebrow: 'Teaching listing',
  tutorRole: 'Tutor',
  createTitle: 'Create a clear teaching offer',
  editTitle: 'Edit teaching listing',
  subtitle:
    'One subject, one grade level, a transparent hourly rate, and a useful description are all students need to compare confidently.',
  back: 'Back to listings',
  detailsTitle: 'Course details',
  detailsBody: 'Required fields are saved as a draft until you choose to publish.',
  readinessTitle: 'Before publishing',
  readyLabel: 'ready',
  checkSubject: 'Subject selected',
  checkGrade: 'Grade level selected',
  checkPrice: 'Hourly rate is valid',
  checkDescription: 'Description is ready',
  subject: 'Subject',
  selectSubject: 'Select a subject',
  subjectError: 'Choose a subject.',
  gradeLevel: 'Grade level',
  selectGrade: 'Select a grade level',
  gradeError: 'Choose a grade level.',
  price: 'Price per hour',
  currency: 'THB',
  increasePrice: 'Increase price by 50 baht',
  decreasePrice: 'Decrease price by 50 baht',
  priceHelp: 'Enter Thai baht with up to two decimal places.',
  priceError: 'Enter a price greater than zero with no more than two decimal places.',
  canPublish: 'Profile verified. You can publish this listing.',
  cannotPublish: 'Save this listing as a draft until your tutor profile is verified.',
  description: 'Listing description',
  descriptionPlaceholder:
    'Explain what students will learn, your teaching approach, and who this course suits.',
  descriptionHelp: 'Write 20–1,000 characters. Use specific outcomes and plain language.',
  descriptionError: 'Write between 20 and 1,000 characters after trimming.',
  descriptionProgress: 'Description completeness',
  descriptionTooShort: 'Add a little more detail for students.',
  descriptionGood: 'Clear enough to publish.',
  previewTitle: 'Student preview',
  previewBody: 'This preview updates while you edit.',
  subjectFallback: 'Subject',
  gradeFallback: 'Grade level',
  descriptionFallback: 'Your course description will appear here.',
  verified: 'Verified tutor',
  verificationPending: 'Verification pending',
  reviews: 'reviews',
  noReviews: 'No reviews yet',
  hour: 'hour',
  draft: 'Draft',
  published: 'Published',
  archived: 'Archived',
  saveDraft: 'Save draft',
  saveChanges: 'Save changes',
  publish: 'Save & publish',
  restoreDraft: 'Restore draft',
  restoredSuccess: 'Listing restored to draft.',
  saving: 'Saving…',
  publishing: 'Publishing…',
  cancel: 'Cancel',
  unsaved: 'Unsaved changes',
  upToDate: 'All changes saved',
  savedSuccess: 'Your listing changes have been saved.',
  verificationError: 'Your tutor profile must be verified before publishing.',
  discardConfirm: 'Discard your unsaved changes?',
  qualityTitle: 'A strong listing is easy to scan',
  qualityOne: 'State the learning outcome in the first sentence.',
  qualityTwo: 'Describe your teaching approach with a concrete example.',
  qualityThree: 'Avoid contact details and promises of guaranteed results.',
  loading: 'Loading the listing editor…',
  loadError: 'Unable to load the listing editor.',
  catalogUnavailable:
    'Subject and grade options are temporarily unavailable. You can review this page, but creating a listing requires the catalog service.',
  saveError: 'Unable to save this listing. Check the details and try again.',
  notFound: 'This listing was not found or you do not have access to it.',
};

const thaiCopy: typeof englishCopy = {
  eyebrow: 'ประกาศสอน',
  tutorRole: 'ติวเตอร์',
  createTitle: 'สร้างประกาศสอนที่ชัดเจน',
  editTitle: 'แก้ไขประกาศสอน',
  subtitle:
    'ระบุหนึ่งวิชา หนึ่งระดับชั้น ราคาต่อชั่วโมงที่ชัดเจน และคำอธิบายที่ช่วยให้นักเรียนตัดสินใจได้อย่างมั่นใจ',
  back: 'กลับไปคอร์สของฉัน',
  detailsTitle: 'รายละเอียดคอร์ส',
  detailsBody: 'ข้อมูลที่กรอกจะบันทึกเป็นฉบับร่างจนกว่าคุณจะเลือกเผยแพร่',
  readinessTitle: 'ก่อนเผยแพร่',
  readyLabel: 'รายการพร้อม',
  checkSubject: 'เลือกรายวิชาแล้ว',
  checkGrade: 'เลือกระดับชั้นแล้ว',
  checkPrice: 'ราคาต่อชั่วโมงถูกต้อง',
  checkDescription: 'คำอธิบายพร้อมเผยแพร่',
  subject: 'รายวิชา',
  selectSubject: 'เลือกรายวิชา',
  subjectError: 'กรุณาเลือกรายวิชา',
  gradeLevel: 'ระดับชั้น',
  selectGrade: 'เลือกระดับชั้น',
  gradeError: 'กรุณาเลือกระดับชั้น',
  price: 'ราคาต่อชั่วโมง',
  currency: 'บาท',
  increasePrice: 'เพิ่มราคา 50 บาท',
  decreasePrice: 'ลดราคา 50 บาท',
  priceHelp: 'กรอกราคาเป็นเงินบาทและมีทศนิยมได้ไม่เกินสองตำแหน่ง',
  priceError: 'กรุณากรอกราคามากกว่าศูนย์และมีทศนิยมไม่เกินสองตำแหน่ง',
  canPublish: 'โปรไฟล์ยืนยันแล้ว สามารถเผยแพร่ได้',
  cannotPublish: 'บันทึกประกาศนี้เป็นฉบับร่างได้ และเผยแพร่เมื่อโปรไฟล์ติวเตอร์ผ่านการยืนยันแล้ว',
  description: 'คำอธิบายคอร์ส',
  descriptionPlaceholder: 'อธิบายว่านักเรียนจะได้เรียนรู้อะไร แนวทางการสอน และคอร์สนี้เหมาะกับใคร',
  descriptionHelp: 'เขียน 20–1,000 ตัวอักษร ระบุผลลัพธ์ที่ชัดเจนและใช้ภาษาที่เข้าใจง่าย',
  descriptionError: 'กรุณาเขียนระหว่าง 20 ถึง 1,000 ตัวอักษรหลังตัดช่องว่างหัวท้าย',
  descriptionProgress: 'ความครบถ้วนของคำอธิบาย',
  descriptionTooShort: 'เพิ่มรายละเอียดอีกนิดเพื่อช่วยนักเรียนตัดสินใจ',
  descriptionGood: 'คำอธิบายพร้อมเผยแพร่แล้ว',
  previewTitle: 'ตัวอย่างสำหรับนักเรียน',
  previewBody: 'ตัวอย่างจะเปลี่ยนตามข้อมูลที่คุณกรอก',
  subjectFallback: 'รายวิชา',
  gradeFallback: 'ระดับชั้น',
  descriptionFallback: 'คำอธิบายคอร์สของคุณจะแสดงที่นี่',
  verified: 'ติวเตอร์ยืนยันแล้ว',
  verificationPending: 'รอการยืนยัน',
  reviews: 'รีวิว',
  noReviews: 'ยังไม่มีรีวิว',
  hour: 'ชั่วโมง',
  draft: 'ฉบับร่าง',
  published: 'เผยแพร่แล้ว',
  archived: 'เก็บถาวร',
  saveDraft: 'บันทึกฉบับร่าง',
  saveChanges: 'บันทึกการแก้ไข',
  publish: 'บันทึกและเผยแพร่',
  restoreDraft: 'กู้กลับเป็นฉบับร่าง',
  restoredSuccess: 'กู้ประกาศกลับเป็นฉบับร่างแล้ว',
  saving: 'กำลังบันทึก…',
  publishing: 'กำลังเผยแพร่…',
  cancel: 'ยกเลิก',
  unsaved: 'มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก',
  upToDate: 'บันทึกข้อมูลล่าสุดแล้ว',
  savedSuccess: 'บันทึกการแก้ไขประกาศแล้ว',
  verificationError: 'โปรไฟล์ติวเตอร์ต้องผ่านการยืนยันก่อนจึงจะเผยแพร่ได้',
  discardConfirm: 'ยกเลิกการเปลี่ยนแปลงที่ยังไม่ได้บันทึกหรือไม่?',
  qualityTitle: 'ประกาศที่ดีควรอ่านเข้าใจได้เร็ว',
  qualityOne: 'บอกผลลัพธ์การเรียนรู้ตั้งแต่ประโยคแรก',
  qualityTwo: 'อธิบายแนวทางการสอนพร้อมตัวอย่างที่ชัดเจน',
  qualityThree: 'ไม่ใส่ข้อมูลติดต่อหรือรับประกันผลลัพธ์',
  loading: 'กำลังโหลดตัวแก้ไขประกาศ…',
  loadError: 'ไม่สามารถโหลดตัวแก้ไขประกาศได้',
  catalogUnavailable:
    'ยังไม่สามารถโหลดรายวิชาและระดับชั้นได้ คุณเปิดดูหน้านี้ได้ แต่ต้องรอบริการข้อมูลหลักสูตรก่อนสร้างประกาศ',
  saveError: 'ไม่สามารถบันทึกประกาศได้ โปรดตรวจสอบข้อมูลแล้วลองอีกครั้ง',
  notFound: 'ไม่พบประกาศนี้หรือคุณไม่มีสิทธิ์เข้าถึง',
};
