'use client';

import { useEffect, useRef, useState } from 'react';

import { DashboardIcon } from '@/components/dashboard/dashboard-icon';
import { ProfileAvatar } from '@/components/profile/profile-avatar';
import { NotebookAction } from '@/components/ui/notebook-action';
import { useNotebookToast } from '@/components/ui/notebook-toast';
import { ApiError } from '@/lib/api/error';
import { deleteAvatar, uploadAvatar } from '@/lib/api/profiles';
import { validateAvatarFile } from '@/lib/avatar';
import { updateCurrentProfileAvatar } from '@/lib/current-profile';

import styles from './avatar-editor.module.css';

const copy = {
  th: {
    title: 'รูปโปรไฟล์',
    portrait: 'เติมตัวตนลงในหน้าสมุด',
    caption: 'this is me',
    student: 'นักเรียน',
    tutor: 'ติวเตอร์',
    hint: 'JPEG, PNG หรือ WebP ไม่เกิน 2 MiB · ไม่บังคับ',
    studentPrivacy: 'รูปนี้แสดงเฉพาะในพื้นที่ส่วนตัวของคุณ',
    tutorPrivacy: 'รูปนี้แสดงบนโปรไฟล์สาธารณะเมื่อบัญชีผ่านเงื่อนไขการเผยแพร่',
    choose: 'เลือกรูป',
    upload: 'อัปโหลดรูป',
    remove: 'ลบรูป',
    cancel: 'ยกเลิกการเลือกรูป',
    pending: 'กำลังบันทึกรูป…',
    saved: 'บันทึกรูปโปรไฟล์แล้ว',
    deleted: 'ลบรูปโปรไฟล์แล้ว',
    separate: 'รูปโปรไฟล์บันทึกแยกจากข้อมูลในแบบฟอร์ม',
    sizeError: 'เลือกรูปที่มีขนาดมากกว่า 0 และไม่เกิน 2 MiB',
    typeError: 'รองรับเฉพาะ JPEG, PNG และ WebP',
    invalidError: 'รูปไม่ถูกต้อง รองรับภาพนิ่งไม่เกิน 16 ล้านพิกเซล',
    error: 'บันทึกรูปไม่สำเร็จ กรุณาลองอีกครั้ง',
  },
  en: {
    title: 'Profile photo',
    portrait: 'Add yourself to your notebook',
    caption: 'this is me',
    student: 'Student',
    tutor: 'Tutor',
    hint: 'JPEG, PNG or WebP, up to 2 MiB · Optional',
    studentPrivacy: 'This photo appears only in your private account area.',
    tutorPrivacy: 'This photo appears on your public profile when your account is eligible.',
    choose: 'Choose photo',
    upload: 'Upload photo',
    remove: 'Remove photo',
    cancel: 'Cancel photo selection',
    pending: 'Saving photo…',
    saved: 'Profile photo saved.',
    deleted: 'Profile photo removed.',
    separate: 'Your photo is saved separately from the profile form.',
    sizeError: 'Choose a non-empty photo no larger than 2 MiB.',
    typeError: 'Only JPEG, PNG and WebP are supported.',
    invalidError: 'Invalid photo. Use a static image up to 16 megapixels.',
    error: 'Could not save your photo. Please try again.',
  },
};

export function AvatarEditor({
  userId,
  name,
  role,
  language,
  avatarUpdatedAt,
  onChanged,
  disabled = false,
}: {
  userId: string;
  name: string;
  role: 'student' | 'tutor';
  language: 'th' | 'en';
  avatarUpdatedAt: string | null;
  onChanged: (updatedAt: string | null) => void;
  disabled?: boolean;
}) {
  const text = copy[language];
  const toast = useNotebookToast();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (preview) {
      return () => URL.revokeObjectURL(preview);
    }
    return undefined;
  }, [preview]);

  const reset = () => {
    setFile(null);
    setPreview(null);
    if (input.current) {
      input.current.value = '';
    }
  };
  const save = async (remove: boolean) => {
    if (pending || disabled || (!remove && !file)) {
      return;
    }
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const result = remove ? await deleteAvatar() : file ? await uploadAvatar(file) : null;
      if (!result) {
        return;
      }
      updateCurrentProfileAvatar(userId, result.avatarUpdatedAt);
      onChanged(result.avatarUpdatedAt);
      reset();
      setNotice(remove ? text.deleted : text.saved);
      toast.success(remove ? text.deleted : text.saved);
    } catch (caught) {
      const message =
        caught instanceof ApiError && caught.status === 413
          ? text.sizeError
          : caught instanceof ApiError && caught.status === 400
            ? text.invalidError
            : text.error;
      setError(message);
      toast.error(message);
    } finally {
      setPending(false);
    }
  };

  return (
    <section className={styles.editor} data-role={role} aria-labelledby="avatar-title">
      <header className={styles.header}>
        <h3 id="avatar-title" className={styles.title}>
          {text.title}
        </h3>
        <span className={styles.role}>{role === 'student' ? text.student : text.tutor}</span>
      </header>
      <div className={styles.inner}>
        <div className={styles.body}>
          <figure className={styles.stamp}>
            <div className={styles.wash}>
              <ProfileAvatar
                name={name}
                fallback={name.charAt(0).toUpperCase() || (role === 'student' ? 'S' : 'T')}
                ownerUserId={userId}
                avatarUpdatedAt={avatarUpdatedAt}
                imageUrl={file ? preview : null}
                sizes="80px"
                className={styles.avatar ?? ''}
              />
            </div>
            <figcaption className="font-note" lang="en">
              {text.caption}
            </figcaption>
          </figure>
          <div className={styles.copy}>
            <p className={styles.portrait}>{text.portrait}</p>
            <p className={styles.privacy}>
              {role === 'student' ? text.studentPrivacy : text.tutorPrivacy}
            </p>
            <p id="avatar-hint" className={styles.hint}>
              {text.hint}
            </p>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.choose}
                disabled={pending || disabled}
                onClick={() => input.current?.click()}
              >
                <span className={styles.brush} aria-hidden="true" />
                {text.choose}
              </button>
              {file && (
                <NotebookAction
                  type="button"
                  role={role}
                  icon={<DashboardIcon name="check" />}
                  disabled={pending || disabled}
                  aria-busy={pending}
                  onClick={() => void save(false)}
                >
                  {pending ? text.pending : text.upload}
                </NotebookAction>
              )}
              {file ? (
                <NotebookAction
                  type="button"
                  role={role}
                  tone="secondary"
                  disabled={pending || disabled}
                  onClick={reset}
                >
                  {text.cancel}
                </NotebookAction>
              ) : (
                avatarUpdatedAt && (
                  <NotebookAction
                    type="button"
                    role={role}
                    tone="quiet"
                    icon={<DashboardIcon name="trash" />}
                    disabled={pending || disabled}
                    onClick={() => void save(true)}
                  >
                    {pending ? text.pending : text.remove}
                  </NotebookAction>
                )
              )}
            </div>
            <input
              ref={input}
              type="file"
              className="sr-only"
              tabIndex={-1}
              aria-label={text.choose}
              aria-describedby="avatar-hint"
              accept="image/jpeg,image/png,image/webp"
              disabled={pending || disabled}
              onChange={(event) => {
                const selected = event.target.files?.[0];
                if (!selected) {
                  return;
                }
                const invalid = validateAvatarFile(selected);
                setNotice(null);
                if (invalid) {
                  reset();
                  const message = invalid === 'size' ? text.sizeError : text.typeError;
                  setError(message);
                  toast.error(message);
                  return;
                }
                setError(null);
                setFile(selected);
                setPreview(URL.createObjectURL(selected));
              }}
            />
            {file && <p className="mt-2 break-all text-xs text-notebook-muted">{file.name}</p>}
          </div>
        </div>
        <p className={styles.footer}>{text.separate}</p>
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-700">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="mt-3 text-sm text-emerald-800">
            {notice}
          </p>
        )}
      </div>
      <div className={styles.ruler} aria-hidden="true" />
    </section>
  );
}
