'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import DashboardShell from '@/components/dashboard/dashboard-shell';
import {
  ListingIcon,
  ListingPageState,
  ListingStatusBadge,
  listingFieldClass,
} from '@/components/listings/listing-ui';
import { ApiError } from '@/lib/api/error';
import {
  createTutorListing,
  getListingCatalogs,
  getTutorListing,
  publishTutorListing,
  updateTutorListing,
  updateTutorListingStatus,
} from '@/lib/api/listings';
import { getMyProfile } from '@/lib/api/profiles';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/lib/i18n';

import type {
  GradeLevelOption,
  ListingPublicationStatus,
  SaveTeachingListingPayload,
  SubjectOption,
  TeachingListing,
  TutorProfile,
} from '@/lib/api/types';
import type { FormEvent } from 'react';

interface TutorListingEditorProps {
  listingId?: string;
}

interface ListingFormData {
  subjectId: string;
  gradeLevelId: string;
  pricePerHour: string;
  description: string;
}

type FormErrors = Partial<Record<keyof ListingFormData, string>>;

const emptyForm: ListingFormData = {
  subjectId: '',
  gradeLevelId: '',
  pricePerHour: '',
  description: '',
};

export default function TutorListingEditor({ listingId }: TutorListingEditorProps) {
  const { isLoading: authLoading, logout, user } = useAuth();
  const { language } = useLanguage();
  const router = useRouter();
  const copy = language === 'th' ? thaiCopy : englishCopy;
  const [form, setForm] = useState<ListingFormData>(emptyForm);
  const [initialForm, setInitialForm] = useState<ListingFormData>(emptyForm);
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [gradeLevels, setGradeLevels] = useState<GradeLevelOption[]>([]);
  const [profile, setProfile] = useState<TutorProfile | null>(null);
  const [listing, setListing] = useState<TeachingListing | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [pageError, setPageError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [submitAction, setSubmitAction] = useState<'save' | 'publish' | 'restore' | null>(null);

  const isEditing = Boolean(listingId);
  const isVerified = profile?.verificationStatus === 'VERIFIED';
  const isArchived = listing?.publicationStatus === 'ARCHIVED';
  const isDirty = JSON.stringify(form) !== JSON.stringify(initialForm);

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
    Promise.all([
      getListingCatalogs(),
      getMyProfile(),
      listingId ? getTutorListing(listingId) : Promise.resolve(null),
    ])
      .then(([catalogs, profileResult, currentListing]) => {
        if (!active) return;
        const tutorProfile =
          profileResult.profile && 'verificationStatus' in profileResult.profile
            ? profileResult.profile
            : null;
        if (!tutorProfile) {
          router.replace('/onboarding/profile');
          return;
        }

        let subjectOptions = catalogs.subjects;
        let gradeOptions = catalogs.gradeLevels;
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
        setProfile(tutorProfile);
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
          readEditorError(caught, copy.loadError, listingId ? copy.notFound : undefined),
        );
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [authLoading, copy.loadError, copy.notFound, listingId, router, user]);

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
    const nextErrors = validateForm(form, copy);
    setErrors(nextErrors);
    setPageError(null);
    setSuccess(null);
    if (Object.keys(nextErrors).length > 0) return;

    if (action === 'publish' && !isVerified) {
      setPageError(copy.verificationError);
      return;
    }
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
      setPageError(readEditorError(caught, copy.saveError, copy.notFound));
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
      setPageError(readEditorError(caught, copy.saveError, copy.notFound));
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

  if (authLoading || isLoading || !user) {
    return <ListingPageState>{copy.loading}</ListingPageState>;
  }
  if (user.role !== 'TUTOR') return null;
  if (!profile) {
    return <ListingPageState>{pageError ?? copy.loading}</ListingPageState>;
  }

  const status = listing?.publicationStatus ?? 'DRAFT';
  const statusLabels: Record<ListingPublicationStatus, string> = {
    DRAFT: copy.draft,
    PUBLISHED: copy.published,
    ARCHIVED: copy.archived,
  };
  const profileDisplayName = profile.displayName.trim();
  const shellUser = { ...user, displayName: profileDisplayName };

  return (
    <DashboardShell user={shellUser} onLogout={handleLogout}>
      <div className="listing-page min-w-0 pb-12">
        <Link
          href="/dashboard/listings"
          className="listing-back-link inline-flex min-h-11 items-center gap-2 text-sm font-bold text-[var(--ink-2)] underline decoration-[var(--accent)] underline-offset-4"
        >
          <span aria-hidden="true">←</span> {copy.back}
        </Link>
        <header className="dash-greeting listing-greeting listing-editor-greeting">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="dash-eyebrow">{copy.eyebrow}</p>
              <h1>
                <span>{isEditing ? copy.editTitle : copy.createTitle}</span>
                <span className="dash-role-chip dash-role-chip-tutor">{copy.tutorRole}</span>
              </h1>
              <p>{copy.subtitle}</p>
            </div>
            <ListingStatusBadge status={status} labels={statusLabels} />
          </div>
        </header>

        {pageError && (
          <div
            role="alert"
            className="mt-6 rounded-md border border-[#e2b7ae] bg-[#fff4f1] p-4 text-sm text-[#a34334]"
          >
            {pageError}
          </div>
        )}
        {success && (
          <div
            role="status"
            className="mt-6 rounded-md border border-[#b8decf] bg-[#edf8f3] p-4 text-sm font-bold text-[#246b51]"
          >
            {success}
          </div>
        )}

        <div className="mt-6 grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,.75fr)]">
          <form
            noValidate
            onSubmit={handleSubmit}
            className="listing-form-card profile-form-card dash-card min-w-0"
          >
            <div className="profile-card-head">
              <h2>{copy.detailsTitle}</h2>
              <p>{copy.detailsBody}</p>
            </div>

            <div className="listing-readiness">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-extrabold text-[#42362c]">{copy.readinessTitle}</p>
                <span className="text-xs font-bold text-[#7b736b]">
                  {completedChecks}/{publishChecks.length} {copy.readyLabel}
                </span>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {publishChecks.map((check) => (
                  <div
                    key={check.label}
                    className={`flex min-h-10 items-center gap-2 rounded-md border px-3 text-xs font-bold ${
                      check.complete
                        ? 'border-[#c7dfd3] bg-[#f2faf5] text-[#28654c]'
                        : 'border-[#e7dfd4] bg-white text-[#766d64]'
                    }`}
                  >
                    <ListingIcon name={check.complete ? 'check' : 'info'} />
                    <span>{check.label}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="listing-fields-grid grid gap-5 p-5 sm:grid-cols-2 sm:p-6">
              <Field label={copy.subject} error={errors.subjectId} id="listing-subject-error">
                <select
                  value={form.subjectId}
                  onChange={(event) => updateField('subjectId', event.target.value)}
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
                  <span className="pointer-events-none absolute right-4 top-1/2 mt-1 -translate-y-1/2 text-sm font-bold text-[#746c63]">
                    THB
                  </span>
                </div>
                {!errors.pricePerHour && (
                  <p id="listing-price-help" className="mt-2 text-xs leading-5 text-[#827a72]">
                    {copy.priceHelp}
                  </p>
                )}
              </Field>

              <div className="listing-publish-rule rounded-[0.9rem] border border-[var(--border)] bg-[var(--warn-bg)] p-4">
                <p className="text-sm font-extrabold text-[#42362c]">{copy.publishRule}</p>
                <p className="mt-2 text-xs leading-5 text-[#746b62]">
                  {isVerified ? copy.canPublish : copy.cannotPublish}
                </p>
              </div>

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
                    className="mt-2 text-xs leading-5 text-[#827a72]"
                  >
                    {copy.descriptionHelp}
                  </p>
                )}
                <div className="mt-3" aria-label={copy.descriptionProgress}>
                  <div className="h-1.5 overflow-hidden rounded-full bg-[#eee7dd]">
                    <div
                      className={`h-full rounded-full transition-[width] ${
                        descriptionLength < 20 ? 'bg-[#d18b43]' : 'bg-[#77a88f]'
                      }`}
                      style={{ width: `${Math.min(100, Math.max(0, descriptionLength / 10))}%` }}
                    />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-3 text-xs font-semibold">
                    <span className={descriptionLength < 20 ? 'text-[#a5662d]' : 'text-[#4d8068]'}>
                      {descriptionLength < 20 ? copy.descriptionTooShort : copy.descriptionGood}
                    </span>
                    <span className="text-[#827a72]">{descriptionLength} / 1000</span>
                  </div>
                </div>
              </Field>
            </div>

            <div className="listing-form-actions flex flex-col-reverse gap-3 border-t border-[var(--border)] bg-[#fdfbf7] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#7b736b]">
                <span
                  className={`h-2 w-2 rounded-full ${isDirty ? 'bg-[#d18b43]' : 'bg-[#77a88f]'}`}
                  aria-hidden="true"
                />
                {isDirty ? copy.unsaved : copy.upToDate}
              </div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={handleCancel}
                  className="listing-secondary-action profile-ghost-button min-h-12 rounded-md border border-[#d9d2c6] bg-white px-4 text-sm font-extrabold text-[#544a41] transition hover:bg-[#f7f2ea]"
                >
                  {copy.cancel}
                </button>
                <button
                  type="submit"
                  disabled={submitAction !== null}
                  className="listing-secondary-action profile-ghost-button min-h-12 rounded-md border border-[#3b3027] bg-white px-4 text-sm font-extrabold text-[#34271e] transition hover:bg-[#f4eee6] disabled:cursor-wait disabled:opacity-50"
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
                    className="listing-secondary-action profile-ghost-button min-h-12 rounded-md border border-[#d9d2c6] bg-white px-4 text-sm font-extrabold text-[#34271e] transition hover:bg-[#f4eee6] disabled:cursor-wait disabled:opacity-50"
                  >
                    {submitAction === 'restore' ? copy.saving : copy.restoreDraft}
                  </button>
                )}
                {status !== 'PUBLISHED' && (
                  <button
                    type="button"
                    disabled={!isVerified || submitAction !== null}
                    onClick={() => void saveListing('publish')}
                    className="listing-primary-action profile-primary-button min-h-12 rounded-md bg-[#34271e] px-5 text-sm font-extrabold text-white shadow-[0_8px_18px_-10px_rgba(43,31,22,0.85)] transition hover:-translate-y-0.5 hover:bg-[#4b3729] disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-45"
                  >
                    {submitAction === 'publish' ? copy.publishing : copy.publish}
                  </button>
                )}
              </div>
            </div>
          </form>

          <aside className="listing-preview-wrap min-w-0 xl:sticky xl:top-5 xl:self-start">
            <section className="listing-preview-card profile-preview-card dash-card">
              <div className="profile-preview-title">
                <span aria-hidden="true">
                  <ListingIcon name="listing" />
                </span>
                <h2>{copy.previewTitle}</h2>
              </div>
              <p className="profile-preview-subtitle">{copy.previewBody}</p>
              <div className="listing-preview-content">
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-[#ffc57d] to-[#d18b43] text-sm font-black text-[#2f2117]">
                    {profileDisplayName.charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-[#30251d]">
                      {profileDisplayName}
                    </p>
                    <p className="mt-0.5 text-xs text-[#7a7269]">
                      {profile?.experienceYears ?? 0} {copy.yearsExperience}
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="inline-flex min-h-7 items-center gap-1.5 rounded-md border border-[#d9e8df] bg-[#f1faf4] px-2.5 text-xs font-bold text-[#28654c]">
                    <ListingIcon name={isVerified ? 'check' : 'info'} />
                    {isVerified ? copy.verified : copy.verificationPending}
                  </span>
                  <span className="inline-flex min-h-7 items-center gap-1.5 rounded-md border border-[#e8dfd2] bg-[#fbf7f0] px-2.5 text-xs font-bold text-[#6c5b4b]">
                    <ListingIcon name="star" />
                    {profile?.ratingAverage
                      ? `${profile.ratingAverage} · ${profile.reviewCount} ${copy.reviews}`
                      : copy.noReviews}
                  </span>
                </div>

                <div className="mt-5 border-y border-[#ebe6dd] py-5">
                  <p className="text-xs font-extrabold uppercase tracking-[0.14em] text-[#b87434]">
                    {selectedSubject?.name || copy.subjectFallback}
                  </p>
                  <h3 className="mt-1 text-xl font-black tracking-[-0.025em] text-[#241a14]">
                    {selectedSubject?.name || copy.subjectFallback} ·{' '}
                    {selectedGrade?.name || copy.gradeFallback}
                  </h3>
                  <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-[#696158]">
                    {form.description.trim() || copy.descriptionFallback}
                  </p>
                </div>

                <div className="mt-5 flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <strong className="text-2xl font-black tracking-[-0.04em] text-[#241a14]">
                      {form.pricePerHour && Number(form.pricePerHour) > 0
                        ? formatPrice(Number(form.pricePerHour), language)
                        : '—'}
                    </strong>
                    <span className="ml-1 text-sm text-[#6c655d]">/{copy.hour}</span>
                  </div>
                  <ListingStatusBadge status={status} labels={statusLabels} />
                </div>
              </div>
            </section>

            <section className="mt-4 rounded-md border border-[#e8c99f] bg-[#fff8ed] p-4 text-sm leading-6 text-[#775026]">
              <strong className="block text-[#553719]">{copy.qualityTitle}</strong>
              <ul className="mt-2 space-y-1.5 text-xs">
                <li>• {copy.qualityOne}</li>
                <li>• {copy.qualityTwo}</li>
                <li>• {copy.qualityThree}</li>
              </ul>
            </section>
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
    <label className={`listing-field ${error ? 'listing-field-invalid' : ''} ${className}`}>
      <span className="flex items-center justify-between gap-3">
        <span>{label}</span>
        {trailing && <span className="text-xs font-semibold text-[#8a8178]">{trailing}</span>}
      </span>
      {children}
      {error && (
        <span id={id} className="mt-2 block text-xs font-semibold leading-5 text-[#b04839]">
          {error}
        </span>
      )}
    </label>
  );
}

function validateForm(form: ListingFormData, copy: typeof englishCopy): FormErrors {
  const errors: FormErrors = {};
  const price = Number(form.pricePerHour);
  if (!form.subjectId) errors.subjectId = copy.subjectError;
  if (!form.gradeLevelId) errors.gradeLevelId = copy.gradeError;
  if (
    !form.pricePerHour ||
    !Number.isFinite(price) ||
    price <= 0 ||
    !/^\d+(\.\d{1,2})?$/.test(form.pricePerHour)
  ) {
    errors.pricePerHour = copy.priceError;
  }
  const descriptionLength = form.description.trim().length;
  if (descriptionLength < 20 || descriptionLength > 1000) {
    errors.description = copy.descriptionError;
  }
  return errors;
}

function readEditorError(error: unknown, fallback: string, notFound?: string) {
  if (error instanceof ApiError && error.status === 404) return notFound ?? fallback;
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
  cannotPublish: 'Save a draft now. Publishing unlocks after tutor verification.',
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
  verificationError: 'Your tutor profile must be verified before this listing can be published.',
  discardConfirm: 'Discard your unsaved changes?',
  qualityTitle: 'A strong listing is easy to scan',
  qualityOne: 'State the learning outcome in the first sentence.',
  qualityTwo: 'Describe your teaching approach with a concrete example.',
  qualityThree: 'Avoid contact details and promises of guaranteed results.',
  loading: 'Loading the listing editor…',
  loadError: 'Unable to load the listing editor.',
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
  cannotPublish: 'บันทึกฉบับร่างได้ทันที การเผยแพร่จะเปิดเมื่อโปรไฟล์ผ่านการยืนยัน',
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
  verificationError: 'โปรไฟล์ติวเตอร์ต้องผ่านการยืนยันก่อนเผยแพร่ประกาศ',
  discardConfirm: 'ยกเลิกการเปลี่ยนแปลงที่ยังไม่ได้บันทึกหรือไม่?',
  qualityTitle: 'ประกาศที่ดีควรอ่านเข้าใจได้เร็ว',
  qualityOne: 'บอกผลลัพธ์การเรียนรู้ตั้งแต่ประโยคแรก',
  qualityTwo: 'อธิบายแนวทางการสอนพร้อมตัวอย่างที่ชัดเจน',
  qualityThree: 'ไม่ใส่ข้อมูลติดต่อหรือรับประกันผลลัพธ์',
  loading: 'กำลังโหลดตัวแก้ไขประกาศ…',
  loadError: 'ไม่สามารถโหลดตัวแก้ไขประกาศได้',
  saveError: 'ไม่สามารถบันทึกประกาศได้ โปรดตรวจสอบข้อมูลแล้วลองอีกครั้ง',
  notFound: 'ไม่พบประกาศนี้หรือคุณไม่มีสิทธิ์เข้าถึง',
};
