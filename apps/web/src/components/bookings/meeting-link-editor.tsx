'use client';

import { useEffect, useRef, useState } from 'react';

import { classDetailsCopy } from '@/components/bookings/class-details-copy';
import { isSafeMeetingUrl } from '@/components/bookings/class-details-model';
import { NotebookAction } from '@/components/ui/notebook-action';
import { useNotebookToast } from '@/components/ui/notebook-toast';
import { updateMeetingLink } from '@/lib/api/bookings';
import { ApiError } from '@/lib/api/error';
import { useLanguage } from '@/lib/i18n';

import styles from './class-details.module.css';

export function MeetingLinkEditor({
  bookingId,
  meetingUrl,
  onSaved,
  onUncertain,
  onBusyChange,
}: {
  bookingId: string;
  meetingUrl: string | null;
  onSaved: () => Promise<void>;
  onUncertain: (error: unknown) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const { language } = useLanguage();
  const text = classDetailsCopy[language];
  const toast = useNotebookToast();
  const [value, setValue] = useState(meetingUrl ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const gate = useRef(false);
  const active = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  useEffect(() => {
    if (error && !pending) {
      input.current?.focus();
    }
  }, [error, pending]);

  return (
    <form
      noValidate
      onSubmit={async (event) => {
        event.preventDefault();
        if (gate.current) {
          return;
        }
        const url = value.trim();
        setSuccess(false);
        if (!isSafeMeetingUrl(url)) {
          setError(text.invalid);
          toast.error(text.invalid);
          input.current?.focus();
          return;
        }
        gate.current = true;
        setPending(true);
        onBusyChange(true);
        setError(null);
        try {
          await updateMeetingLink(bookingId, url);
          if (!active.current) {
            return;
          }
          // A fresh GET also checks current ownership and status after the write.
          setSuccess(true);
          toast.success(text.success);
          await onSaved();
        } catch (caught: unknown) {
          if (!active.current) {
            return;
          }
          const message =
            caught instanceof ApiError && caught.status === 403
              ? text.forbidden
              : caught instanceof ApiError && caught.status === 404
                ? text.notFound
                : caught instanceof ApiError && caught.status === 409
                  ? text.conflict
                  : caught instanceof ApiError && caught.status === 400
                    ? text.invalid
                    : text.uncertain;
          toast.error(message);
          if (caught instanceof ApiError && caught.status === 400) {
            setError(message);
            input.current?.focus();
          } else {
            onUncertain(caught);
          }
        } finally {
          gate.current = false;
          onBusyChange(false);
          if (active.current) {
            setPending(false);
          }
        }
      }}
      aria-busy={pending}
    >
      <label htmlFor="class-meeting-url">{text.label}</label>
      <input
        ref={input}
        id="class-meeting-url"
        type="url"
        value={value}
        disabled={pending}
        aria-invalid={Boolean(error)}
        aria-describedby={`class-meeting-help${error ? ' class-meeting-error' : ''}`}
        onChange={(event) => {
          setValue(event.target.value);
          setSuccess(false);
        }}
      />
      <p id="class-meeting-help" className={styles.note}>
        {text.help}
      </p>
      {error && (
        <p id="class-meeting-error" role="alert">
          {error}
        </p>
      )}
      {success && <p role="status">{text.success}</p>}
      <NotebookAction type="submit" disabled={pending} size="compact">
        {pending ? text.saving : text.save}
      </NotebookAction>
    </form>
  );
}
