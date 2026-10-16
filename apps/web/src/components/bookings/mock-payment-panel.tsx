'use client';

import { useEffect, useRef, useState } from 'react';

import { formatMoney } from '@/components/bookings/booking-ui';
import { DashboardIcon } from '@/components/dashboard/dashboard-icon';
import { useNotebookToast } from '@/components/ui/notebook-toast';
import { createMockPayment, getMyBooking } from '@/lib/api/bookings';
import { ApiError } from '@/lib/api/error';
import { formatBangkokDateTime } from '@/lib/date-time';
import { useLanguage } from '@/lib/i18n';

import styles from './mock-payment-panel.module.css';

import type { BookingDetail, PaymentStatus } from '@/lib/api/types';
import type { FormEvent } from 'react';

const COPY = {
  th: {
    title: 'ชำระเงินจำลอง',
    paid: 'ชำระแล้ว',
    unpaid: 'ยังไม่ชำระ',
    demo: 'เพื่อการสาธิตเท่านั้น ไม่มีการเรียกเก็บเงินจริง',
    reference: 'รหัสอ้างอิงจำลอง',
    help: 'รหัสต้องไม่ซ้ำกับการจองอื่น และยาวไม่เกิน 64 ตัวอักษร',
    amount: 'ยอดที่บันทึก',
    paidAt: 'บันทึกเมื่อ',
    submit: 'บันทึกการชำระจำลอง',
    submitting: 'กำลังบันทึก…',
    refresh: 'โหลดสถานะล่าสุด',
    refreshing: 'กำลังโหลด…',
    success: 'บันทึกการชำระเงินจำลองสำเร็จ',
    blank: 'กรุณาระบุรหัสอ้างอิงจำลอง',
    invalid: 'รหัสต้องเป็นข้อความบรรทัดเดียว และยาวไม่เกิน 64 ตัวอักษร',
    duplicate: 'รหัสนี้ถูกใช้แล้ว กรุณาเปลี่ยนรหัสแล้วลองอีกครั้ง',
    amountChanged: 'ยอดชำระเปลี่ยนไป กรุณาโหลดสถานะล่าสุดและตรวจยอดก่อนส่งอีกครั้ง',
    alreadyPaid: 'รายการนี้ชำระแล้ว กรุณาโหลดสถานะล่าสุด',
    conflict: 'สถานะการจองเปลี่ยนไป กรุณาโหลดสถานะล่าสุด',
    forbidden: 'คุณไม่มีสิทธิ์ชำระเงินสำหรับการจองนี้',
    missing: 'ไม่พบการจองนี้',
    session: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่',
    uncertain: 'ยังยืนยันผลไม่ได้ กรุณาโหลดสถานะล่าสุดก่อนส่งอีกครั้ง',
    refreshFailed: 'โหลดสถานะไม่สำเร็จ กรุณาลองโหลดใหม่',
    validation: 'ข้อมูลชำระเงินไม่ถูกต้อง กรุณาตรวจรหัสอ้างอิง',
    pending: 'รอติวเตอร์ยืนยันการจอง จึงจะชำระเงินจำลองได้',
    notPayable: 'สถานะการจองนี้ไม่เปิดให้ชำระเงินจำลอง',
    unavailable: 'ยังไม่มีข้อมูลสถานะชำระเงิน กรุณาโหลดสถานะล่าสุด',
    locked: 'ตรวจสถานะล่าสุดก่อนทำรายการต่อ',
    unavailableValue: 'ไม่มีข้อมูล',
  },
  en: {
    title: 'Mock payment',
    paid: 'Paid',
    unpaid: 'Unpaid',
    demo: 'For demonstration only. No real payment is collected.',
    reference: 'Demo reference',
    help: 'Use a unique reference of up to 64 characters.',
    amount: 'Recorded amount',
    paidAt: 'Recorded at',
    submit: 'Record mock payment',
    submitting: 'Recording…',
    refresh: 'Load latest status',
    refreshing: 'Loading…',
    success: 'Mock payment recorded successfully.',
    blank: 'Enter a demo reference.',
    invalid: 'Use single-line text of up to 64 characters.',
    duplicate: 'This reference is already used. Enter another reference.',
    amountChanged:
      'The amount changed. Load the latest status and check it before submitting again.',
    alreadyPaid: 'This booking is already paid. Load the latest status.',
    conflict: 'The booking changed. Load the latest status.',
    forbidden: 'You cannot pay for this booking.',
    missing: 'Booking not found.',
    session: 'Your session expired. Sign in again.',
    uncertain: 'The result is uncertain. Load the latest status before submitting again.',
    refreshFailed: 'Could not load the latest status. Try loading again.',
    validation: 'Invalid payment details. Check the reference.',
    pending: 'Wait for tutor confirmation before recording a mock payment.',
    notPayable: 'This booking status does not allow a mock payment.',
    unavailable: 'Payment status is unavailable. Load the latest status.',
    locked: 'Check the latest status before continuing.',
    unavailableValue: 'Unavailable',
  },
};

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const { language } = useLanguage();
  const text = COPY[language];
  if (status !== 'PAID' && status !== 'UNPAID') {
    return <span className={styles.note}>{text.unavailable}</span>;
  }
  return (
    <span className={styles.badge} data-paid={status === 'PAID'}>
      {status === 'PAID' ? text.paid : text.unpaid}
    </span>
  );
}

function paymentErrorCode(error: unknown): string | null {
  if (
    error instanceof ApiError &&
    typeof error.details === 'object' &&
    error.details !== null &&
    'code' in error.details &&
    typeof error.details.code === 'string'
  ) {
    return error.details.code;
  }
  return null;
}

export function MockPaymentPanel({
  booking,
  onBookingChange,
  disabled = false,
  onSubmittingChange,
}: {
  booking: BookingDetail;
  onBookingChange: (nextBooking: BookingDetail) => void;
  disabled?: boolean;
  onSubmittingChange?: (submitting: boolean) => void;
}) {
  const { language } = useLanguage();
  const text = COPY[language];
  const toast = useNotebookToast();
  const [reference, setReference] = useState('');
  const [errorKey, setErrorKey] = useState<keyof typeof COPY.th | null>(null);
  const [activity, setActivity] = useState<'idle' | 'sending' | 'refreshing'>('idle');
  const [locked, setLocked] = useState(false);
  const gate = useRef(false);
  const mounted = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const isPaid = booking.paymentStatus === 'PAID';
  const isUnpaid = booking.paymentStatus === 'UNPAID';
  const canPay = booking.status === 'CONFIRMED' && isUnpaid;
  const busy = activity !== 'idle' || disabled;
  const referenceError = errorKey === 'blank' || errorKey === 'invalid' || errorKey === 'duplicate';

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (referenceError && !busy) {
      inputRef.current?.focus();
    }
  }, [referenceError, busy]);

  function showError(key: keyof typeof COPY.th): void {
    setErrorKey(key);
    toast.error(text[key]);
  }

  async function refreshBooking(): Promise<void> {
    if (gate.current || disabled) {
      return;
    }
    gate.current = true;
    setActivity('refreshing');
    try {
      const nextBooking = await getMyBooking(booking.id);
      if (!mounted.current) {
        return;
      }
      onBookingChange(nextBooking);
      setLocked(false);
      setErrorKey(null);
    } catch {
      if (mounted.current) {
        showError('refreshFailed');
      }
    } finally {
      gate.current = false;
      if (mounted.current) {
        setActivity('idle');
      }
    }
  }

  async function submitPayment(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (gate.current || disabled || locked || !canPay) {
      return;
    }
    const trimmed = reference.trim();
    if (!trimmed) {
      showError('blank');
      inputRef.current?.focus();
      return;
    }
    if ([...trimmed].length > 64 || !/^\P{C}+$/u.test(trimmed)) {
      showError('invalid');
      inputRef.current?.focus();
      return;
    }

    gate.current = true;
    setActivity('sending');
    onSubmittingChange?.(true);
    setErrorKey(null);
    try {
      const result = await createMockPayment(booking.id, {
        amount: booking.netAmount,
        reference: trimmed,
      });
      if (!mounted.current) {
        return;
      }
      if (result.bookingId !== booking.id || result.paymentStatus !== 'PAID') {
        setLocked(true);
        showError('uncertain');
        return;
      }
      // Display only the payment fields persisted and returned by the server.
      onBookingChange({
        ...booking,
        paymentStatus: result.paymentStatus,
        paidAt: result.paidAt,
        mockReference: result.reference,
        netAmount: result.amount,
      });
      toast.success(text.success);
    } catch (error: unknown) {
      if (!mounted.current) {
        return;
      }
      const code = paymentErrorCode(error);
      if (code === 'MOCK_REFERENCE_TAKEN') {
        showError('duplicate');
      } else if (code === 'BOOKING_PAYMENT_AMOUNT_MISMATCH') {
        setLocked(true);
        showError('amountChanged');
      } else if (code === 'BOOKING_ALREADY_PAID') {
        setLocked(true);
        showError('alreadyPaid');
      } else if (error instanceof ApiError && error.status === 400) {
        showError('validation');
      } else {
        // Network/server errors may follow a committed payment. Never retry the POST automatically.
        setLocked(true);
        showError(
          error instanceof ApiError && error.status === 401
            ? 'session'
            : error instanceof ApiError && error.status === 403
              ? 'forbidden'
              : error instanceof ApiError && error.status === 404
                ? 'missing'
                : error instanceof ApiError && error.status === 409
                  ? 'conflict'
                  : 'uncertain',
        );
      }
    } finally {
      gate.current = false;
      onSubmittingChange?.(false);
      if (mounted.current) {
        setActivity('idle');
      }
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="mock-payment-heading" aria-busy={busy}>
      <div className={styles.heading}>
        <h2 id="mock-payment-heading">{text.title}</h2>
        {(isPaid || isUnpaid) && <PaymentStatusBadge status={booking.paymentStatus} />}
      </div>
      <p className={styles.note}>{text.demo}</p>
      {errorKey && (
        <p className={styles.error} role="alert" id="mock-payment-error">
          {text[errorKey]}
        </p>
      )}
      {isPaid ? (
        <dl className={styles.receipt}>
          <div>
            <dt>{text.amount}</dt>
            <dd>{formatMoney(booking.netAmount, booking.currency)}</dd>
          </div>
          <div>
            <dt>{text.reference}</dt>
            <dd>{booking.mockReference ?? text.unavailableValue}</dd>
          </div>
          <div>
            <dt>{text.paidAt}</dt>
            <dd>
              {booking.paidAt
                ? formatBangkokDateTime(booking.paidAt, language)
                : text.unavailableValue}
            </dd>
          </div>
        </dl>
      ) : !isUnpaid ? (
        <p className={styles.note}>{text.unavailable}</p>
      ) : !canPay ? (
        <p className={styles.notice}>
          {booking.status === 'PENDING' ? text.pending : text.notPayable}
        </p>
      ) : (
        <form
          onSubmit={(event) => {
            void submitPayment(event);
          }}
          noValidate
        >
          <label className={styles.label} htmlFor="mock-payment-reference">
            {text.reference}
          </label>
          <input
            ref={inputRef}
            id="mock-payment-reference"
            className={styles.input}
            value={reference}
            onChange={(event) => {
              setReference(event.target.value);
              if (referenceError) {
                setErrorKey(null);
              }
            }}
            disabled={busy || locked}
            autoComplete="off"
            placeholder="DEMO-0001"
            aria-invalid={referenceError}
            aria-describedby={`mock-payment-help${referenceError ? ' mock-payment-error' : ''}`}
          />
          <p className={styles.help} id="mock-payment-help">
            {text.help}
          </p>
          <button type="submit" className={styles.ticket} disabled={busy || locked}>
            <span className={styles.ticketLabel}>
              {activity === 'sending' ? text.submitting : text.submit}
            </span>
            <span className={styles.ticketStub} aria-hidden="true">
              <DashboardIcon name="check" className="h-4 w-4" />
            </span>
          </button>
        </form>
      )}
      {locked && <p className={styles.help}>{text.locked}</p>}
      <button
        type="button"
        className={styles.refresh}
        disabled={busy}
        onClick={() => {
          void refreshBooking();
        }}
      >
        {activity === 'refreshing' ? text.refreshing : text.refresh}
      </button>
    </section>
  );
}
