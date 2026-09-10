'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import DashboardShell from '@/components/dashboard/dashboard-shell';
import PrivacyConsent from '@/components/privacy-consent';
import { ApiError } from '@/lib/api/error';
import {
  acceptCurrentPrivacyNotice,
  getMyProfile,
  saveStudentProfile,
  saveTutorProfile,
} from '@/lib/api/profiles';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/lib/i18n';

import type { TutorProfile } from '@/lib/api/types';
import type { FormEvent, ReactNode } from 'react';

interface ProfileEditorProps {
  mode: 'onboarding' | 'edit';
}

interface StudentFormData {
  firstName: string;
  lastName: string;
  nickname: string;
  school: string;
  gradeLevel: string;
  phone: string;
}

interface TutorFormData {
  firstName: string;
  lastName: string;
  nickname: string;
  displayName: string;
  bio: string;
  experienceYears: string;
}

type ProfileFieldErrors = Partial<Record<keyof StudentFormData | keyof TutorFormData, string>>;

interface ProfileCopy {
  accountEmail: string;
  about: string;
  back: string;
  bio: string;
  bioHint: string;
  bioError: string;
  cancel: string;
  consentRequired: string;
  continue: string;
  displayName: string;
  displayNameHint: string;
  displayNameError: string;
  editEyebrow: string;
  editTitle: string;
  experienceYears: string;
  experienceError: string;
  firstName: string;
  gradeLevel: string;
  lastName: string;
  loadError: string;
  loading: string;
  nickname: string;
  newListing: string;
  noReviews: string;
  onboardingEyebrow: string;
  onboardingTitle: string;
  overview: string;
  phone: string;
  phoneHint: string;
  phoneError: string;
  previewHint: string;
  previewTitle: string;
  profileDetails: string;
  profileDetailsHint: string;
  profileTitle: string;
  profileSubtitle: string;
  created: string;
  lastUpdated: string;
  privacy: string;
  rating: string;
  reviews: string;
  requiredField: string;
  save: string;
  saveError: string;
  saveSuccess: string;
  saving: string;
  school: string;
  signOut: string;
  status: string;
  subtitle: string;
  teaching: string;
  tutor: string;
  verification: string;
  updatedNotice: string;
  years: string;
}

const emptyStudent: StudentFormData = {
  firstName: '',
  gradeLevel: '',
  lastName: '',
  nickname: '',
  phone: '',
  school: '',
};

const emptyTutor: TutorFormData = {
  bio: '',
  displayName: '',
  experienceYears: '',
  firstName: '',
  lastName: '',
  nickname: '',
};

const fieldClass =
  'mt-2 h-12 w-full rounded-xl border border-[#dedbd3] bg-white px-4 text-[#171714] outline-none transition-colors placeholder:text-[#9a968d] focus:border-[#171714] focus:ring-2 focus:ring-[#171714]/10';

export default function ProfileEditor({ mode }: ProfileEditorProps) {
  const { isLoading: authLoading, logout, user } = useAuth();
  const { language } = useLanguage();
  const router = useRouter();
  const [student, setStudent] = useState<StudentFormData>(emptyStudent);
  const [tutor, setTutor] = useState<TutorFormData>(emptyTutor);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [consentCurrent, setConsentCurrent] = useState(true);
  const [acceptedNotice, setAcceptedNotice] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [profileSummary, setProfileSummary] = useState<TutorProfile | null>(null);
  const [fieldErrors, setFieldErrors] = useState<ProfileFieldErrors>({});
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sectionMenuOpen, setSectionMenuOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const copy = language === 'th' ? thaiCopy : englishCopy;

  useEffect(() => {
    if (!sectionMenuOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSectionMenuOpen(false);
    };

    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [sectionMenuOpen]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace('/');
      return;
    }
    if (user.role === 'ADMIN') {
      router.replace('/dashboard');
      return;
    }

    let active = true;
    getMyProfile()
      .then((result) => {
        if (!active) return;
        setConsentCurrent(result.consentCurrent);

        if (user.role === 'STUDENT' && result.profile && 'school' in result.profile) {
          setStudent(result.profile);
        }
        if (user.role === 'TUTOR' && result.profile && 'displayName' in result.profile) {
          setProfileSummary(result.profile);
          setTutor({
            bio: result.profile.bio,
            displayName: result.profile.displayName,
            experienceYears: String(result.profile.experienceYears),
            firstName: result.profile.firstName ?? '',
            lastName: result.profile.lastName ?? '',
            nickname: result.profile.nickname ?? '',
          });
        }

        if (mode === 'onboarding' && result.profileComplete && result.consentCurrent) {
          router.replace('/dashboard');
          return;
        }
        setIsLoading(false);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        if (caught instanceof ApiError && caught.status === 400) {
          setConsentCurrent(false);
          setError(null);
          setIsLoading(false);
          return;
        }
        setError(caught instanceof Error ? caught.message : copy.loadError);
        setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [authLoading, copy.loadError, mode, router, user]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || user.role === 'ADMIN') return;

    if (!consentCurrent && !acceptedNotice) {
      setConsentError(copy.consentRequired);
      return;
    }

    const nextFieldErrors =
      user.role === 'STUDENT' ? validateStudentForm(student, copy) : validateTutorForm(tutor, copy);
    if (Object.keys(nextFieldErrors).length > 0) {
      setFieldErrors(nextFieldErrors);
      window.requestAnimationFrame(() => {
        formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      });
      return;
    }

    setError(null);
    setConsentError(null);
    setFieldErrors({});
    setSaved(false);
    setIsSaving(true);

    try {
      if (!consentCurrent) {
        await acceptCurrentPrivacyNotice();
        const result = await getMyProfile();
        setConsentCurrent(result.consentCurrent);
        setAcceptedNotice(false);

        if (user.role === 'STUDENT' && result.profile && 'school' in result.profile) {
          setStudent(result.profile);
        }
        if (user.role === 'TUTOR' && result.profile && 'displayName' in result.profile) {
          setProfileSummary(result.profile);
          setTutor({
            bio: result.profile.bio,
            displayName: result.profile.displayName,
            experienceYears: String(result.profile.experienceYears),
            firstName: result.profile.firstName ?? '',
            lastName: result.profile.lastName ?? '',
            nickname: result.profile.nickname ?? '',
          });
        }

        if (mode === 'onboarding' && result.profileComplete) router.replace('/dashboard');
        return;
      }

      if (user.role === 'STUDENT') {
        await saveStudentProfile(student);
      } else {
        const updated = await saveTutorProfile({
          ...tutor,
          experienceYears: Number(tutor.experienceYears),
        });
        setProfileSummary(updated);
      }
      if (mode === 'onboarding') router.replace('/dashboard');
      else setSaved(true);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : copy.saveError);
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    router.replace('/');
  };

  const updateStudent = (data: StudentFormData) => {
    setStudent(data);
    setFieldErrors({});
    setSaved(false);
  };

  const updateTutor = (data: TutorFormData) => {
    setTutor(data);
    setFieldErrors({});
    setSaved(false);
  };

  if (authLoading || isLoading || !user) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-[#fbfaf7] p-6">
        <p role="status" className="text-sm font-semibold text-[#5e5a52]">
          {copy.loading}
        </p>
      </main>
    );
  }

  const summaryName =
    user.role === 'TUTOR'
      ? tutor.displayName || user.displayName || user.email.split('@')[0] || 'Tutor'
      : student.nickname || user.displayName || user.email.split('@')[0] || 'Student';
  const summaryInitials = summaryName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
  const verificationStatus = profileSummary?.verificationStatus ?? 'PENDING';
  const verificationLabel =
    verificationStatus === 'VERIFIED'
      ? language === 'th'
        ? 'ยืนยันแล้ว'
        : 'Verified'
      : verificationStatus === 'REJECTED'
        ? language === 'th'
          ? 'ต้องแก้ไขข้อมูล'
          : 'Needs attention'
        : language === 'th'
          ? 'รอตรวจสอบ'
          : 'Pending review';

  return (
    <DashboardShell
      user={user}
      onLogout={handleLogout}
      visualVariant="profile"
      headerNavRight={
        <>
          <Link href="/dashboard">{copy.back}</Link>
          {user.role === 'TUTOR' && (
            <Link href="/dashboard/listings" className="dash-cta">
              + {copy.newListing}
            </Link>
          )}
        </>
      }
    >
      <div className="profile-page">
        <div className="profile-page-head">
          <div>
            <p className="dash-eyebrow">
              {mode === 'onboarding' ? copy.onboardingEyebrow : copy.editEyebrow}
            </p>
            <h1 className="profile-page-title">{copy.profileTitle}</h1>
            <p className="profile-page-subtitle">{copy.profileSubtitle}</p>
          </div>
        </div>

        <div className="profile-section-menu">
          <button
            type="button"
            className="profile-section-menu-trigger"
            aria-expanded={sectionMenuOpen}
            aria-controls="profile-section-menu"
            onClick={() => setSectionMenuOpen((open) => !open)}
          >
            <span className="profile-section-menu-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </span>
            <span>{copy.overview}</span>
            <svg
              className="profile-section-menu-chevron"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="m7 10 5 5 5-5" />
            </svg>
          </button>

          {sectionMenuOpen && (
            <div className="profile-section-menu-popover" id="profile-section-menu" role="menu">
              <a
                href="#overview"
                className="is-active"
                role="menuitem"
                aria-current="page"
                onClick={() => setSectionMenuOpen(false)}
              >
                {copy.overview}
              </a>
              {user.role === 'TUTOR' && (
                <Link
                  href="/dashboard/listings"
                  role="menuitem"
                  onClick={() => setSectionMenuOpen(false)}
                >
                  {copy.teaching}
                </Link>
              )}
              <a href="#privacy" role="menuitem" onClick={() => setSectionMenuOpen(false)}>
                {copy.privacy}
              </a>
            </div>
          )}
        </div>

        <div className="profile-layout" id="overview">
          <aside className="profile-summary-card" aria-label={copy.about}>
            <div className="profile-summary-top">
              <div className="profile-summary-avatar" aria-hidden="true">
                {summaryInitials || 'U'}
              </div>
              <div className="min-w-0">
                <p className="profile-summary-name">{summaryName}</p>
                <p className="profile-summary-role">
                  {user.role === 'TUTOR' ? copy.tutor : language === 'th' ? 'นักเรียน' : 'Student'}
                </p>
              </div>
            </div>

            <div className="profile-summary-section">
              <h2>{copy.about}</h2>
              <div className="profile-summary-list">
                <div className="profile-summary-item">
                  <span className="profile-meta-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
                      <path d="m5 7 7 5 7-5" />
                    </svg>
                  </span>
                  <span>
                    <strong>{copy.accountEmail}</strong>
                    {user.email}
                  </span>
                </div>
                <div className="profile-summary-item">
                  <span className="profile-meta-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <circle cx="12" cy="12" r="8.5" />
                      <path d="m8.5 12 2.3 2.3 4.7-4.7" />
                    </svg>
                  </span>
                  <span>
                    <strong>{copy.verification}</strong>
                    {verificationLabel}
                  </span>
                </div>
                {user.role === 'TUTOR' && (
                  <>
                    <div className="profile-summary-item">
                      <span className="profile-meta-icon" aria-hidden="true">
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                        >
                          <path d="m12 4 2.5 5.1 5.6.8-4 4 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4-4 5.6-.8z" />
                        </svg>
                      </span>
                      <span>
                        <strong>{copy.rating}</strong>
                        {profileSummary?.ratingAverage && profileSummary.reviewCount > 0
                          ? `${profileSummary.ratingAverage} / 5`
                          : copy.noReviews}
                      </span>
                    </div>
                    <div className="profile-summary-item">
                      <span className="profile-meta-icon" aria-hidden="true">
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                        >
                          <path d="M5 6.5h14M5 11.5h14M5 16.5h9" />
                          <circle cx="18" cy="16.5" r="1.5" />
                        </svg>
                      </span>
                      <span>
                        <strong>{copy.reviews}</strong>
                        {profileSummary?.reviewCount ?? 0}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="profile-summary-section">
              <h2>{user.role === 'TUTOR' ? copy.tutor : copy.profileDetails}</h2>
              <p className="mt-3 text-sm leading-6 text-[#5d6c79]">
                {user.role === 'TUTOR'
                  ? copy.previewHint
                  : `${student.school || '—'} · ${student.gradeLevel || '—'}`}
              </p>
            </div>
          </aside>

          <section className="profile-form-card" aria-labelledby="profile-details-title">
            <div className="profile-card-header">
              <div>
                <h2 id="profile-details-title">{copy.profileDetails}</h2>
                <p>{copy.profileDetailsHint}</p>
                {user.role === 'TUTOR' && profileSummary && (
                  <p className="mt-2 text-xs font-semibold text-[#827a72]">
                    {copy.lastUpdated} {formatProfileDate(profileSummary.updatedAt, language)} ·{' '}
                    {copy.created} {formatProfileDate(profileSummary.createdAt, language)}
                  </p>
                )}
              </div>
              {user.role === 'TUTOR' && (
                <span className="profile-status-pill">{verificationLabel}</span>
              )}
            </div>

            {error && (
              <p role="alert" className="mt-4 rounded-lg bg-[#fff0ee] p-3 text-sm text-[#a33f35]">
                {error}
              </p>
            )}
            {saved && (
              <p role="status" className="mt-4 rounded-lg bg-[#e8f7ef] p-3 text-sm text-[#237343]">
                {copy.saveSuccess}
              </p>
            )}

            <form ref={formRef} onSubmit={handleSubmit}>
              {consentCurrent &&
                (user.role === 'STUDENT' ? (
                  <StudentFields
                    data={student}
                    copy={copy}
                    errors={fieldErrors}
                    onChange={updateStudent}
                  />
                ) : (
                  <TutorFields
                    data={tutor}
                    copy={copy}
                    errors={fieldErrors}
                    onChange={updateTutor}
                  />
                ))}

              {!consentCurrent && (
                <div className="rounded-lg border border-[#f1d5ad] bg-[#fff9ef] p-4">
                  <p className="mb-3 text-sm font-semibold text-[#5e5a52]">{copy.updatedNotice}</p>
                  <PrivacyConsent
                    accepted={acceptedNotice}
                    onAcceptedChange={(accepted) => {
                      setAcceptedNotice(accepted);
                      if (accepted) setConsentError(null);
                    }}
                    error={consentError}
                  />
                </div>
              )}

              <div className="profile-actions">
                {mode === 'edit' && (
                  <Link href="/dashboard" className="profile-secondary-action">
                    {copy.cancel}
                  </Link>
                )}
                <button type="submit" disabled={isSaving} className="profile-save-button">
                  {isSaving
                    ? copy.saving
                    : !consentCurrent || mode === 'onboarding'
                      ? copy.continue
                      : copy.save}
                </button>
              </div>
            </form>
          </section>

          {user.role === 'TUTOR' && (
            <aside className="profile-preview-card" aria-label={copy.previewTitle}>
              <h2>{copy.previewTitle}</h2>
              <p className="mt-1 text-sm">{copy.previewHint}</p>
              <div className="profile-preview-box">
                <strong>{tutor.displayName || copy.displayName}</strong>
                <p>{tutor.bio || copy.bio}</p>
                <p>
                  {tutor.experienceYears || '0'} {copy.years} · {verificationLabel}
                </p>
              </div>
            </aside>
          )}
        </div>
      </div>
    </DashboardShell>
  );
}

function StudentFields({
  data,
  copy,
  errors,
  onChange,
}: {
  data: StudentFormData;
  copy: ProfileCopy;
  errors: ProfileFieldErrors;
  onChange: (data: StudentFormData) => void;
}) {
  return (
    <>
      <NameFields data={data} copy={copy} errors={errors} onChange={onChange} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={copy.school} error={errors.school} errorId="profile-school-error">
          <input
            id="profile-school"
            required
            maxLength={160}
            value={data.school}
            onChange={(event) => onChange({ ...data, school: event.target.value })}
            className={fieldClass}
            autoComplete="organization"
            aria-invalid={Boolean(errors.school)}
            aria-describedby={errors.school ? 'profile-school-error' : undefined}
          />
        </Field>
        <Field label={copy.gradeLevel} error={errors.gradeLevel} errorId="profile-grade-error">
          <input
            id="profile-grade"
            required
            maxLength={80}
            value={data.gradeLevel}
            onChange={(event) => onChange({ ...data, gradeLevel: event.target.value })}
            className={fieldClass}
            aria-invalid={Boolean(errors.gradeLevel)}
            aria-describedby={errors.gradeLevel ? 'profile-grade-error' : undefined}
          />
        </Field>
      </div>
      <Field
        label={copy.phone}
        hint={copy.phoneHint}
        error={errors.phone}
        errorId="profile-phone-error"
      >
        <input
          id="profile-phone"
          required
          type="tel"
          minLength={8}
          maxLength={32}
          pattern="[+0-9][0-9 ()-]{7,31}"
          value={data.phone}
          onChange={(event) => onChange({ ...data, phone: event.target.value })}
          className={fieldClass}
          autoComplete="tel"
          aria-invalid={Boolean(errors.phone)}
          aria-describedby={errors.phone ? 'profile-phone-error' : undefined}
        />
      </Field>
    </>
  );
}

function TutorFields({
  data,
  copy,
  errors,
  onChange,
}: {
  data: TutorFormData;
  copy: ProfileCopy;
  errors: ProfileFieldErrors;
  onChange: (data: TutorFormData) => void;
}) {
  return (
    <>
      <NameFields data={data} copy={copy} errors={errors} onChange={onChange} />
      <Field
        label={copy.displayName}
        hint={copy.displayNameHint}
        error={errors.displayName}
        errorId="profile-display-name-error"
      >
        <input
          id="profile-display-name"
          required
          maxLength={100}
          value={data.displayName}
          onChange={(event) => onChange({ ...data, displayName: event.target.value })}
          className={fieldClass}
          aria-invalid={Boolean(errors.displayName)}
          aria-describedby={errors.displayName ? 'profile-display-name-error' : undefined}
        />
      </Field>
      <Field
        label={copy.bio}
        hint={`${copy.bioHint} ${data.bio.trim().length}/2000`}
        error={errors.bio}
        errorId="profile-bio-error"
      >
        <textarea
          id="profile-bio"
          required
          minLength={1}
          maxLength={2000}
          rows={8}
          value={data.bio}
          onChange={(event) => onChange({ ...data, bio: event.target.value })}
          className={`${fieldClass} h-auto py-3`}
          aria-invalid={Boolean(errors.bio)}
          aria-describedby={errors.bio ? 'profile-bio-error' : undefined}
        />
      </Field>
      <Field
        label={copy.experienceYears}
        error={errors.experienceYears}
        errorId="profile-experience-error"
      >
        <input
          id="profile-experience"
          required
          type="number"
          min={0}
          step={1}
          value={data.experienceYears}
          onChange={(event) => onChange({ ...data, experienceYears: event.target.value })}
          className={fieldClass}
          inputMode="numeric"
          aria-invalid={Boolean(errors.experienceYears)}
          aria-describedby={errors.experienceYears ? 'profile-experience-error' : undefined}
        />
      </Field>
    </>
  );
}

function NameFields<T extends Pick<StudentFormData, 'firstName' | 'lastName' | 'nickname'>>({
  data,
  copy,
  errors,
  onChange,
}: {
  data: T;
  copy: ProfileCopy;
  errors: ProfileFieldErrors;
  onChange: (data: T) => void;
}) {
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <Field label={copy.firstName} error={errors.firstName} errorId="profile-first-name-error">
        <input
          id="profile-first-name"
          required
          maxLength={100}
          value={data.firstName}
          onChange={(event) => onChange({ ...data, firstName: event.target.value })}
          className={fieldClass}
          autoComplete="given-name"
          aria-invalid={Boolean(errors.firstName)}
          aria-describedby={errors.firstName ? 'profile-first-name-error' : undefined}
        />
      </Field>
      <Field label={copy.lastName} error={errors.lastName} errorId="profile-last-name-error">
        <input
          id="profile-last-name"
          required
          maxLength={100}
          value={data.lastName}
          onChange={(event) => onChange({ ...data, lastName: event.target.value })}
          className={fieldClass}
          autoComplete="family-name"
          aria-invalid={Boolean(errors.lastName)}
          aria-describedby={errors.lastName ? 'profile-last-name-error' : undefined}
        />
      </Field>
      <Field label={copy.nickname} error={errors.nickname} errorId="profile-nickname-error">
        <input
          id="profile-nickname"
          required
          maxLength={60}
          value={data.nickname}
          onChange={(event) => onChange({ ...data, nickname: event.target.value })}
          className={fieldClass}
          autoComplete="nickname"
          aria-invalid={Boolean(errors.nickname)}
          aria-describedby={errors.nickname ? 'profile-nickname-error' : undefined}
        />
      </Field>
    </div>
  );
}

function Field({
  children,
  error,
  errorId,
  hint,
  label,
}: {
  children: ReactNode;
  error?: string | undefined;
  errorId?: string;
  hint?: string;
  label: string;
}) {
  return (
    <label className="block text-sm font-bold text-[#34332e]">
      {label}
      {hint && (
        <span className="mt-1 block text-xs font-normal leading-5 text-[#77736b]">{hint}</span>
      )}
      {children}
      {error && (
        <span id={errorId} role="alert" className="mt-2 block text-xs font-semibold text-[#b04839]">
          {error}
        </span>
      )}
    </label>
  );
}

function validateStudentForm(data: StudentFormData, copy: ProfileCopy): ProfileFieldErrors {
  const errors: ProfileFieldErrors = {};
  const required = (value: string, field: string, key: keyof ProfileFieldErrors) => {
    if (!value.trim()) errors[key] = copy.requiredField.replace('{field}', field);
  };

  required(data.firstName, copy.firstName, 'firstName');
  required(data.lastName, copy.lastName, 'lastName');
  required(data.nickname, copy.nickname, 'nickname');
  required(data.school, copy.school, 'school');
  required(data.gradeLevel, copy.gradeLevel, 'gradeLevel');
  if (!/^[+0-9][0-9 ()-]{7,31}$/.test(data.phone.trim())) {
    errors.phone = copy.phoneError;
  }
  return errors;
}

function validateTutorForm(data: TutorFormData, copy: ProfileCopy): ProfileFieldErrors {
  const errors: ProfileFieldErrors = {};
  const required = (value: string, field: string, key: keyof ProfileFieldErrors) => {
    if (!value.trim()) errors[key] = copy.requiredField.replace('{field}', field);
  };

  required(data.firstName, copy.firstName, 'firstName');
  required(data.lastName, copy.lastName, 'lastName');
  required(data.nickname, copy.nickname, 'nickname');
  required(data.displayName, copy.displayName, 'displayName');
  if (data.bio.trim().length < 1 || data.bio.trim().length > 2000) {
    errors.bio = copy.bioError;
  }
  if (!/^\d+$/.test(data.experienceYears.trim()) || Number(data.experienceYears) < 0) {
    errors.experienceYears = copy.experienceError;
  }
  return errors;
}

function formatProfileDate(value: string, language: 'en' | 'th') {
  return new Intl.DateTimeFormat(language === 'th' ? 'th-TH' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Bangkok',
  }).format(new Date(value));
}

const englishCopy: ProfileCopy = {
  accountEmail: 'Account email',
  about: 'About',
  back: 'Back to dashboard',
  bio: 'Biography',
  bioHint: '1–2,000 characters.',
  bioError: 'Write between 1 and 2,000 characters.',
  cancel: 'Cancel',
  consentRequired: 'Accept the updated privacy notice before saving your profile.',
  continue: 'Save and continue',
  displayName: 'Public tutor name',
  displayNameHint: 'This is the name students and visitors can see.',
  displayNameError: 'Enter a public tutor name.',
  editEyebrow: 'Account',
  editTitle: 'Edit your profile',
  experienceYears: 'Years of tutoring experience',
  experienceError: 'Enter a whole number of years, zero or more.',
  firstName: 'First name',
  gradeLevel: 'Grade level / class',
  lastName: 'Last name',
  loadError: 'Unable to load your profile.',
  loading: 'Loading profile…',
  nickname: 'Nickname',
  newListing: 'New listing',
  noReviews: 'New tutor',
  onboardingEyebrow: 'One last step',
  onboardingTitle: 'Complete your profile',
  overview: 'Overview',
  phone: 'Emergency telephone number',
  phoneHint:
    'Private. Used by authorised project administrators only for urgent class, safety, or service incidents.',
  phoneError: 'Enter 8–32 valid phone-number characters.',
  previewHint: 'This is the information students can see on your HKTutor profile.',
  previewTitle: 'Student view',
  privacy: 'Privacy',
  profileDetails: 'Profile information',
  profileDetailsHint: 'Keep your public information clear and up to date.',
  profileSubtitle: 'Manage what students see and tell them how you can help.',
  profileTitle: 'Profile',
  created: 'Created',
  lastUpdated: 'Updated',
  rating: 'Rating',
  reviews: 'Reviews',
  requiredField: 'Enter {field}.',
  save: 'Save changes',
  saveError: 'Unable to save your profile.',
  saveSuccess: 'Profile saved successfully.',
  saving: 'Saving…',
  school: 'School',
  signOut: 'Sign out',
  status: 'Status',
  subtitle: 'Keep this information accurate. You can update it later from your dashboard.',
  teaching: 'Teaching listings',
  tutor: 'Tutor',
  updatedNotice: 'The privacy notice has changed because the profile now collects personal data.',
  verification: 'Verification',
  years: 'years experience',
};

const thaiCopy: ProfileCopy = {
  accountEmail: 'อีเมลบัญชี',
  about: 'เกี่ยวกับคุณ',
  back: 'กลับไปแดชบอร์ด',
  bio: 'ประวัติแนะนำตัว',
  bioHint: '1–2,000 ตัวอักษร',
  bioError: 'กรุณาเขียนระหว่าง 1 ถึง 2,000 ตัวอักษร',
  cancel: 'ยกเลิก',
  consentRequired: 'โปรดยอมรับประกาศความเป็นส่วนตัวฉบับล่าสุดก่อนบันทึกโปรไฟล์',
  continue: 'บันทึกและดำเนินการต่อ',
  displayName: 'ชื่อสาธารณะของติวเตอร์',
  displayNameHint: 'นักเรียนและผู้เยี่ยมชมจะมองเห็นชื่อนี้',
  displayNameError: 'กรุณากรอกชื่อสาธารณะของติวเตอร์',
  editEyebrow: 'บัญชี',
  editTitle: 'แก้ไขโปรไฟล์',
  experienceYears: 'จำนวนปีที่มีประสบการณ์สอน',
  experienceError: 'กรุณากรอกจำนวนปีเป็นเลขจำนวนเต็มตั้งแต่ 0 ขึ้นไป',
  firstName: 'ชื่อจริง',
  gradeLevel: 'ชั้นเรียน',
  lastName: 'นามสกุล',
  loadError: 'ไม่สามารถโหลดโปรไฟล์ได้',
  loading: 'กำลังโหลดโปรไฟล์…',
  nickname: 'ชื่อเล่น',
  newListing: 'สร้างประกาศสอน',
  noReviews: 'ติวเตอร์ใหม่',
  onboardingEyebrow: 'ขั้นตอนสุดท้าย',
  onboardingTitle: 'กรอกข้อมูลโปรไฟล์',
  overview: 'ภาพรวม',
  phone: 'เบอร์โทรศัพท์สำหรับกรณีฉุกเฉิน',
  phoneHint:
    'เป็นข้อมูลส่วนตัว ผู้ดูแลโครงการที่ได้รับอนุญาตจะใช้เฉพาะเหตุเร่งด่วนเกี่ยวกับชั้นเรียน ความปลอดภัย หรือการให้บริการ',
  phoneError: 'กรุณากรอกเบอร์โทรศัพท์ที่ถูกต้อง 8–32 ตัวอักษร',
  previewHint: 'ข้อมูลนี้คือสิ่งที่นักเรียนจะเห็นบนโปรไฟล์ HKTutor ของคุณ',
  previewTitle: 'มุมมองนักเรียน',
  privacy: 'ความเป็นส่วนตัว',
  profileDetails: 'ข้อมูลโปรไฟล์',
  profileDetailsHint: 'กรอกข้อมูลที่นักเรียนเข้าใจง่ายและอัปเดตให้เป็นปัจจุบัน',
  profileSubtitle: 'จัดการข้อมูลที่นักเรียนเห็น และบอกให้พวกเขารู้ว่าคุณช่วยอะไรได้บ้าง',
  profileTitle: 'โปรไฟล์',
  created: 'สร้างเมื่อ',
  lastUpdated: 'อัปเดตล่าสุด',
  rating: 'คะแนน',
  reviews: 'รีวิว',
  requiredField: 'กรุณากรอก{field}',
  save: 'บันทึกการเปลี่ยนแปลง',
  saveError: 'ไม่สามารถบันทึกโปรไฟล์ได้',
  saveSuccess: 'บันทึกโปรไฟล์เรียบร้อยแล้ว',
  saving: 'กำลังบันทึก…',
  school: 'โรงเรียน',
  signOut: 'ออกจากระบบ',
  status: 'สถานะ',
  subtitle: 'กรุณากรอกข้อมูลให้ถูกต้อง คุณสามารถกลับมาแก้ไขได้ภายหลังจากแดชบอร์ด',
  teaching: 'ประกาศสอน',
  tutor: 'ติวเตอร์',
  updatedNotice:
    'ประกาศความเป็นส่วนตัวมีการปรับปรุง เนื่องจากโปรไฟล์จะเก็บข้อมูลส่วนบุคคลเพิ่มขึ้น',
  verification: 'การยืนยันตัวตน',
  years: 'ปีที่มีประสบการณ์สอน',
};
