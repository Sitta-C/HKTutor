'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { DashboardIcon, type DashboardIconName } from '@/components/dashboard/dashboard-icon';
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

import type { AuthUser, StudentProfile, TutorProfile } from '@/lib/api/types';
import type { FormEvent, InputHTMLAttributes, ReactNode } from 'react';

interface ProfileEditorProps {
  mode: 'onboarding' | 'edit';
}

type StudentForm = StudentProfile;
interface TutorForm {
  bio: string;
  displayName: string;
  experienceYears: string;
  firstName: string;
  lastName: string;
  nickname: string;
}
type FieldName = keyof StudentForm | keyof TutorForm;
type FieldErrors = Partial<Record<FieldName, string>>;

const emptyStudent: StudentForm = {
  firstName: '',
  gradeLevel: '',
  lastName: '',
  nickname: '',
  phone: '',
  school: '',
};
const emptyTutor: TutorForm = {
  bio: '',
  displayName: '',
  experienceYears: '',
  firstName: '',
  lastName: '',
  nickname: '',
};
const emptyTutorMeta = {
  ratingAverage: null,
  reviewCount: 0,
  verificationStatus: 'PENDING',
} satisfies Pick<TutorProfile, 'ratingAverage' | 'reviewCount' | 'verificationStatus'>;
const phonePattern = /^[+0-9][0-9 ()-]{7,31}$/;
const fields: FieldName[] = [
  'firstName',
  'lastName',
  'nickname',
  'school',
  'gradeLevel',
  'phone',
  'displayName',
  'bio',
  'experienceYears',
];

export default function ProfileEditor({ mode }: ProfileEditorProps) {
  const { isLoading: authLoading, logout, user } = useAuth();
  const { language } = useLanguage();
  const router = useRouter();
  const text = copy[language];
  const [student, setStudent] = useState<StudentForm>(emptyStudent);
  const [initialStudent, setInitialStudent] = useState<StudentForm>(emptyStudent);
  const [tutor, setTutor] = useState<TutorForm>(emptyTutor);
  const [initialTutor, setInitialTutor] = useState<TutorForm>(emptyTutor);
  const [tutorMeta, setTutorMeta] =
    useState<Pick<TutorProfile, 'ratingAverage' | 'reviewCount' | 'verificationStatus'>>(
      emptyTutorMeta,
    );
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [consentCurrent, setConsentCurrent] = useState(true);
  const [acceptedNotice, setAcceptedNotice] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

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
          setInitialStudent(result.profile);
        }
        if (user.role === 'TUTOR' && result.profile && 'displayName' in result.profile) {
          const form = toTutorForm(result.profile);
          setTutor(form);
          setInitialTutor(form);
          setTutorMeta(result.profile);
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
        } else {
          setError(caught instanceof Error ? caught.message : text.loadError);
        }
        setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [authLoading, mode, router, text.loadError, user]);

  const studentRole = user?.role === 'STUDENT';
  const dirty = studentRole
    ? JSON.stringify(student) !== JSON.stringify(initialStudent)
    : JSON.stringify(tutor) !== JSON.stringify(initialTutor);

  const clearFieldError = (field: FieldName) => {
    setSaved(false);
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || user.role === 'ADMIN') return;

    if (!consentCurrent) {
      if (!acceptedNotice) {
        setConsentError(text.consentRequired);
        return;
      }
      setIsSaving(true);
      try {
        await acceptCurrentPrivacyNotice();
        const result = await getMyProfile();
        setConsentCurrent(result.consentCurrent);
        setAcceptedNotice(false);
        setConsentError(null);

        if (user.role === 'STUDENT' && result.profile && 'school' in result.profile) {
          setStudent(result.profile);
          setInitialStudent(result.profile);
        }
        if (user.role === 'TUTOR' && result.profile && 'displayName' in result.profile) {
          const form = toTutorForm(result.profile);
          setTutor(form);
          setInitialTutor(form);
          setTutorMeta(result.profile);
        }

        if (mode === 'onboarding' && result.profileComplete) router.replace('/dashboard');
      } catch (caught: unknown) {
        setError(caught instanceof Error ? caught.message : text.saveError);
      } finally {
        setIsSaving(false);
      }
      return;
    }

    const validationErrors = studentRole
      ? validateStudent(student, language)
      : validateTutor(tutor, language);
    if (Object.keys(validationErrors).length) {
      setFieldErrors(validationErrors);
      focusFirstError(validationErrors);
      return;
    }

    setError(null);
    setFieldErrors({});
    setSaved(false);
    setIsSaving(true);
    try {
      if (user.role === 'STUDENT') {
        const result = await saveStudentProfile(trimForm(student));
        setStudent(result);
        setInitialStudent(result);
      } else {
        const normalized = trimForm(tutor);
        const result = await saveTutorProfile({
          ...normalized,
          experienceYears: Number(normalized.experienceYears),
        });
        const form = toTutorForm(result);
        setTutor(form);
        setInitialTutor(form);
        setTutorMeta(result);
      }
      if (mode === 'onboarding') router.replace('/dashboard');
      else setSaved(true);
    } catch (caught: unknown) {
      const apiErrors = apiFieldErrors(caught);
      setFieldErrors(apiErrors);
      if (Object.keys(apiErrors).length) focusFirstError(apiErrors);
      setError(caught instanceof Error ? caught.message : text.saveError);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    if (studentRole) setStudent(initialStudent);
    else setTutor(initialTutor);
    setFieldErrors({});
    setError(null);
    setSaved(false);
  };
  const handleLogout = async () => {
    await logout();
    router.replace('/');
  };

  if (authLoading || isLoading || !user) return <Loading label={text.loading} />;

  const shellName = studentRole ? student.nickname.trim() : tutor.nickname.trim();
  const shellUser: AuthUser = shellName ? { ...user, displayName: shellName } : { ...user };
  const headerNav =
    mode === 'edit' ? (
      <Link href="/dashboard" className="dash-cta">
        {text.back}
      </Link>
    ) : (
      <button className="profile-header-button" type="button" onClick={() => void handleLogout()}>
        {text.signOut}
      </button>
    );

  return (
    <DashboardShell user={shellUser} onLogout={handleLogout} headerNavRight={headerNav}>
      <div className="dash-greeting">
        <p className="dash-eyebrow">{mode === 'onboarding' ? text.lastStep : text.account}</p>
        <h1>
          <span>{studentRole ? text.studentTitle : text.tutorTitle}</span>
          <span
            className={`dash-role-chip ${studentRole ? 'dash-role-chip-student' : 'dash-role-chip-tutor'}`}
          >
            {studentRole ? text.student : text.tutor}
          </span>
        </h1>
        <p>
          {mode === 'onboarding'
            ? text.onboardingBody
            : studentRole
              ? text.studentSubtitle
              : text.tutorSubtitle}
        </p>
      </div>

      {!consentCurrent ? (
        <form className="dash-card profile-consent-card" onSubmit={handleSubmit}>
          {error && <Alert>{error}</Alert>}
          <p>{text.updatedNotice}</p>
          <PrivacyConsent
            accepted={acceptedNotice}
            onAcceptedChange={(accepted) => {
              setAcceptedNotice(accepted);
              if (accepted) setConsentError(null);
            }}
            error={consentError}
          />
          <button className="profile-primary-button" disabled={isSaving} type="submit">
            {isSaving ? text.saving : text.continue}
          </button>
        </form>
      ) : (
        <div className="profile-grid">
          <form className="dash-card profile-form-card" noValidate onSubmit={handleSubmit}>
            <div className="profile-card-head">
              <h2>{text.profileInformation}</h2>
              <p>{studentRole ? text.allRequired : text.tutorVisibility}</p>
            </div>
            {mode === 'onboarding' && (
              <div className={`profile-onboarding-note ${studentRole ? 'student' : 'tutor'}`}>
                <span className="profile-inline-icon" aria-hidden="true">
                  <DashboardIcon name="check" className="h-4 w-4" />
                </span>
                <p>{text.onboardingBody}</p>
              </div>
            )}
            {error && <Alert>{error}</Alert>}
            {studentRole ? (
              <StudentFields
                data={student}
                errors={fieldErrors}
                language={language}
                onChange={(field, value) => {
                  setStudent((current) => ({ ...current, [field]: value }));
                  clearFieldError(field);
                }}
              />
            ) : (
              <TutorFields
                data={tutor}
                errors={fieldErrors}
                language={language}
                onChange={(field, value) => {
                  setTutor((current) => ({ ...current, [field]: value }));
                  clearFieldError(field);
                }}
              />
            )}

            <SystemInfo
              email={user.email}
              language={language}
              student={studentRole}
              complete={studentRole ? studentComplete(student) : tutorComplete(tutor)}
              tutorMeta={tutorMeta}
            />
            {!studentRole && (
              <p className="profile-listing-note">
                {text.listingNote} <Link href="/dashboard#listings">{text.myListings}</Link>.
              </p>
            )}
            <div className="profile-form-actions">
              <button className="profile-primary-button" disabled={isSaving} type="submit">
                {isSaving ? text.saving : mode === 'onboarding' ? text.continue : text.save}
              </button>
              <button
                className="profile-ghost-button"
                disabled={!dirty || isSaving}
                onClick={handleCancel}
                type="button"
              >
                {text.cancel}
              </button>
              {dirty && <span className="profile-dirty">{text.unsaved}</span>}
              {saved && (
                <span className="profile-saved">
                  <DashboardIcon name="check" className="h-3.5 w-3.5" />
                  {text.saved}
                </span>
              )}
            </div>
          </form>
          {studentRole ? (
            <StudentSummary data={student} language={language} />
          ) : (
            <TutorPreview data={tutor} language={language} status={tutorMeta.verificationStatus} />
          )}
        </div>
      )}
      {saved && (
        <div className="profile-toast" role="status" aria-live="polite">
          <DashboardIcon name="check" className="h-4 w-4" />
          {text.saved}
        </div>
      )}
    </DashboardShell>
  );
}

function StudentFields({
  data,
  errors,
  language,
  onChange,
}: {
  data: StudentForm;
  errors: FieldErrors;
  language: 'en' | 'th';
  onChange: (field: keyof StudentForm, value: string) => void;
}) {
  const text = copy[language];
  return (
    <div className="profile-fields">
      <Section title={text.identity} hint={text.ownerOnly} />
      <TextField
        id="firstName"
        label={text.firstName}
        value={data.firstName}
        maxLength={100}
        autoComplete="given-name"
        error={errors.firstName}
        onChange={onChange}
      />
      <TextField
        id="lastName"
        label={text.lastName}
        value={data.lastName}
        maxLength={100}
        autoComplete="family-name"
        error={errors.lastName}
        onChange={onChange}
      />
      <TextField
        id="nickname"
        label={text.nickname}
        value={data.nickname}
        maxLength={60}
        autoComplete="nickname"
        hint={text.studentNicknameHint}
        error={errors.nickname}
        onChange={onChange}
      />
      <Section title={text.learningInformation} hint={text.privateProfile} />
      <TextField
        id="school"
        label={text.school}
        value={data.school}
        maxLength={160}
        autoComplete="organization"
        error={errors.school}
        onChange={onChange}
      />
      <TextField
        id="gradeLevel"
        label={text.gradeLevel}
        value={data.gradeLevel}
        maxLength={80}
        error={errors.gradeLevel}
        onChange={onChange}
      />
      <TextField
        id="phone"
        label={text.phone}
        value={data.phone}
        type="tel"
        minLength={8}
        maxLength={32}
        autoComplete="tel"
        hint={text.phoneHint}
        error={errors.phone}
        full
        onChange={onChange}
      />
    </div>
  );
}

function TutorFields({
  data,
  errors,
  language,
  onChange,
}: {
  data: TutorForm;
  errors: FieldErrors;
  language: 'en' | 'th';
  onChange: (field: keyof TutorForm, value: string) => void;
}) {
  const text = copy[language];
  return (
    <div className="profile-fields">
      <Section title={text.privateIdentity} hint={text.privateIdentityHint} />
      <TextField
        id="firstName"
        label={text.firstName}
        value={data.firstName ?? ''}
        maxLength={100}
        autoComplete="given-name"
        error={errors.firstName}
        onChange={onChange}
      />
      <TextField
        id="lastName"
        label={text.lastName}
        value={data.lastName ?? ''}
        maxLength={100}
        autoComplete="family-name"
        error={errors.lastName}
        onChange={onChange}
      />
      <TextField
        id="nickname"
        label={text.nickname}
        value={data.nickname ?? ''}
        maxLength={60}
        autoComplete="nickname"
        hint={text.nicknameHint}
        error={errors.nickname}
        onChange={onChange}
      />
      <Section title={text.publicProfile} hint={text.shownToStudents} />
      <TextField
        id="displayName"
        label={text.displayName}
        value={data.displayName}
        maxLength={100}
        hint={text.displayNameHint}
        error={errors.displayName}
        onChange={onChange}
      />
      <TextField
        id="experienceYears"
        label={text.experience}
        value={data.experienceYears}
        type="number"
        min={0}
        step={1}
        inputMode="numeric"
        hint={text.experienceHint}
        error={errors.experienceYears}
        onChange={onChange}
      />
      <Field
        id="bio"
        label={text.bio}
        hint={text.bioHint}
        error={errors.bio}
        count={`${data.bio.length} / 2000`}
        full
      >
        <textarea
          id="bio"
          rows={6}
          maxLength={2000}
          value={data.bio}
          aria-invalid={Boolean(errors.bio)}
          aria-describedby={descriptionId('bio', errors.bio, text.bioHint)}
          onChange={(event) => onChange('bio', event.target.value)}
        />
      </Field>
    </div>
  );
}

function TextField<T extends FieldName>({
  id,
  label,
  value,
  hint,
  error,
  full,
  onChange,
  ...props
}: {
  id: T;
  label: string;
  value: string;
  hint?: string | undefined;
  error?: string | undefined;
  full?: boolean | undefined;
  onChange: (field: T, value: string) => void;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'onChange' | 'value'>) {
  return (
    <Field id={id} label={label} hint={hint} error={error} full={full}>
      <input
        {...props}
        id={id}
        value={value}
        aria-invalid={Boolean(error)}
        aria-describedby={descriptionId(id, error, hint)}
        onChange={(event) => onChange(id, event.target.value)}
      />
    </Field>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  full,
  count,
  children,
}: {
  id: FieldName;
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  full?: boolean | undefined;
  count?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className={`profile-field ${full ? 'full' : ''} ${error ? 'invalid' : ''}`}>
      <div className="profile-label-row">
        <label htmlFor={id}>{label}</label>
        {count && <span>{count}</span>}
      </div>
      {children}
      {hint && !error && (
        <p className="profile-help" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {error && (
        <p className="profile-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function Section({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="profile-section-label">
      <strong>{title}</strong>
      <span>{hint}</span>
    </div>
  );
}

function SystemInfo({
  email,
  language,
  student,
  complete,
  tutorMeta,
}: {
  email: string;
  language: 'en' | 'th';
  student: boolean;
  complete: boolean;
  tutorMeta: Pick<TutorProfile, 'ratingAverage' | 'reviewCount' | 'verificationStatus'>;
}) {
  const text = copy[language];
  return (
    <div
      className={`profile-system-info ${student ? 'student' : 'tutor'}`}
      aria-label={text.profileStatus}
    >
      <ReadOnly label={text.accountEmail} value={email} />
      {student ? (
        <>
          <ReadOnly
            label={text.profileStatus}
            value={complete ? text.complete : text.incomplete}
            status={complete}
            statusIcon={complete ? 'check' : 'info'}
          />
          <ReadOnly label={text.privacyNotice} value={text.current} status statusIcon="check" />
        </>
      ) : (
        <>
          <ReadOnly
            label={text.verification}
            value={text.status[tutorMeta.verificationStatus]}
            status
            statusIcon={tutorMeta.verificationStatus === 'VERIFIED' ? 'check' : 'info'}
          />
          <ReadOnly label={text.rating} value={tutorMeta.ratingAverage ?? text.newTutor} />
          <ReadOnly label={text.reviews} value={String(tutorMeta.reviewCount)} />
        </>
      )}
    </div>
  );
}

function StudentSummary({ data, language }: { data: StudentForm; language: 'en' | 'th' }) {
  const text = copy[language];
  const nickname = data.nickname.trim() || text.nickname;
  return (
    <aside className="dash-card profile-preview-card">
      <PreviewTitle icon="profile" title={text.accountSummary} body={text.accountSummaryBody} />
      <div className="profile-public-card student">
        <Identity
          name={nickname}
          detail={text.studentAccount}
          initials={initials(nickname, 'S')}
          role="student"
        />
        <div className="profile-summary-list">
          <ReadOnly label={text.school} value={data.school.trim() || '—'} />
          <ReadOnly label={text.classLabel} value={data.gradeLevel.trim() || '—'} />
        </div>
      </div>
      <div className="profile-tip student">
        <b>{text.whatTutorsSee}</b>
        <p>{text.whatTutorsSeeBody}</p>
      </div>
    </aside>
  );
}

function TutorPreview({
  data,
  language,
  status,
}: {
  data: TutorForm;
  language: 'en' | 'th';
  status: TutorProfile['verificationStatus'];
}) {
  const text = copy[language];
  const name = data.displayName.trim() || text.displayName;
  return (
    <aside className="dash-card profile-preview-card">
      <PreviewTitle icon="eye" title={text.studentView} body={text.studentViewBody} />
      <div className="profile-public-card tutor">
        <Identity
          name={name}
          detail={`${data.experienceYears || '0'} ${text.yearsExperience}`}
          initials={initials(name, 'T')}
          role="tutor"
          badge={text.status[status]}
          badgeIcon={status === 'VERIFIED' ? 'check' : 'info'}
        />
        <p className="profile-bio-preview">{data.bio.trim() || text.bioHint}</p>
      </div>
      <div className="profile-tip tutor">
        <b>{text.standOut}</b>
        <p>{text.standOutBody}</p>
      </div>
    </aside>
  );
}

function PreviewTitle({
  icon,
  title,
  body,
}: {
  icon: DashboardIconName;
  title: string;
  body: string;
}) {
  return (
    <>
      <div className="profile-preview-title">
        <span aria-hidden="true">
          <DashboardIcon name={icon} className="h-4 w-4" />
        </span>
        <h2>{title}</h2>
      </div>
      <p className="profile-preview-subtitle">{body}</p>
    </>
  );
}
function Identity({
  name,
  detail,
  initials: letters,
  role,
  badge,
  badgeIcon,
}: {
  name: string;
  detail: string;
  initials: string;
  role: 'student' | 'tutor';
  badge?: string;
  badgeIcon?: DashboardIconName;
}) {
  return (
    <div className="profile-identity">
      <div className={`profile-avatar ${role}`}>{letters}</div>
      <div>
        <h3>{name}</h3>
        <p>{detail}</p>
        {badge && (
          <span className="profile-verified">
            {badgeIcon && <DashboardIcon name={badgeIcon} className="h-3 w-3" />}
            {badge}
          </span>
        )}
      </div>
    </div>
  );
}
function ReadOnly({
  label,
  value,
  status,
  statusIcon,
}: {
  label: string;
  value: string;
  status?: boolean;
  statusIcon?: DashboardIconName;
}) {
  return (
    <div className="profile-read-only">
      <span>{label}</span>
      <b className={status ? 'status' : undefined}>
        {statusIcon && <DashboardIcon name={statusIcon} className="profile-read-only-icon" />}
        {value}
      </b>
    </div>
  );
}
function Alert({ children }: { children: ReactNode }) {
  return (
    <p className="profile-alert" role="alert">
      {children}
    </p>
  );
}
function Loading({ label }: { label: string }) {
  return (
    <main className="profile-loading">
      <span />
      <p role="status">{label}</p>
    </main>
  );
}

function toTutorForm(profile: TutorProfile): TutorForm {
  return {
    bio: profile.bio,
    displayName: profile.displayName,
    experienceYears: String(profile.experienceYears),
    firstName: profile.firstName ?? '',
    lastName: profile.lastName ?? '',
    nickname: profile.nickname ?? '',
  };
}
function trimForm<T extends object>(data: T): T {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, value?.trim() ?? '']),
  ) as T;
}
function studentComplete(data: StudentForm) {
  return Object.values(data).every((value) => value.trim()) && phonePattern.test(data.phone.trim());
}
function tutorComplete(data: TutorForm) {
  const years = Number(data.experienceYears);
  return (
    [data.firstName, data.lastName, data.nickname, data.displayName, data.bio].every((value) =>
      value?.trim(),
    ) &&
    data.experienceYears !== '' &&
    Number.isInteger(years) &&
    years >= 0
  );
}
function validateRequired(data: StudentForm | TutorForm, language: 'en' | 'th') {
  const errors: FieldErrors = {};
  for (const [field, value] of Object.entries(data) as [FieldName, string | null][])
    if (!value?.trim()) errors[field] = requiredMessage(field, language);
  return errors;
}
function validateStudent(data: StudentForm, language: 'en' | 'th') {
  const errors = validateRequired(data, language);
  if (data.phone.trim() && !phonePattern.test(data.phone.trim()))
    errors.phone = copy[language].invalidPhone;
  return errors;
}
function validateTutor(data: TutorForm, language: 'en' | 'th') {
  const errors = validateRequired(data, language);
  const years = Number(data.experienceYears);
  if (data.experienceYears.trim() && (!Number.isInteger(years) || years < 0))
    errors.experienceYears = copy[language].invalidYears;
  return errors;
}
function requiredMessage(field: FieldName, language: 'en' | 'th') {
  const label = copy[language].fieldLabels[field];
  return language === 'th' ? `กรุณากรอก${label}` : `Enter your ${label.toLowerCase()}.`;
}
function apiFieldErrors(error: unknown) {
  if (!(error instanceof ApiError) || !error.details || typeof error.details !== 'object')
    return {};
  const value = (error.details as { message?: unknown }).message;
  const messages = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : typeof value === 'string'
      ? [value]
      : [];
  const errors: FieldErrors = {};
  for (const field of fields) {
    const matchingMessage = messages.find((message) =>
      message.toLowerCase().includes(field.toLowerCase()),
    );
    if (matchingMessage) errors[field] = matchingMessage;
  }
  return errors;
}
function focusFirstError(errors: FieldErrors) {
  const field = Object.keys(errors)[0];
  if (field) requestAnimationFrame(() => document.getElementById(field)?.focus());
}
function descriptionId(id: FieldName, error?: string, hint?: string) {
  return error ? `${id}-error` : hint ? `${id}-hint` : undefined;
}
function initials(value: string, fallback: string) {
  return (
    value
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0] ?? '')
      .join('')
      .toUpperCase() || fallback
  );
}

const copy = {
  en: {
    account: 'Account',
    accountEmail: 'Account email',
    accountSummary: 'Account summary',
    accountSummaryBody: 'A quick check of the information used around your account.',
    allRequired: 'All fields are required by the Student Profile API.',
    back: 'Back to dashboard',
    bio: 'Bio',
    bioHint: 'Share your teaching style, subjects, and what students can expect.',
    cancel: 'Cancel',
    classLabel: 'Class',
    complete: 'Complete',
    consentRequired: 'Accept the updated privacy notice before continuing.',
    continue: 'Save and continue',
    current: 'Current',
    displayName: 'Public tutor name',
    displayNameHint: 'This is how students will see you on HKTutor.',
    experience: 'Experience (years)',
    experienceHint: 'Use a whole number. Zero is allowed.',
    firstName: 'First name',
    gradeLevel: 'Grade level / class',
    identity: 'Identity',
    incomplete: 'Incomplete',
    invalidPhone: 'Enter 8–32 valid phone-number characters.',
    invalidYears: 'Enter a whole number of zero or more.',
    lastName: 'Last name',
    lastStep: 'One last step',
    learningInformation: 'Learning information',
    listingNote: 'Subject, grade level, hourly price, and listing description are managed under',
    loadError: 'Unable to load your profile.',
    loading: 'Loading profile…',
    myListings: 'My listings',
    newTutor: 'New tutor',
    nickname: 'Nickname',
    nicknameHint: 'Used for your account greeting.',
    onboardingBody: 'Complete every required field before continuing to your dashboard.',
    ownerOnly: 'Owner-only personal information',
    phone: 'Emergency telephone number',
    phoneHint:
      'Private. Used by authorised administrators only for urgent class, safety, or service incidents.',
    privacyNotice: 'Privacy notice',
    privateIdentity: 'Private identity',
    privateIdentityHint: 'Visible only to you and authorised administrators',
    privateProfile: 'Kept in your private profile',
    profileInformation: 'Profile information',
    profileStatus: 'Profile status',
    publicProfile: 'Public tutor profile',
    rating: 'Rating',
    reviews: 'Reviews',
    save: 'Save profile',
    saveError: 'Unable to save your profile.',
    saved: 'Profile saved successfully',
    saving: 'Saving…',
    school: 'School',
    shownToStudents: 'Shown to students',
    signOut: 'Sign out',
    standOut: 'Make your profile stand out',
    standOutBody: 'Highlight your teaching style and what makes your lessons valuable.',
    student: 'Student',
    studentAccount: 'Student account',
    studentNicknameHint:
      'Used for dashboard greetings and shown only to a tutor linked to your booking.',
    studentSubtitle: 'Keep your learning and contact information accurate.',
    studentTitle: 'Your student profile',
    studentView: 'Student view',
    studentViewBody: 'This is how your profile appears to students.',
    tutor: 'Tutor',
    tutorSubtitle: 'Tell students about your teaching experience.',
    tutorTitle: 'Your tutor profile',
    tutorVisibility:
      'Private identity stays on your account. Only the public tutor section appears to students.',
    unsaved: 'Unsaved changes',
    updatedNotice: 'The privacy notice has changed because the profile collects personal data.',
    verification: 'Verification',
    whatTutorsSee: 'What tutors can see',
    whatTutorsSeeBody:
      'Only your nickname may appear to a tutor linked to your booking. Your legal name, school, class, telephone, and email stay hidden.',
    yearsExperience: 'years experience',
    status: { PENDING: 'Pending review', REJECTED: 'Not verified', VERIFIED: 'Verified tutor' },
    fieldLabels: {
      bio: 'Tutor biography',
      displayName: 'Public tutor name',
      experienceYears: 'Years of experience',
      firstName: 'First name',
      gradeLevel: 'Grade level or class',
      lastName: 'Last name',
      nickname: 'Nickname',
      phone: 'Emergency telephone number',
      school: 'School',
    },
  },
  th: {
    account: 'บัญชี',
    accountEmail: 'อีเมลบัญชี',
    accountSummary: 'สรุปบัญชี',
    accountSummaryBody: 'ตรวจสอบข้อมูลที่ใช้ภายในบัญชีของคุณอย่างรวดเร็ว',
    allRequired: 'API โปรไฟล์นักเรียนกำหนดให้กรอกข้อมูลทุกช่อง',
    back: 'กลับไปแดชบอร์ด',
    bio: 'แนะนำตัว',
    bioHint: 'แชร์รูปแบบการสอน วิชา และสิ่งที่นักเรียนจะได้รับ',
    cancel: 'ยกเลิก',
    classLabel: 'ชั้นเรียน',
    complete: 'ข้อมูลครบ',
    consentRequired: 'โปรดยอมรับประกาศความเป็นส่วนตัวฉบับล่าสุดก่อนดำเนินการต่อ',
    continue: 'บันทึกและดำเนินการต่อ',
    current: 'เป็นฉบับล่าสุด',
    displayName: 'ชื่อสาธารณะของติวเตอร์',
    displayNameHint: 'นี่คือชื่อที่นักเรียนจะเห็นบน HKTutor',
    experience: 'ประสบการณ์ (ปี)',
    experienceHint: 'กรอกเป็นจำนวนเต็ม โดยสามารถกรอกศูนย์ได้',
    firstName: 'ชื่อจริง',
    gradeLevel: 'ชั้นเรียน',
    identity: 'ข้อมูลประจำตัว',
    incomplete: 'ข้อมูลยังไม่ครบ',
    invalidPhone: 'กรุณากรอกเบอร์โทรศัพท์ที่ถูกต้อง 8–32 ตัวอักษร',
    invalidYears: 'กรุณากรอกจำนวนเต็มตั้งแต่ศูนย์ขึ้นไป',
    lastName: 'นามสกุล',
    lastStep: 'ขั้นตอนสุดท้าย',
    learningInformation: 'ข้อมูลการเรียน',
    listingNote: 'วิชา ระดับชั้น ราคาต่อชั่วโมง และรายละเอียดประกาศ จัดการได้ที่',
    loadError: 'ไม่สามารถโหลดโปรไฟล์ได้',
    loading: 'กำลังโหลดโปรไฟล์…',
    myListings: 'คอร์สของฉัน',
    newTutor: 'ติวเตอร์ใหม่',
    nickname: 'ชื่อเล่น',
    nicknameHint: 'ใช้เป็นชื่อทักทายในบัญชีของคุณ',
    onboardingBody: 'กรอกข้อมูลที่จำเป็นให้ครบก่อนเข้าสู่แดชบอร์ด',
    ownerOnly: 'ข้อมูลส่วนตัวสำหรับเจ้าของบัญชี',
    phone: 'เบอร์โทรศัพท์สำหรับกรณีฉุกเฉิน',
    phoneHint:
      'เป็นข้อมูลส่วนตัว ผู้ดูแลที่ได้รับอนุญาตจะใช้เฉพาะเหตุเร่งด่วนเกี่ยวกับชั้นเรียน ความปลอดภัย หรือการให้บริการ',
    privacyNotice: 'ประกาศความเป็นส่วนตัว',
    privateIdentity: 'ข้อมูลส่วนตัว',
    privateIdentityHint: 'เห็นได้เฉพาะคุณและผู้ดูแลที่ได้รับอนุญาต',
    privateProfile: 'เก็บไว้ในโปรไฟล์ส่วนตัว',
    profileInformation: 'ข้อมูลโปรไฟล์',
    profileStatus: 'สถานะโปรไฟล์',
    publicProfile: 'โปรไฟล์ติวเตอร์สาธารณะ',
    rating: 'คะแนน',
    reviews: 'รีวิว',
    save: 'บันทึกโปรไฟล์',
    saveError: 'ไม่สามารถบันทึกโปรไฟล์ได้',
    saved: 'บันทึกโปรไฟล์สำเร็จ',
    saving: 'กำลังบันทึก…',
    school: 'โรงเรียน',
    shownToStudents: 'แสดงให้นักเรียนเห็น',
    signOut: 'ออกจากระบบ',
    standOut: 'ทำให้โปรไฟล์ของคุณโดดเด่น',
    standOutBody: 'เน้นรูปแบบการสอนและสิ่งที่ทำให้บทเรียนของคุณมีคุณค่า',
    student: 'นักเรียน',
    studentAccount: 'บัญชีนักเรียน',
    studentNicknameHint:
      'ใช้เป็นชื่อทักทายในแดชบอร์ด และแสดงเฉพาะติวเตอร์ที่เกี่ยวข้องกับการจองของคุณ',
    studentSubtitle: 'กรอกข้อมูลการเรียนและข้อมูลติดต่อของคุณให้ถูกต้อง',
    studentTitle: 'โปรไฟล์นักเรียนของคุณ',
    studentView: 'มุมมองนักเรียน',
    studentViewBody: 'โปรไฟล์ของคุณจะแสดงต่อนักเรียนแบบนี้',
    tutor: 'ติวเตอร์',
    tutorSubtitle: 'บอกนักเรียนเกี่ยวกับประสบการณ์การสอนของคุณ',
    tutorTitle: 'โปรไฟล์ติวเตอร์ของคุณ',
    tutorVisibility:
      'ข้อมูลส่วนตัวจะอยู่ในบัญชีของคุณ เฉพาะส่วนโปรไฟล์สาธารณะเท่านั้นที่นักเรียนมองเห็น',
    unsaved: 'มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก',
    updatedNotice: 'ประกาศความเป็นส่วนตัวมีการปรับปรุง เนื่องจากโปรไฟล์เก็บข้อมูลส่วนบุคคล',
    verification: 'การยืนยัน',
    whatTutorsSee: 'ข้อมูลที่ติวเตอร์มองเห็น',
    whatTutorsSeeBody:
      'เฉพาะชื่อเล่นเท่านั้นที่อาจแสดงให้ติวเตอร์ซึ่งเกี่ยวข้องกับการจองเห็น ชื่อจริง โรงเรียน ชั้นเรียน เบอร์โทรศัพท์ และอีเมลจะไม่แสดง',
    yearsExperience: 'ปีของประสบการณ์',
    status: {
      PENDING: 'รอตรวจสอบ',
      REJECTED: 'ยังไม่ผ่านการยืนยัน',
      VERIFIED: 'ติวเตอร์ที่ยืนยันแล้ว',
    },
    fieldLabels: {
      bio: 'ประวัติแนะนำตัว',
      displayName: 'ชื่อสาธารณะของติวเตอร์',
      experienceYears: 'จำนวนปีที่มีประสบการณ์',
      firstName: 'ชื่อจริง',
      gradeLevel: 'ชั้นเรียน',
      lastName: 'นามสกุล',
      nickname: 'ชื่อเล่น',
      phone: 'เบอร์โทรศัพท์สำหรับกรณีฉุกเฉิน',
      school: 'โรงเรียน',
    },
  },
} as const;
