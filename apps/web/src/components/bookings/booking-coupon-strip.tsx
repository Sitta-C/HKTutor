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
  operation,
  error,
  onApply,
  onRemove,
}: {
  booking: BookingDetail;
  disabled: boolean;
  pending: boolean;
  verified: boolean;
  operation: 'apply' | 'remove' | 'pay' | null;
  error: string | null;
  onApply: (code: string) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const { language } = useLanguage();
  const text = bookingCouponCopy[language];
  const fieldId = useId();
  const [code, setCode] = useState('');
  const [invalid, setInvalid] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const hadCoupon = useRef(Boolean(booking.coupon));
  const coupon = booking.coupon;
  const paid = booking.paymentStatus === 'PAID';
  const eligible = booking.status === 'CONFIRMED' && !paid;
  const locked = disabled || pending || !verified || !eligible;
  const message = invalid ? text.invalid : error;

  useEffect(() => {
    if (coupon) {
      hadCoupon.current = true;
    } else if (hadCoupon.current && !locked) {
      input.current?.focus();
      hadCoupon.current = false;
    }
  }, [coupon, locked]);

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
                onClick={() => {
                  setCode('');
                  setInvalid(false);
                  void onRemove();
                }}
              >
                {operation === 'remove' ? text.removing : text.remove}
              </button>
            )}
          </div>
          <p className={styles.help} role="status">
            {(paid ? text.consumed : text.applied).replace('{percent}', String(coupon.percent))}
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
      {eligible && (pending || !verified) && (
        <p className={styles.help}>{pending ? text.locked : text.checking}</p>
      )}
      {eligible && <p className={styles.help}>{text.usage}</p>}
    </section>
  );
}
