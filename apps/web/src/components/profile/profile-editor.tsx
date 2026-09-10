'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

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

interface ProfileCopy {
  accountEmail: string;
  about: string;
  back: string;
  bio: string;
  bioHint: string;
  cancel: string;
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
  newListing: string;
  noReviews: string;
  onboardingEyebrow: string;
  onboardingTitle: string;
  overview: string;
  phone: string;
  phoneHint: string;
  previewHint: string;
  previewTitle: string;
  profileDetails: string;
  profileDetailsHint: string;
  profileTitle: string;
  profileSubtitle: string;
  privacy: string;
  rating: string;
  reviews: string;
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
  const [saved, setSaved] = useState(false);
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

    setError(null);
    setConsentError(null);
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
          {user.role === 'TUTOR' && (
            <Link href="/dashboard/listings/new" className="profile-primary-action">
              + {copy.newListing}
            </Link>
          )}
        </div>

        <nav className="profile-tabs" aria-label={copy.profileTitle}>
          <a className="profile-tab profile-tab-active" href="#overview" aria-current="page">
            {copy.overview}
          </a>
          {user.role === 'TUTOR' && (
            <Link className="profile-tab" href="/dashboard/listings">
              {copy.teaching}
            </Link>
          )}
          <a className="profile-tab" href="#privacy">
            {copy.privacy}
          </a>
        </nav>

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
                  <span aria-hidden="true">✉</span>
                  <span>
                    <strong>{copy.accountEmail}</strong>
                    {user.email}
                  </span>
                </div>
                <div className="profile-summary-item">
                  <span aria-hidden="true">✓</span>
                  <span>
                    <strong>{copy.verification}</strong>
                    {verificationLabel}
                  </span>
                </div>
                {user.role === 'TUTOR' && (
                  <>
                    <div className="profile-summary-item">
                      <span aria-hidden="true">★</span>
                      <span>
                        <strong>{copy.rating}</strong>
                        {profileSummary?.ratingAverage && profileSummary.reviewCount > 0
                          ? `${profileSummary.ratingAverage} / 5`
                          : copy.noReviews}
                      </span>
                    </div>
                    <div className="profile-summary-item">
                      <span aria-hidden="true">▤</span>
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

            <form onSubmit={handleSubmit}>
              {consentCurrent &&
                (user.role === 'STUDENT' ? (
                  <StudentFields data={student} copy={copy} onChange={setStudent} />
                ) : (
                  <TutorFields data={tutor} copy={copy} onChange={setTutor} />
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
          maxLength={60}
          value={data.displayName}
          onChange={(event) => onChange({ ...data, displayName: event.target.value })}
          className={fieldClass}
        />
      </Field>
      <Field label={copy.bio} hint={`${copy.bioHint} ${data.bio.length}/500`}>
        <textarea
          required
          minLength={20}
          maxLength={500}
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
          max={80}
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
  accountEmail: 'Account email',
  about: 'About',
  back: 'Back to dashboard',
  bio: 'Biography',
  bioHint: '20–500 characters.',
  cancel: 'Cancel',
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
  newListing: 'New listing',
  noReviews: 'New tutor',
  onboardingEyebrow: 'One last step',
  onboardingTitle: 'Complete your profile',
  overview: 'Overview',
  phone: 'Emergency telephone number',
  phoneHint:
    'Private. Used by authorised project administrators only for urgent class, safety, or service incidents.',
  previewHint: 'This is the information students can see on your HKTutor profile.',
  previewTitle: 'Student view',
  privacy: 'Privacy',
  profileDetails: 'Profile information',
  profileDetailsHint: 'Keep your public information clear and up to date.',
  profileSubtitle: 'Manage what students see and tell them how you can help.',
  profileTitle: 'Profile',
  rating: 'Rating',
  reviews: 'Reviews',
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
  bioHint: '20–500 ตัวอักษร',
  cancel: 'ยกเลิก',
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
  newListing: 'สร้างประกาศสอน',
  noReviews: 'ติวเตอร์ใหม่',
  onboardingEyebrow: 'ขั้นตอนสุดท้าย',
  onboardingTitle: 'กรอกข้อมูลโปรไฟล์',
  overview: 'ภาพรวม',
  phone: 'เบอร์โทรศัพท์สำหรับกรณีฉุกเฉิน',
  phoneHint:
    'เป็นข้อมูลส่วนตัว ผู้ดูแลโครงการที่ได้รับอนุญาตจะใช้เฉพาะเหตุเร่งด่วนเกี่ยวกับชั้นเรียน ความปลอดภัย หรือการให้บริการ',
  previewHint: 'ข้อมูลนี้คือสิ่งที่นักเรียนจะเห็นบนโปรไฟล์ HKTutor ของคุณ',
  previewTitle: 'มุมมองนักเรียน',
  privacy: 'ความเป็นส่วนตัว',
  profileDetails: 'ข้อมูลโปรไฟล์',
  profileDetailsHint: 'กรอกข้อมูลที่นักเรียนเข้าใจง่ายและอัปเดตให้เป็นปัจจุบัน',
  profileSubtitle: 'จัดการข้อมูลที่นักเรียนเห็น และบอกให้พวกเขารู้ว่าคุณช่วยอะไรได้บ้าง',
  profileTitle: 'โปรไฟล์',
  rating: 'คะแนน',
  reviews: 'รีวิว',
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
