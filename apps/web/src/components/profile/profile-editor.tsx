'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import PrivacyConsent from '@/components/privacy-consent';
import {
  acceptCurrentPrivacyNotice,
  getMyProfile,
  saveStudentProfile,
  saveTutorProfile,
} from '@/lib/api/profiles';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/lib/i18n';

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

interface ProfileCopy {
  back: string;
  bio: string;
  consentRequired: string;
  continue: string;
  displayName: string;
  displayNameHint: string;
  editEyebrow: string;
  editTitle: string;
  experienceYears: string;
  firstName: string;
  gradeLevel: string;
  lastName: string;
  loadError: string;
  loading: string;
  nickname: string;
  onboardingEyebrow: string;
  onboardingTitle: string;
  phone: string;
  phoneHint: string;
  save: string;
  saveError: string;
  saving: string;
  school: string;
  signOut: string;
  subtitle: string;
  updatedNotice: string;
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
  const [error, setError] = useState<string | null>(null);

  const copy = language === 'th' ? thaiCopy : englishCopy;

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

    setError(null);
    setConsentError(null);
    setIsSaving(true);

    try {
      if (!consentCurrent) await acceptCurrentPrivacyNotice();

      if (user.role === 'STUDENT') {
        await saveStudentProfile(student);
      } else {
        await saveTutorProfile({
          ...tutor,
          experienceYears: Number(tutor.experienceYears),
        });
      }
      router.replace('/dashboard');
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

  if (authLoading || isLoading || !user) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-[#fbfaf7] p-6">
        <p role="status" className="text-sm font-semibold text-[#5e5a52]">
          {copy.loading}
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-[#fbfaf7] px-5 py-8 text-[#171714] sm:px-8 sm:py-12">
      <div className="mx-auto max-w-3xl">
        <header className="mb-7 flex items-center justify-between gap-4">
          <Link href="/dashboard" className="text-xl font-black tracking-[-0.07em]">
            HKTutor
          </Link>
          {mode === 'edit' ? (
            <Link
              href="/dashboard"
              className="rounded-xl border border-[#dedbd3] bg-white px-4 py-2.5 text-sm font-bold hover:bg-[#f7f4ec]"
            >
              {copy.back}
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="rounded-xl border border-[#dedbd3] bg-white px-4 py-2.5 text-sm font-bold hover:bg-[#f7f4ec]"
            >
              {copy.signOut}
            </button>
          )}
        </header>

        <section className="rounded-[2rem] bg-white p-6 shadow-[0_22px_65px_rgba(46,39,25,0.08)] sm:p-10">
          <p className="text-[0.68rem] font-bold uppercase tracking-[0.24em] text-[#d18b43]">
            {mode === 'onboarding' ? copy.onboardingEyebrow : copy.editEyebrow}
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-[-0.05em]">
            {mode === 'onboarding' ? copy.onboardingTitle : copy.editTitle}
          </h1>
          <p className="mt-3 max-w-2xl leading-7 text-[#5e5a52]">{copy.subtitle}</p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-7">
            {error && (
              <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-[#c04f40]">
                {error}
              </p>
            )}

            {user.role === 'STUDENT' ? (
              <StudentFields data={student} copy={copy} onChange={setStudent} />
            ) : (
              <TutorFields data={tutor} copy={copy} onChange={setTutor} />
            )}

            {!consentCurrent && (
              <div className="rounded-xl border border-[#f1d5ad] bg-[#fff9ef] p-4">
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

            <button
              type="submit"
              disabled={isSaving}
              className="flex h-13 w-full items-center justify-center rounded-xl bg-[#ffc57d] px-5 text-base font-bold text-[#171714] transition-colors hover:bg-[#ffbd6c] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? copy.saving : mode === 'onboarding' ? copy.continue : copy.save}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}

function StudentFields({
  data,
  copy,
  onChange,
}: {
  data: StudentFormData;
  copy: ProfileCopy;
  onChange: (data: StudentFormData) => void;
}) {
  return (
    <>
      <NameFields data={data} copy={copy} onChange={onChange} />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={copy.school}>
          <input
            required
            maxLength={160}
            value={data.school}
            onChange={(event) => onChange({ ...data, school: event.target.value })}
            className={fieldClass}
            autoComplete="organization"
          />
        </Field>
        <Field label={copy.gradeLevel}>
          <input
            required
            maxLength={80}
            value={data.gradeLevel}
            onChange={(event) => onChange({ ...data, gradeLevel: event.target.value })}
            className={fieldClass}
          />
        </Field>
      </div>
      <Field label={copy.phone} hint={copy.phoneHint}>
        <input
          required
          type="tel"
          minLength={8}
          maxLength={32}
          pattern="[+0-9][0-9 ()-]{7,31}"
          value={data.phone}
          onChange={(event) => onChange({ ...data, phone: event.target.value })}
          className={fieldClass}
          autoComplete="tel"
        />
      </Field>
    </>
  );
}

function TutorFields({
  data,
  copy,
  onChange,
}: {
  data: TutorFormData;
  copy: ProfileCopy;
  onChange: (data: TutorFormData) => void;
}) {
  return (
    <>
      <NameFields data={data} copy={copy} onChange={onChange} />
      <Field label={copy.displayName} hint={copy.displayNameHint}>
        <input
          required
          maxLength={100}
          value={data.displayName}
          onChange={(event) => onChange({ ...data, displayName: event.target.value })}
          className={fieldClass}
        />
      </Field>
      <Field label={copy.bio}>
        <textarea
          required
          maxLength={2000}
          rows={6}
          value={data.bio}
          onChange={(event) => onChange({ ...data, bio: event.target.value })}
          className={`${fieldClass} h-auto py-3`}
        />
      </Field>
      <Field label={copy.experienceYears}>
        <input
          required
          type="number"
          min={0}
          step={1}
          value={data.experienceYears}
          onChange={(event) => onChange({ ...data, experienceYears: event.target.value })}
          className={fieldClass}
          inputMode="numeric"
        />
      </Field>
    </>
  );
}

function NameFields<T extends Pick<StudentFormData, 'firstName' | 'lastName' | 'nickname'>>({
  data,
  copy,
  onChange,
}: {
  data: T;
  copy: ProfileCopy;
  onChange: (data: T) => void;
}) {
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <Field label={copy.firstName}>
        <input
          required
          maxLength={100}
          value={data.firstName}
          onChange={(event) => onChange({ ...data, firstName: event.target.value })}
          className={fieldClass}
          autoComplete="given-name"
        />
      </Field>
      <Field label={copy.lastName}>
        <input
          required
          maxLength={100}
          value={data.lastName}
          onChange={(event) => onChange({ ...data, lastName: event.target.value })}
          className={fieldClass}
          autoComplete="family-name"
        />
      </Field>
      <Field label={copy.nickname}>
        <input
          required
          maxLength={60}
          value={data.nickname}
          onChange={(event) => onChange({ ...data, nickname: event.target.value })}
          className={fieldClass}
          autoComplete="nickname"
        />
      </Field>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block text-sm font-bold text-[#34332e]">
      {label}
      {hint && (
        <span className="mt-1 block text-xs font-normal leading-5 text-[#77736b]">{hint}</span>
      )}
      {children}
    </label>
  );
}

const englishCopy: ProfileCopy = {
  back: 'Back to dashboard',
  bio: 'Biography',
  consentRequired: 'Accept the updated privacy notice before saving your profile.',
  continue: 'Save and continue',
  displayName: 'Public tutor name',
  displayNameHint: 'This is the name students and visitors can see.',
  editEyebrow: 'Account',
  editTitle: 'Edit your profile',
  experienceYears: 'Years of tutoring experience',
  firstName: 'First name',
  gradeLevel: 'Grade level / class',
  lastName: 'Last name',
  loadError: 'Unable to load your profile.',
  loading: 'Loading profile…',
  nickname: 'Nickname',
  onboardingEyebrow: 'One last step',
  onboardingTitle: 'Complete your profile',
  phone: 'Emergency telephone number',
  phoneHint:
    'Private. Used by authorised project administrators only for urgent class, safety, or service incidents.',
  save: 'Save changes',
  saveError: 'Unable to save your profile.',
  saving: 'Saving…',
  school: 'School',
  signOut: 'Sign out',
  subtitle: 'Keep this information accurate. You can update it later from your dashboard.',
  updatedNotice: 'The privacy notice has changed because the profile now collects personal data.',
};

const thaiCopy: ProfileCopy = {
  back: 'กลับไปแดชบอร์ด',
  bio: 'ประวัติแนะนำตัว',
  consentRequired: 'โปรดยอมรับประกาศความเป็นส่วนตัวฉบับล่าสุดก่อนบันทึกโปรไฟล์',
  continue: 'บันทึกและดำเนินการต่อ',
  displayName: 'ชื่อสาธารณะของติวเตอร์',
  displayNameHint: 'นักเรียนและผู้เยี่ยมชมจะมองเห็นชื่อนี้',
  editEyebrow: 'บัญชี',
  editTitle: 'แก้ไขโปรไฟล์',
  experienceYears: 'จำนวนปีที่มีประสบการณ์สอน',
  firstName: 'ชื่อจริง',
  gradeLevel: 'ชั้นเรียน',
  lastName: 'นามสกุล',
  loadError: 'ไม่สามารถโหลดโปรไฟล์ได้',
  loading: 'กำลังโหลดโปรไฟล์…',
  nickname: 'ชื่อเล่น',
  onboardingEyebrow: 'ขั้นตอนสุดท้าย',
  onboardingTitle: 'กรอกข้อมูลโปรไฟล์',
  phone: 'เบอร์โทรศัพท์สำหรับกรณีฉุกเฉิน',
  phoneHint:
    'เป็นข้อมูลส่วนตัว ผู้ดูแลโครงการที่ได้รับอนุญาตจะใช้เฉพาะเหตุเร่งด่วนเกี่ยวกับชั้นเรียน ความปลอดภัย หรือการให้บริการ',
  save: 'บันทึกการเปลี่ยนแปลง',
  saveError: 'ไม่สามารถบันทึกโปรไฟล์ได้',
  saving: 'กำลังบันทึก…',
  school: 'โรงเรียน',
  signOut: 'ออกจากระบบ',
  subtitle: 'กรุณากรอกข้อมูลให้ถูกต้อง คุณสามารถกลับมาแก้ไขได้ภายหลังจากแดชบอร์ด',
  updatedNotice:
    'ประกาศความเป็นส่วนตัวมีการปรับปรุง เนื่องจากโปรไฟล์จะเก็บข้อมูลส่วนบุคคลเพิ่มขึ้น',
};
