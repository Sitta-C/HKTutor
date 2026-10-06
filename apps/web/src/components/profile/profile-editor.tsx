'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { DashboardIcon, type DashboardIconName } from '@/components/dashboard/dashboard-icon';
import DashboardShell from '@/components/dashboard/dashboard-shell';
import PrivacyConsent from '@/components/privacy-consent';
import { AvatarEditor } from '@/components/profile/avatar-editor';
import { OwnProfileAvatar } from '@/components/profile/profile-avatar';
import {
  emptyStudentForm,
  emptyTutorForm,
  isStudentProfileComplete,
  isTutorProfileComplete,
  readProfileFieldErrors,
  toTutorForm,
  trimProfileForm,
  validateStudentProfile,
  validateTutorProfile,
} from '@/components/profile/profile-editor-model';
import { TutorProfileSummary } from '@/components/profile/tutor-profile-summary';
import {
  GraphPaper,
  PaperCard,
  StatusBadge,
  StickyNote,
  WashiTape,
  notebookButtonClass,
  notebookInputClass,
} from '@/components/ui/notebook';
import { NotebookLoading } from '@/components/ui/notebook-loading';
import { useNotebookToast } from '@/components/ui/notebook-toast';
import {
  acceptCurrentPrivacyNotice,
  saveStudentProfile,
  saveTutorProfile,
} from '@/lib/api/profiles';
import { useAuth } from '@/lib/auth-context';
import { clearCurrentProfileCache, loadCurrentProfile } from '@/lib/current-profile';
import { useLanguage } from '@/lib/i18n';
import {
  DASHBOARD_PATH,
  getStudentProfile,
  getTutorProfile,
  isProfileSetupError,
  resolveDashboardGate,
  resolveOnboardingHandoff,
} from '@/lib/profile-navigation';
import { sanitizeReturnTo } from '@/lib/return-to';

import previewStyles from './profile-page-preview.module.css';

import type {
  ProfileFieldErrors,
  ProfileFieldName,
  StudentForm,
  TutorForm,
} from '@/components/profile/profile-editor-model';
import type { AuthUser, TutorProfile } from '@/lib/api/types';
import type { FormEvent, InputHTMLAttributes, ReactNode } from 'react';

interface ProfileEditorProps {
  mode: 'onboarding' | 'edit';
}

type FieldName = ProfileFieldName;
type FieldErrors = ProfileFieldErrors;
type ProfileTone = 'student' | 'tutor';

const emptyTutorMeta = {
  ratingAverage: null,
  reviewCount: 0,
  verificationStatus: 'PENDING',
} satisfies Pick<TutorProfile, 'ratingAverage' | 'reviewCount' | 'verificationStatus'>;

const profileTone = {
  student: {
    accent: 'text-student-deep',
    avatar: 'bg-student-deep',
    badge: 'student' as const,
    fieldFocus: 'focus:border-student focus:ring-sticky-green/70',
  },
  tutor: {
    accent: 'text-tutor-deep',
    avatar: 'bg-tutor-deep',
    badge: 'tutor' as const,
    fieldFocus: 'focus:border-tutor focus:ring-sticky-blue/70',
  },
};

function profileInputClass(tone: ProfileTone, error: boolean, className?: string): string {
  return notebookInputClass({
    error,
    className: [error ? undefined : profileTone[tone].fieldFocus, className]
      .filter(Boolean)
      .join(' '),
  });
}

export default function ProfileEditor({ mode }: ProfileEditorProps) {
  const { isLoading: authLoading, logout, user } = useAuth();
  const { language } = useLanguage();
  const toast = useNotebookToast();
  const router = useRouter();
  const text = copy[language];
  const [avatarUpdatedAt, setAvatarUpdatedAt] = useState<string | null>(null);
  const [student, setStudent] = useState<StudentForm>(emptyStudentForm);
  const [initialStudent, setInitialStudent] = useState<StudentForm>(emptyStudentForm);
  const [tutor, setTutor] = useState<TutorForm>(emptyTutorForm);
  const [initialTutor, setInitialTutor] = useState<TutorForm>(emptyTutorForm);
  const [tutorMeta, setTutorMeta] =
    useState<Pick<TutorProfile, 'ratingAverage' | 'reviewCount' | 'verificationStatus'>>(
      emptyTutorMeta,
    );
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
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
    loadCurrentProfile(user.id)
      .then((result) => {
        if (!active) return;
        setConsentCurrent(result.consentCurrent);
        setAvatarUpdatedAt(result.avatarUpdatedAt ?? null);
        const studentProfile = getStudentProfile(result);
        if (user.role === 'STUDENT' && studentProfile) {
          setStudent(studentProfile);
          setInitialStudent(studentProfile);
        }
        const tutorProfile = getTutorProfile(result);
        if (user.role === 'TUTOR' && tutorProfile) {
          const form = toTutorForm(tutorProfile);
          setTutor(form);
          setInitialTutor(form);
          setTutorMeta(tutorProfile);
        }
        if (mode === 'onboarding' && resolveDashboardGate(result) === null) {
          router.replace(readOnboardingReturnTo());
          return;
        }
        setIsLoading(false);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        if (isProfileSetupError(caught)) {
          setConsentCurrent(false);
        } else {
          setError(text.loadError);
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
        const result = await loadCurrentProfile(user.id, { force: true });
        setConsentCurrent(result.consentCurrent);
        setAvatarUpdatedAt(result.avatarUpdatedAt ?? null);
        setAcceptedNotice(false);
        setConsentError(null);

        const studentProfile = getStudentProfile(result);
        if (user.role === 'STUDENT' && studentProfile) {
          setStudent(studentProfile);
          setInitialStudent(studentProfile);
        }
        const tutorProfile = getTutorProfile(result);
        if (user.role === 'TUTOR' && tutorProfile) {
          const form = toTutorForm(tutorProfile);
          setTutor(form);
          setInitialTutor(form);
          setTutorMeta(tutorProfile);
        }

        const handoff = resolveOnboardingHandoff(result);
        if (mode === 'onboarding' && handoff) router.replace(readOnboardingReturnTo());
      } catch {
        setError(text.saveError);
      } finally {
        setIsSaving(false);
      }
      return;
    }

    const validationErrors = studentRole
      ? validateStudentProfile(student, language, text)
      : validateTutorProfile(tutor, language, text);
    if (Object.keys(validationErrors).length) {
      setFieldErrors(validationErrors);
      focusFirstError(validationErrors);
      return;
    }

    setError(null);
    setFieldErrors({});
    setIsSaving(true);
    try {
      if (user.role === 'STUDENT') {
        const result = await saveStudentProfile(trimProfileForm(student));
        setStudent(result);
        setInitialStudent(result);
      } else {
        const normalized = trimProfileForm(tutor);
        const result = await saveTutorProfile({
          ...normalized,
          experienceYears: Number(normalized.experienceYears),
        });
        const form = toTutorForm(result);
        setTutor(form);
        setInitialTutor(form);
        setTutorMeta(result);
      }
      clearCurrentProfileCache();
      if (mode === 'onboarding') router.replace(readOnboardingReturnTo());
      else toast.success(text.saved);
    } catch (caught: unknown) {
      const apiErrors = readProfileFieldErrors(caught);
      setFieldErrors(apiErrors);
      if (Object.keys(apiErrors).length) focusFirstError(apiErrors);
      setError(text.saveError);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    if (studentRole) setStudent(initialStudent);
    else setTutor(initialTutor);
    setFieldErrors({});
    setError(null);
  };
  const handleLogout = async () => {
    await logout();
    router.replace('/');
  };

  if (authLoading || isLoading || !user) {
    return (
      <NotebookLoading
        kind={mode === 'onboarding' ? 'profileOnboarding' : 'profileEdit'}
        label={text.loading}
      />
    );
  }

  const savedShellName = studentRole
    ? initialStudent.nickname.trim()
    : initialTutor.displayName.trim();
  const shellUser: AuthUser = savedShellName
    ? { ...user, displayName: savedShellName }
    : { ...user };
  const tone: ProfileTone = studentRole ? 'student' : 'tutor';
  const headerNav =
    mode === 'edit' ? null : (
      <button
        className={notebookButtonClass({ tone: 'secondary', className: 'px-3.5' })}
        type="button"
        onClick={() => void handleLogout()}
      >
        {text.signOut}
      </button>
    );

  return (
    <DashboardShell user={shellUser} onLogout={handleLogout} headerNavRight={headerNav}>
      <header className="mb-6 mt-7">
        <p className="font-note text-xl font-semibold leading-none text-amber-700 sm:text-2xl">
          {mode === 'onboarding' ? text.lastStep : text.account}
        </p>
        <h1 className="mt-2 flex flex-wrap items-center gap-3 text-3xl font-bold tracking-[-0.045em] text-notebook-ink sm:text-4xl">
          <span>{studentRole ? text.studentTitle : text.tutorTitle}</span>
          <StatusBadge tone={profileTone[tone].badge} className="tracking-wide">
            {studentRole ? text.student : text.tutor}
          </StatusBadge>
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-notebook-muted sm:text-base">
          {mode === 'onboarding'
            ? text.onboardingBody
            : studentRole
              ? text.studentSubtitle
              : text.tutorSubtitle}
        </p>
      </header>

      {!consentCurrent ? (
        <PaperCard className="mx-auto max-w-3xl p-5 sm:p-7">
          <WashiTape tone="pink" className="-top-2 left-1/2 -translate-x-1/2" />
          <form onSubmit={handleSubmit}>
            <h2 className="font-note text-2xl font-bold text-notebook-ink">{text.account}</h2>
            {error && <Alert>{error}</Alert>}
            <p className="mb-5 mt-2 text-sm leading-6 text-notebook-muted">{text.updatedNotice}</p>
            <PrivacyConsent
              accepted={acceptedNotice}
              onAcceptedChange={(accepted) => {
                setAcceptedNotice(accepted);
                if (accepted) setConsentError(null);
              }}
              error={consentError}
            />
            <button
              className={notebookButtonClass({ className: 'mt-5' })}
              disabled={isSaving}
              type="submit"
            >
              {isSaving ? text.saving : text.continue}
            </button>
          </form>
        </PaperCard>
      ) : (
        <div
          className={`grid items-start gap-5 min-[1061px]:grid-cols-[minmax(0,1.4fr)_minmax(290px,.75fr)] ${
            studentRole ? 'min-[1061px]:grid-cols-[minmax(0,1.35fr)_minmax(290px,.75fr)]' : ''
          }`}
        >
          <PaperCard className="overflow-hidden p-0">
            <WashiTape tone={studentRole ? 'yellow' : 'blue'} className="-top-2 left-8 rotate-2" />
            <form className="p-5 sm:p-7" noValidate onSubmit={handleSubmit}>
              <div className="flex flex-col gap-1 border-b border-dashed border-paper-edge pb-5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                <h2 className="text-lg font-extrabold text-notebook-ink">
                  {text.profileInformation}
                </h2>
              </div>
              {error && <Alert>{error}</Alert>}
              <AvatarEditor
                userId={user.id}
                name={savedShellName || user.email}
                role={tone}
                language={language}
                avatarUpdatedAt={avatarUpdatedAt}
                onChanged={setAvatarUpdatedAt}
                disabled={isSaving}
              />
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
                complete={
                  studentRole ? isStudentProfileComplete(student) : isTutorProfileComplete(tutor)
                }
                tutorMeta={tutorMeta}
              />
              {!studentRole && (
                <p className="mt-3 text-xs leading-5 text-notebook-muted">
                  {text.listingNote}{' '}
                  <Link
                    href="/dashboard#listings"
                    className="font-bold text-notebook-ink underline decoration-margin-guide decoration-2 underline-offset-4"
                  >
                    {text.myListings}
                  </Link>
                  .
                </p>
              )}
              <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-dashed border-paper-edge pt-5">
                <button className={notebookButtonClass()} disabled={isSaving} type="submit">
                  {isSaving ? text.saving : mode === 'onboarding' ? text.continue : text.save}
                </button>
                <button
                  className={notebookButtonClass({ tone: 'secondary' })}
                  disabled={!dirty || isSaving}
                  onClick={handleCancel}
                  type="button"
                >
                  {text.cancel}
                </button>
                {dirty && (
                  <span className="w-full text-xs font-bold text-amber-700 sm:ml-auto sm:w-auto">
                    {text.unsaved}
                  </span>
                )}
              </div>
            </form>
          </PaperCard>
          {studentRole ? (
            <StudentSummary userId={user.id} data={student} language={language} />
          ) : (
            <TutorPreview
              userId={user.id}
              data={tutor}
              language={language}
              status={tutorMeta.verificationStatus}
            />
          )}
        </div>
      )}
    </DashboardShell>
  );
}

function readOnboardingReturnTo(): string {
  if (typeof window === 'undefined') return DASHBOARD_PATH;
  return sanitizeReturnTo(new URLSearchParams(window.location.search).get('returnTo'));
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
    <div className="grid gap-4 pt-5 sm:grid-cols-2">
      <Section title={text.identity} tone="student" />
      <TextField
        id="firstName"
        label={text.firstName}
        value={data.firstName}
        maxLength={100}
        autoComplete="given-name"
        error={errors.firstName}
        tone="student"
        onChange={onChange}
      />
      <TextField
        id="lastName"
        label={text.lastName}
        value={data.lastName}
        maxLength={100}
        autoComplete="family-name"
        error={errors.lastName}
        tone="student"
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
        tone="student"
        onChange={onChange}
      />
      <Section title={text.learningInformation} tone="student" separated />
      <TextField
        id="school"
        label={text.school}
        value={data.school}
        maxLength={160}
        autoComplete="organization"
        error={errors.school}
        tone="student"
        onChange={onChange}
      />
      <TextField
        id="gradeLevel"
        label={text.gradeLevel}
        value={data.gradeLevel}
        maxLength={80}
        error={errors.gradeLevel}
        tone="student"
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
        tone="student"
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
    <div className="grid gap-4 pt-5 sm:grid-cols-2">
      <Section title={text.privateIdentity} tone="tutor" />
      <TextField
        id="firstName"
        label={text.firstName}
        value={data.firstName ?? ''}
        maxLength={100}
        autoComplete="given-name"
        error={errors.firstName}
        tone="tutor"
        onChange={onChange}
      />
      <TextField
        id="lastName"
        label={text.lastName}
        value={data.lastName ?? ''}
        maxLength={100}
        autoComplete="family-name"
        error={errors.lastName}
        tone="tutor"
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
        tone="tutor"
        onChange={onChange}
      />
      <Section title={text.publicProfile} tone="tutor" separated />
      <TextField
        id="displayName"
        label={text.displayName}
        value={data.displayName}
        maxLength={100}
        hint={text.displayNameHint}
        error={errors.displayName}
        tone="tutor"
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
        tone="tutor"
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
          className={profileInputClass('tutor', Boolean(errors.bio), 'min-h-40 resize-y leading-6')}
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
  tone,
  onChange,
  ...props
}: {
  id: T;
  label: string;
  value: string;
  hint?: string | undefined;
  error?: string | undefined;
  full?: boolean | undefined;
  tone: ProfileTone;
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
        className={profileInputClass(tone, Boolean(error))}
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
    <div className={full ? 'sm:col-span-2' : undefined}>
      <div className="mb-1.5 flex justify-between gap-4">
        <label htmlFor={id} className="text-sm font-bold text-notebook-ink">
          {label}
        </label>
        {count && <span className="text-xs text-notebook-muted">{count}</span>}
      </div>
      {children}
      {hint && !error && (
        <p className="mt-1.5 text-xs leading-5 text-notebook-muted" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {error && (
        <p className="mt-1.5 text-xs font-semibold text-red-700" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function Section({
  title,
  hint,
  tone,
  separated = false,
}: {
  title: string;
  hint?: string;
  tone: ProfileTone;
  separated?: boolean;
}) {
  return (
    <div
      className={`flex flex-col items-start gap-1 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 ${
        separated ? 'mt-1 border-t border-dashed border-paper-edge pt-5' : ''
      }`}
    >
      <strong
        className={`text-xs font-extrabold uppercase tracking-[0.12em] ${profileTone[tone].accent}`}
      >
        {title}
      </strong>
      {hint && <span className="text-xs text-notebook-muted">{hint}</span>}
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
  if (!student) {
    return <TutorProfileSummary email={email} language={language} tutorMeta={tutorMeta} />;
  }
  return (
    <div
      className="mt-5 grid gap-3 border-t border-dashed border-paper-edge pt-5 sm:grid-cols-[minmax(0,2fr)_minmax(180px,1fr)]"
      aria-label={text.profileStatus}
    >
      <ReadOnly label={text.accountEmail} value={email} />
      <ReadOnly
        label={text.profileStatus}
        value={complete ? text.complete : text.incomplete}
        statusTone={complete ? 'student' : 'pending'}
      />
    </div>
  );
}

function StudentSummary({
  data,
  language,
  userId,
}: {
  userId: string;
  data: StudentForm;
  language: 'en' | 'th';
}) {
  const text = copy[language];
  const nickname = data.nickname.trim() || text.nickname;
  return (
    <aside className="self-start min-[1061px]:sticky min-[1061px]:top-24">
      <PaperCard className="p-5 sm:p-6">
        <WashiTape tone="yellow" className="-top-2 right-8 rotate-3" />
        <PreviewTitle
          icon="profile"
          title={text.accountSummary}
          body={text.accountSummaryBody}
          tone="student"
        />
        <StickyNote tone="green" className="p-4">
          <Identity
            userId={userId}
            name={nickname}
            detail={text.studentAccount}
            initials={initials(nickname, 'S')}
            role="student"
          />
          <dl className="relative z-10 mt-4 grid gap-2 border-t border-emerald-200/80 pt-4">
            <div className="flex justify-between gap-4 text-xs">
              <dt className="text-notebook-muted">{text.school}</dt>
              <dd className="text-right font-bold text-notebook-ink">
                {data.school.trim() || '—'}
              </dd>
            </div>
            <div className="flex justify-between gap-4 text-xs">
              <dt className="text-notebook-muted">{text.classLabel}</dt>
              <dd className="text-right font-bold text-notebook-ink">
                {data.gradeLevel.trim() || '—'}
              </dd>
            </div>
          </dl>
        </StickyNote>
        <GraphPaper className="mt-4 p-4">
          <b className="text-sm text-notebook-ink">{text.whatTutorsSee}</b>
          <p className="mt-1 text-xs leading-5 text-notebook-muted">{text.whatTutorsSeeBody}</p>
        </GraphPaper>
      </PaperCard>
    </aside>
  );
}

function TutorPreview({
  userId,
  data,
  language,
  status,
}: {
  userId: string;
  data: TutorForm;
  language: 'en' | 'th';
  status: TutorProfile['verificationStatus'];
}) {
  const text = copy[language];
  const name = data.displayName.trim() || text.displayName;
  return (
    <aside
      className={`${previewStyles.preview} min-w-0 self-start min-[1061px]:sticky min-[1061px]:top-24`}
      aria-labelledby="tutor-student-view-title"
    >
      <header className={previewStyles.header}>
        <h2 id="tutor-student-view-title" className="font-note">
          <DashboardIcon name="eye" className="h-[18px] w-[18px] shrink-0 text-tutor-deep" />
          {text.studentView}
        </h2>
        <p>{text.studentViewBody}</p>
      </header>
      <PaperCard className={previewStyles.paper}>
        <WashiTape tone="blue" className={`${previewStyles.tape}`} />
        <div className={previewStyles.identityRow}>
          <div className={previewStyles.identity}>
            <Identity
              userId={userId}
              name={name}
              detail={text.tutor}
              initials={initials(name, 'T')}
              role="tutor"
            />
            <p
              className={`${previewStyles.verification} ${
                status === 'VERIFIED'
                  ? 'text-emerald-800'
                  : status === 'REJECTED'
                    ? 'text-red-700'
                    : 'text-amber-700'
              }`}
            >
              <DashboardIcon
                name={status === 'VERIFIED' ? 'shield' : 'info'}
                className="h-4 w-4 shrink-0"
              />
              {text.status[status]}
            </p>
          </div>
          <StickyNote tone="yellow" className={previewStyles.experience}>
            <strong className="font-note">
              {data.experienceYears || '0'} {text.years}
            </strong>
            <span>{text.teachingExperience}</span>
          </StickyNote>
        </div>
        <div className={previewStyles.about}>
          <p className={previewStyles.aboutLabel}>{text.aboutMe}</p>
          <p className={previewStyles.bio}>{data.bio.trim() || text.bioHint}</p>
        </div>
      </PaperCard>
      <StickyNote tone="yellow" className={previewStyles.tip}>
        <DashboardIcon name="info" className="mt-1 h-[18px] w-[18px] shrink-0 text-amber-700" />
        <div>
          <h3 className="font-note">{text.standOut}</h3>
          <p>{text.standOutBody}</p>
        </div>
      </StickyNote>
    </aside>
  );
}

function PreviewTitle({
  icon,
  title,
  body,
  tone,
}: {
  icon: DashboardIconName;
  title: string;
  body: string;
  tone: ProfileTone;
}) {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2.5">
        <span
          className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${
            tone === 'student'
              ? 'bg-sticky-green text-student-deep'
              : 'bg-sticky-blue text-tutor-deep'
          }`}
          aria-hidden="true"
        >
          <DashboardIcon name={icon} className="h-4 w-4" />
        </span>
        <h2 className="text-lg font-extrabold text-notebook-ink">{title}</h2>
      </div>
      <p className="mt-1.5 text-xs leading-5 text-notebook-muted">{body}</p>
    </div>
  );
}
function Identity({
  userId,
  name,
  detail,
  secondaryDetail,
  initials: letters,
  imageUrl,
  role,
  badge,
  badgeIcon,
}: {
  userId: string;
  name: string;
  detail: string;
  secondaryDetail?: string;
  initials: string;
  imageUrl?: string | null;
  role: 'student' | 'tutor';
  badge?: string;
  badgeIcon?: DashboardIconName;
}) {
  return (
    <div className="relative z-10 flex items-center gap-3">
      <OwnProfileAvatar
        userId={userId}
        name={name}
        imageUrl={imageUrl}
        fallback={letters}
        sizes="56px"
        className={`h-14 w-14 border-2 border-paper text-lg font-black text-white shadow-sm ring-1 ring-paper-edge ${profileTone[role].avatar}`}
      />
      <div className="min-w-0">
        <h3 className="truncate text-base font-extrabold text-notebook-ink">{name}</h3>
        <p className="mt-0.5 text-xs text-notebook-muted">{detail}</p>
        {secondaryDetail && <p className="mt-0.5 text-xs text-notebook-muted">{secondaryDetail}</p>}
        {badge && (
          <StatusBadge tone={profileTone[role].badge} className="mt-2 gap-1.5 py-0.5">
            {badgeIcon && <DashboardIcon name={badgeIcon} className="h-3 w-3" />}
            {badge}
          </StatusBadge>
        )}
      </div>
    </div>
  );
}
function ReadOnly({
  label,
  value,
  statusTone,
}: {
  label: string;
  value: string;
  statusTone?: 'student' | 'tutor' | 'pending' | 'error';
}) {
  const toneClass = {
    student: 'text-student-deep',
    tutor: 'text-tutor-deep',
    pending: 'text-amber-700',
    error: 'text-red-700',
  };
  return (
    <div className="min-w-0 rounded-lg border border-paper-edge bg-paper-deep/65 px-3 py-2.5">
      <span className="block text-[0.65rem] font-bold uppercase tracking-[0.08em] text-notebook-muted">
        {label}
      </span>
      <b
        className={`mt-1 flex items-center gap-1.5 text-xs leading-5 [overflow-wrap:anywhere] ${
          statusTone ? toneClass[statusTone] : 'text-notebook-ink'
        }`}
      >
        {statusTone && (
          <i className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
        )}
        {value}
      </b>
    </div>
  );
}
function Alert({ children }: { children: ReactNode }) {
  return (
    <p
      className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700"
      role="alert"
    >
      {children}
    </p>
  );
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
    aboutMe: 'About me',
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
    onboardingNoteBody:
      'After email verification, an incomplete profile returns here before the dashboard. A completed profile can be edited from My profile.',
    onboardingNoteTitle: 'Used for onboarding and later edits',
    ownerOnly: 'Owner-only personal information',
    phone: 'Emergency telephone number',
    phoneHint:
      'Private. Used by authorised administrators only for urgent class, safety, or service incidents.',
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
    teachingExperience: 'Teaching experience',
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
    experienceShort: 'Experience',
    years: 'years',
    status: { PENDING: 'Pending review', REJECTED: 'Not verified', VERIFIED: 'Verified' },
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
    aboutMe: 'เกี่ยวกับฉัน',
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
    onboardingNoteBody:
      'หลังยืนยันอีเมล หากข้อมูลยังไม่ครบ ระบบจะพากลับมาหน้านี้ก่อนเข้าแดชบอร์ด เมื่อกรอกครบแล้วสามารถแก้ไขได้จากโปรไฟล์ของฉัน',
    onboardingNoteTitle: 'ใช้ได้ทั้งตอนเริ่มต้นและแก้ไขภายหลัง',
    ownerOnly: 'ข้อมูลส่วนตัวสำหรับเจ้าของบัญชี',
    phone: 'เบอร์โทรศัพท์สำหรับกรณีฉุกเฉิน',
    phoneHint:
      'เป็นข้อมูลส่วนตัว ผู้ดูแลที่ได้รับอนุญาตจะใช้เฉพาะเหตุเร่งด่วนเกี่ยวกับชั้นเรียน ความปลอดภัย หรือการให้บริการ',
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
    teachingExperience: 'ประสบการณ์สอน',
    tutorSubtitle: 'บอกนักเรียนเกี่ยวกับประสบการณ์การสอนของคุณ',
    tutorTitle: 'โปรไฟล์ติวเตอร์ของคุณ',
    tutorVisibility:
      'ข้อมูลส่วนตัวจะอยู่ในบัญชีของคุณ เฉพาะส่วนโปรไฟล์สาธารณะเท่านั้นที่นักเรียนมองเห็น',
    unsaved: 'มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก',
    updatedNotice: 'ประกาศความเป็นส่วนตัวมีการปรับปรุง เนื่องจากโปรไฟล์เก็บข้อมูลส่วนบุคคล',
    verification: 'การยืนยัน',
    whatTutorsSee: 'ข้อมูลที่ติวเตอร์มองเห็น',
    whatTutorsSeeBody:
      'เฉพาะชื่อเล่นเท่านั้นที่จะแสดงให้ติวเตอร์ซึ่งเกี่ยวข้องกับการจองเห็น ชื่อจริง โรงเรียน ชั้นเรียน เบอร์โทรศัพท์ และอีเมลจะไม่แสดง',
    experienceShort: 'ประสบการณ์',
    years: 'ปี',
    status: {
      PENDING: 'รอตรวจสอบ',
      REJECTED: 'ยังไม่ผ่านการยืนยัน',
      VERIFIED: 'ยืนยันแล้ว',
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
