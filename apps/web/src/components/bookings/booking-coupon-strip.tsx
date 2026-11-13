'use client';

import { useEffect, useId, useRef, useState } from 'react';

import { bookingCouponCopy } from '@/components/bookings/booking-coupon-copy';
import {
  isBookingCouponCodeValid,
  normalizeBookingCouponCode,
} from '@/components/bookings/booking-coupon-model';
import { NotebookAction } from '@/components/ui/notebook-action';
import { useLanguage } from '@/lib/i18n';

import styles from './booking-coupon-strip.module.css';

import type { BookingDetail } from '@/lib/api/types';
import type { FormEvent } from 'react';

export function BookingCouponStrip({
  booking,
  disabled,
  pending,
  verified,
  verificationFailed,
  operation,
  error,
  onApply,
  onRemove,
}: {
  booking: BookingDetail;
  disabled: boolean;
  pending: boolean;
  verified: boolean;
  verificationFailed: boolean;
  operation: 'apply' | 'remove' | 'pay' | null;
  error: string | null;
  onApply: (code: string) => Promise<boolean>;
  onRemove: () => Promise<boolean>;
}) {
  const { language } = useLanguage();
  const text = bookingCouponCopy[language];
  const fieldId = useId();
  const [code, setCode] = useState('');
  const [invalid, setInvalid] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const removeOrigin = useRef<HTMLButtonElement | null>(null);
  const [focusRevision, setFocusRevision] = useState(0);
  const coupon = booking.coupon;
  const paid = booking.paymentStatus === 'PAID';
  const eligible = booking.status === 'CONFIRMED' && !paid;
  const locked = disabled || pending || !verified || !eligible;
  const message = invalid ? text.invalid : error;

  useEffect(() => {
    const trigger = removeOrigin.current;
    removeOrigin.current = null;
    if (
      trigger &&
      !locked &&
      !coupon &&
      (document.activeElement === trigger || document.activeElement === document.body)
    ) {
      input.current?.focus();
    }
  }, [focusRevision, locked, coupon]);

  if (!eligible && !coupon) {
    return null;
  }

  async function apply(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (locked) {
      return;
    }
    if (!isBookingCouponCodeValid(code)) {
      setInvalid(true);
      input.current?.focus();
      return;
    }
    setInvalid(false);
    await onApply(normalizeBookingCouponCode(code));
  }

  async function remove(trigger: HTMLButtonElement): Promise<void> {
    setCode('');
    setInvalid(false);
    const removed = await onRemove();
    if (!removed) {
      return;
    }
    // Focus after React commits the unlocked input, only for this successful remove.
    removeOrigin.current = trigger;
    setFocusRevision((value) => value + 1);
  }

  return (
    <section className={styles.strip} aria-label={text.title} aria-busy={operation !== null}>
      {coupon ? (
        <div className={styles.applied}>
          <div className={styles.appliedRow}>
            <span className={styles.code}>{coupon.code}</span>
            {eligible && (
              <button
                type="button"
                className={styles.remove}
                disabled={locked}
                onClick={(event) => void remove(event.currentTarget)}
              >
                {operation === 'remove' ? text.removing : text.remove}
              </button>
            )}
          </div>
          <p className={styles.help} role="status">
            {(paid ? text.consumed : eligible ? text.applied : text.recorded).replace(
              '{percent}',
              String(coupon.percent),
            )}
          </p>
        </div>
      ) : (
        <form onSubmit={(event) => void apply(event)} noValidate>
          <label htmlFor={fieldId} className={styles.label}>
            {text.title}
          </label>
          <div className={styles.inputRow}>
            <input
              id={fieldId}
              ref={input}
              value={code}
              onChange={(event) => {
                setCode(event.target.value);
                setInvalid(false);
              }}
              className={styles.input}
              placeholder={text.placeholder}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              disabled={locked}
              aria-invalid={Boolean(message)}
              aria-describedby={message ? `${fieldId}-error` : undefined}
            />
            <NotebookAction type="submit" tone="secondary" role="student" disabled={locked}>
              {operation === 'apply' ? text.applying : text.apply}
            </NotebookAction>
          </div>
        </form>
      )}
      {message && (
        <p id={`${fieldId}-error`} className={styles.error} role="alert">
          {message}
        </p>
      )}
      {eligible && (pending || verificationFailed) && (
        <p className={styles.help}>{pending ? text.locked : text.checking}</p>
      )}
      {eligible && <p className={styles.help}>{text.usage}</p>}
    </section>
  );
}
