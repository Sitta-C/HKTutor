'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

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
  readListingEditorError,
  validateListingForm,
} from '@/components/listings/tutor-listing-editor-model';
import { GraphPaper, PaperCard, StickyNote, WashiTape } from '@/components/ui/notebook';
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
}

export default function TutorListingEditor({ listingId }: TutorListingEditorProps) {
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
  const [success, setSuccess] = useState<string | null>(null);
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
    setSuccess(null);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void saveListing('save');
  };

  const saveListing = async (action: 'save' | 'publish') => {
    if (action === 'publish' && !isVerified) {
      setPageError(copy.verificationError);
      return;
    }
    const nextErrors = validateListingForm(form, copy);
    setErrors(nextErrors);
    setPageError(null);
    setSuccess(null);
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
      if (!listingId || action === 'publish') {
        router.push('/dashboard/listings');
      } else {
        setForm((current) => ({ ...current, description: payload.description }));
        setSuccess(copy.savedSuccess);
      }
    } catch (caught: unknown) {
      if (!listingId && savedListingId) {
        router.replace(`/dashboard/listings/${savedListingId}/edit`);
      }
      setPageError(readListingEditorError(caught, copy.saveError, copy.notFound));
    } finally {
      setSubmitAction(null);
    }
  };

  const restoreDraft = async () => {
    if (!listingId) return;
    setSubmitAction('restore');
    setPageError(null);
    setSuccess(null);
    try {
      const restoredListing = await updateTutorListingStatus(listingId, 'DRAFT');
      setListing(restoredListing);
      setSuccess(copy.restoredSuccess);
    } catch (caught: unknown) {
      setPageError(readListingEditorError(caught, copy.saveError, copy.notFound));
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
    return <ListingPageState>{copy.loading}</ListingPageState>;
  }
  if (user.role !== 'TUTOR') return null;
  if (profileError || !profile || !profileUser) {
    return <ListingPageState>{profileError ?? pageError ?? copy.loadError}</ListingPageState>;
  }
  if (isLoading) {
    return <ListingPageState>{copy.loading}</ListingPageState>;
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
            <ListingStatusBadge status={status} labels={statusLabels} />
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
        {success && (
          <div
            role="status"
            className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800"
          >
            {success}
          </div>
        )}

        <div className="mt-6 grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,.75fr)]">
          <PaperCard className="min-w-0 overflow-hidden p-0">
            <WashiTape tone="blue" className="-top-2 left-8 rotate-2" />
            <form noValidate onSubmit={handleSubmit}>
              <div className="flex flex-col gap-1 border-b border-dashed border-paper-edge px-5 pb-5 pt-6 sm:flex-row sm:items-start sm:justify-between sm:gap-4 sm:px-6">
                <h2 className="text-lg font-extrabold text-notebook-ink">{copy.detailsTitle}</h2>
                <p className="max-w-[250px] text-xs leading-5 text-notebook-muted sm:text-right">
                  {copy.detailsBody}
                </p>
              </div>

              <StickyNote tone="blue" className="mx-5 mt-5 p-4 sm:mx-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-extrabold text-notebook-ink">{copy.readinessTitle}</p>
                  <span className="text-xs font-bold text-notebook-muted">
                    {completedChecks}/{publishChecks.length} {copy.readyLabel}
                  </span>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {publishChecks.map((check) => (
                    <div
                      key={check.label}
                      className={`flex min-h-10 items-center gap-2 rounded-lg border px-3 text-xs font-bold ${
                        check.complete
                          ? 'border-emerald-200 bg-emerald-50/90 text-emerald-800'
                          : 'border-blue-200 bg-white/75 text-notebook-muted'
                      }`}
                    >
                      <ListingIcon name={check.complete ? 'check' : 'info'} />
                      <span>{check.label}</span>
                    </div>
                  ))}
                </div>
              </StickyNote>

              <div className="grid gap-5 p-5 sm:grid-cols-2 sm:p-6">
                <Field label={copy.subject} error={errors.subjectId} id="listing-subject-error">
                  <select
                    value={form.subjectId}
                    onChange={(event) => updateField('subjectId', event.target.value)}
                    disabled={catalogUnavailable}
                    className={listingFieldClass}
                    aria-invalid={Boolean(errors.subjectId)}
                    aria-describedby={errors.subjectId ? 'listing-subject-error' : undefined}
                  >
                    {!form.subjectId && <option value="">{copy.selectSubject}</option>}
                    {subjects.map((subject) => (
                      <option key={subject.id} value={subject.id}>
                        {subject.name}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label={copy.gradeLevel} error={errors.gradeLevelId} id="listing-grade-error">
                  <select
                    value={form.gradeLevelId}
                    onChange={(event) => updateField('gradeLevelId', event.target.value)}
                    disabled={catalogUnavailable}
                    className={listingFieldClass}
                    aria-invalid={Boolean(errors.gradeLevelId)}
                    aria-describedby={errors.gradeLevelId ? 'listing-grade-error' : undefined}
                  >
                    {!form.gradeLevelId && <option value="">{copy.selectGrade}</option>}
                    {gradeLevels.map((grade) => (
                      <option key={grade.id} value={grade.id}>
                        {grade.name}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label={copy.price} error={errors.pricePerHour} id="listing-price-error">
                  <div className="relative">
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      inputMode="decimal"
                      value={form.pricePerHour}
                      onChange={(event) => updateField('pricePerHour', event.target.value)}
                      placeholder="450"
                      className={`${listingFieldClass} pr-16`}
                      aria-invalid={Boolean(errors.pricePerHour)}
                      aria-describedby={
                        errors.pricePerHour ? 'listing-price-error' : 'listing-price-help'
                      }
                    />
                    <span className="pointer-events-none absolute right-4 top-1/2 mt-1 -translate-y-1/2 text-sm font-bold text-notebook-muted">
                      THB
                    </span>
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

                <StickyNote tone={isVerified ? 'green' : 'yellow'} className="p-4">
                  <p className="text-sm font-extrabold text-notebook-ink">{copy.publishRule}</p>
                  <p className="mt-2 text-xs leading-5 text-notebook-muted">
                    {isVerified ? copy.canPublish : copy.cannotPublish}
                  </p>
                </StickyNote>

                <Field
                  label={copy.description}
                  error={errors.description}
                  id="listing-description-error"
                  className="sm:col-span-2"
                  trailing={`${descriptionLength} / 1000`}
                >
                  <textarea
                    value={form.description}
                    onChange={(event) => updateField('description', event.target.value)}
                    rows={8}
                    maxLength={1000}
                    placeholder={copy.descriptionPlaceholder}
                    className={`${listingFieldClass} min-h-44 resize-y py-3 leading-6`}
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
            <PaperCard className="p-5 sm:p-6">
              <WashiTape tone="blue" className="-top-2 right-8 rotate-3" />
              <div className="flex items-center gap-2.5">
                <span
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-sticky-blue text-tutor-deep"
                  aria-hidden="true"
                >
                  <ListingIcon name="listing" />
                </span>
                <h2 className="text-lg font-extrabold text-notebook-ink">{copy.previewTitle}</h2>
              </div>
              <p className="mb-4 mt-1.5 text-xs leading-5 text-notebook-muted">
                {copy.previewBody}
              </p>
              <GraphPaper className="p-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-tutor-deep text-sm font-black text-white shadow-sm">
                    {profileDisplayName.charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-notebook-ink">
                      {profileDisplayName}
                    </p>
                    <p className="mt-0.5 text-xs text-notebook-muted">
                      {profile?.experienceYears ?? 0} {copy.yearsExperience}
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="inline-flex min-h-7 items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 text-xs font-bold text-emerald-800">
                    <ListingIcon name={isVerified ? 'check' : 'info'} />
                    {isVerified ? copy.verified : copy.verificationPending}
                  </span>
                  <span className="inline-flex min-h-7 items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 text-xs font-bold text-amber-800">
                    <ListingIcon name="star" />
                    {profile?.ratingAverage
                      ? `${profile.ratingAverage} · ${profile.reviewCount} ${copy.reviews}`
                      : copy.noReviews}
                  </span>
                </div>

                <div className="mt-5 border-y border-dashed border-paper-edge py-5">
                  <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-tutor-deep">
                    {selectedSubject?.name || copy.subjectFallback}
                  </p>
                  <h3 className="mt-1 text-xl font-black tracking-[-0.025em] text-notebook-ink">
                    {selectedSubject?.name || copy.subjectFallback} ·{' '}
                    {selectedGrade?.name || copy.gradeFallback}
                  </h3>
                  <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-notebook-muted">
                    {form.description.trim() || copy.descriptionFallback}
                  </p>
                </div>

                <div className="mt-5 flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <strong className="text-2xl font-black tracking-[-0.04em] text-notebook-ink">
                      {form.pricePerHour && Number(form.pricePerHour) > 0
                        ? formatPrice(Number(form.pricePerHour), language)
                        : '—'}
                    </strong>
                    <span className="ml-1 text-sm text-notebook-muted">/{copy.hour}</span>
                  </div>
                  <ListingStatusBadge status={status} labels={statusLabels} />
                </div>
              </GraphPaper>
            </PaperCard>

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
    <label
      className={`flex min-w-0 flex-col gap-1.5 text-sm font-bold text-notebook-ink ${className}`}
    >
      <span className="flex items-center justify-between gap-3">
        <span>{label}</span>
        {trailing && <span className="text-xs font-semibold text-notebook-muted">{trailing}</span>}
      </span>
      {children}
      {error && (
        <span id={id} className="mt-1 block text-xs font-semibold leading-5 text-red-700">
          {error}
        </span>
      )}
    </label>
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
  readinessTitle: 'Publication readiness',
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
  priceHelp: 'Enter Thai baht with up to two decimal places.',
  priceError: 'Enter a price greater than zero with no more than two decimal places.',
  publishRule: 'Publication eligibility',
  canPublish: 'Your verified tutor profile can publish this listing.',
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
  yearsExperience: 'years experience',
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
  readinessTitle: 'ความพร้อมก่อนเผยแพร่',
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
  priceHelp: 'กรอกราคาเป็นเงินบาทและมีทศนิยมได้ไม่เกินสองตำแหน่ง',
  priceError: 'กรุณากรอกราคามากกว่าศูนย์และมีทศนิยมไม่เกินสองตำแหน่ง',
  publishRule: 'สิทธิ์ในการเผยแพร่',
  canPublish: 'โปรไฟล์ติวเตอร์ของคุณผ่านการยืนยันและเผยแพร่ประกาศนี้ได้',
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
  yearsExperience: 'ปีของประสบการณ์',
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
