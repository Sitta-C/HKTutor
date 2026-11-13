'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';

import { bookingCouponCopy } from '@/components/bookings/booking-coupon-copy';
import {
  getBookingCouponFailure,
  hasActiveBookingPayment,
  isFullCouponSettlement,
} from '@/components/bookings/booking-coupon-model';
import { BookingCouponStrip } from '@/components/bookings/booking-coupon-strip';
import { BookingDocketAmounts, BookingDocketTotal } from '@/components/bookings/booking-docket';
import { formatMoney } from '@/components/bookings/booking-ui';
import { studentBookingsCopy } from '@/components/bookings/student-bookings-copy';
import {
  applyBookingCoupon,
  createPromptPayPayment,
  getCurrentPayment,
  getMyBooking,
  removeBookingCoupon,
} from '@/lib/api/bookings';
import { ApiError } from '@/lib/api/error';
import { formatBangkokDateTime } from '@/lib/date-time';
import { useLanguage } from '@/lib/i18n';

import styles from './promptpay-payment-panel.module.css';
import bookingStyles from './student-bookings.module.css';

import type { BookingDetail, PaymentStatus, PromptPayPayment } from '@/lib/api/types';

const COPY = {
  th: {
    title: 'ชำระด้วย PromptPay',
    paid: 'ชำระแล้ว',
    unpaid: 'ยังไม่ชำระ',
    demo: 'โหมดทดสอบ ไม่มีการเรียกเก็บเงินจริง จำลองผลสำเร็จหรือล้มเหลวใน Omise Test Dashboard',
    create: 'สร้าง QR ทดสอบ',
    retry: 'สร้าง QR ทดสอบใหม่',
    busy: 'กำลังดำเนินการ…',
    refresh: 'ตรวจสถานะชำระเงิน',
    loading: 'กำลังตรวจสถานะชำระเงิน…',
    error: 'ยังยืนยันสถานะไม่ได้ กรุณาตรวจสถานะอีกครั้งก่อนทำรายการต่อ',
    qrError: 'โหลดรูป QR ไม่สำเร็จ กรุณาตรวจสถานะอีกครั้ง',
    pending: 'รอผลชำระเงิน ระบบจะตรวจสถานะให้อัตโนมัติ',
    creating: 'กำลังตรวจสอบรายการกับผู้ให้บริการ กรุณารอและตรวจสถานะ ห้ามสร้างรายการซ้ำ',
    uncertain: 'หากสถานะนี้ค้างอยู่ ให้ผู้ดูแลตรวจรายการใน Omise ก่อนปลดล็อกการชำระเงิน',
    FAILED: 'การชำระเงินไม่สำเร็จ สามารถสร้าง QR ใหม่ได้',
    EXPIRED: 'QR หมดอายุแล้ว สามารถสร้าง QR ใหม่ได้',
    unavailable: 'รอติวเตอร์ยืนยันการจองจึงจะชำระได้',
    notPayable: 'สถานะการจองนี้ไม่เปิดให้ชำระเงิน',
    amount: 'ยอดชำระ',
    reference: 'เลขอ้างอิง',
    paidAt: 'ชำระเมื่อ',
    expires: 'QR หมดอายุ',
    qrAlt: 'QR PromptPay สำหรับการชำระเงินทดสอบ',
    noValue: 'ไม่มีข้อมูล',
    cancel: 'ระหว่างรอผลชำระเงินจะยังยกเลิกการจองไม่ได้',
    zeroTitle: 'ยืนยันสิทธิ์ส่วนลด',
    zeroNotice: 'ยอดสุทธิ 0.00 บาท ยืนยันเพื่อใช้สิทธิ์ได้โดยไม่ต้องสร้าง QR',
    settle: 'ยืนยันยอด 0.00 บาท',
  },
  en: {
    title: 'Pay with PromptPay',
    paid: 'Paid',
    unpaid: 'Unpaid',
    demo: 'Test mode. No real money is collected. Simulate success or failure in the Omise Test Dashboard.',
    create: 'Create test QR',
    retry: 'Create another test QR',
    busy: 'Processing…',
    refresh: 'Check payment status',
    loading: 'Checking payment status…',
    error: 'Payment status is uncertain. Check the status again before continuing.',
    qrError: 'Could not load the QR image. Check the payment status again.',
    pending: 'Waiting for payment. Status updates automatically.',
    creating: 'Checking this attempt with the provider. Wait and check status before continuing.',
    uncertain:
      'If this status persists, ask an administrator to verify the Omise charge before unlocking payment.',
    FAILED: 'Payment failed. You can create another QR.',
    EXPIRED: 'The QR expired. You can create another QR.',
    unavailable: 'Wait for tutor confirmation before paying.',
    notPayable: 'This booking status does not allow payment.',
    amount: 'Amount',
    reference: 'Reference',
    paidAt: 'Paid at',
    expires: 'QR expires',
    qrAlt: 'PromptPay QR for test payment',
    noValue: 'Unavailable',
    cancel: 'Cancellation is unavailable while payment is in progress.',
    zeroTitle: 'Confirm coupon payment',
    zeroNotice: 'The total is THB 0.00. Confirm to use the coupon without creating a QR.',
    settle: 'Confirm THB 0.00',
  },
};

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const { language } = useLanguage();
  return (
    <span className={styles.badge} data-paid={status === 'PAID'}>
      {status === 'PAID' ? COPY[language].paid : COPY[language].unpaid}
    </span>
  );
}

export function PromptPayPaymentPanel({
  booking,
  onBookingChange,
  disabled = false,
  onSubmittingChange,
}: {
  booking: BookingDetail;
  onBookingChange: (booking: BookingDetail) => void;
  disabled?: boolean;
  onSubmittingChange?: (busy: boolean) => void;
}) {
  const { language, copy } = useLanguage();
  const text = COPY[language];
  const couponText = bookingCouponCopy[language];
  const [payment, setPayment] = useState<PromptPayPayment | null>(null);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState(false);
  const [qrError, setQrError] = useState(false);
  const [operation, setOperation] = useState<'apply' | 'remove' | 'pay' | null>(null);
  const [failure, setFailure] = useState<{ error: unknown; scope: 'coupon' | 'payment' } | null>(
    null,
  );
  const [checkedAt, setCheckedAt] = useState(0);
  const [reload, setReload] = useState(0);
  const gate = useRef<symbol | null>(null);
  const mounted = useRef(false);
  const busy = operation !== null;
  const failureMessage = failure ? getBookingCouponFailure(failure.error, couponText) : null;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (disabled) {
      return;
    }
    let active = true;
    let readToken: symbol | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    async function poll(): Promise<void> {
      if (!active) {
        return;
      }
      if (document.hidden || gate.current) {
        timer = setTimeout(() => {
          void poll();
        }, 5000);
        return;
      }
      const token = Symbol('payment-read');
      readToken = token;
      gate.current = token;
      try {
        const result = await getCurrentPayment(booking.id, controller.signal);
        const nextBooking = await getMyBooking(booking.id, controller.signal);
        if (!active) {
          return;
        }
        setPayment(result);
        setCheckedAt(Date.now());
        setVerified(true);
        setError(false);
        setFailure(null);
        onBookingChange(nextBooking);
        if (result.paymentPending) {
          timer = setTimeout(() => {
            void poll();
          }, 5000);
        }
      } catch {
        if (active) {
          setError(true);
          setVerified(false);
        }
      } finally {
        if (gate.current === token) {
          gate.current = null;
        }
      }
    }
    void poll();
    return () => {
      active = false;
      controller.abort();
      if (gate.current === readToken) {
        gate.current = null;
      }
      clearTimeout(timer);
    };
  }, [booking.id, disabled, onBookingChange, reload]);

  async function changeCoupon(code: string | null): Promise<void> {
    if (
      gate.current ||
      disabled ||
      busy ||
      !verified ||
      hasActiveBookingPayment(booking, payment) ||
      booking.status !== 'CONFIRMED' ||
      booking.paymentStatus === 'PAID' ||
      payment?.paymentStatus === 'PAID'
    ) {
      return;
    }
    const token = Symbol('coupon-change');
    gate.current = token;
    setOperation(code === null ? 'remove' : 'apply');
    setFailure(null);
    onSubmittingChange?.(true);
    try {
      const result =
        code === null
          ? await removeBookingCoupon(booking.id)
          : await applyBookingCoupon(booking.id, code);
      if (!mounted.current) {
        return;
      }
      // Commit only the authoritative mutation response; never calculate a client discount.
      onBookingChange({
        ...booking,
        coupon: result.coupon,
        currency: result.currency,
        subtotalAmount: result.subtotalAmount,
        discountAmount: result.discountAmount,
        netAmount: result.netAmount,
        paymentStatus: result.paymentStatus,
        paymentPending: result.paymentPending,
      });
      setVerified(false);
      setReload((value) => value + 1);
    } catch (caught) {
      if (mounted.current) {
        setFailure({ error: caught, scope: 'coupon' });
        if (getBookingCouponFailure(caught, couponText).requiresRefresh) {
          setVerified(false);
          setError(true);
        }
      }
    } finally {
      if (gate.current === token) {
        gate.current = null;
      }
      if (mounted.current) {
        setOperation(null);
        onSubmittingChange?.(false);
      }
    }
  }

  async function create(): Promise<void> {
    if (
      gate.current ||
      disabled ||
      busy ||
      !verified ||
      hasActiveBookingPayment(booking, payment) ||
      booking.status !== 'CONFIRMED' ||
      booking.paymentStatus === 'PAID' ||
      payment?.paymentStatus === 'PAID'
    ) {
      return;
    }
    const token = Symbol('payment-create');
    gate.current = token;
    setOperation('pay');
    setError(false);
    setFailure(null);
    onSubmittingChange?.(true);
    try {
      const result = await createPromptPayPayment(booking.id);
      const nextBooking = await getMyBooking(booking.id);
      if (!mounted.current) {
        return;
      }
      setPayment(result);
      setCheckedAt(Date.now());
      setVerified(true);
      setQrError(false);
      onBookingChange(nextBooking);
      setReload((value) => value + 1);
    } catch (caught) {
      if (mounted.current) {
        setVerified(false);
        setError(true);
        setFailure({ error: caught, scope: 'payment' });
      }
    } finally {
      if (gate.current === token) {
        gate.current = null;
      }
      if (mounted.current) {
        setOperation(null);
        onSubmittingChange?.(false);
      }
    }
  }

  const attempt = payment?.attempt;
  const paid = payment?.paymentStatus === 'PAID' || booking.paymentStatus === 'PAID';
  const pending = hasActiveBookingPayment(booking, payment);
  const canCreate = verified && !pending && !paid && booking.status === 'CONFIRMED';
  const zeroNet = isFullCouponSettlement(booking);
  const qrUrl =
    attempt?.status === 'PENDING' && attempt.expiresAt && Date.parse(attempt.expiresAt) > checkedAt
      ? attempt.qrCodeUrl
      : null;

  return (
    <div className={bookingStyles.paymentColumns}>
      <div className={bookingStyles.amountColumn}>
        <BookingCouponStrip
          booking={booking}
          disabled={disabled || busy || paid}
          pending={pending}
          verified={verified}
          operation={operation}
          error={failure?.scope === 'coupon' ? (failureMessage?.message ?? null) : null}
          onApply={changeCoupon}
          onRemove={() => changeCoupon(null)}
        />
        <div className={bookingStyles.detailAmounts}>
          <BookingDocketAmounts
            amounts={booking}
            text={copy.dashboard.booking}
            discountPercent={booking.coupon?.percent}
          />
        </div>
        <div className={bookingStyles.detailTotal}>
          <BookingDocketTotal
            amount={booking.netAmount}
            currency={booking.currency}
            label={studentBookingsCopy[language].amount}
          />
        </div>
        <p className={styles.help}>{couponText.authoritative}</p>
      </div>
      <section className={styles.panel} aria-labelledby="promptpay-heading" aria-busy={busy}>
        <div className={styles.heading}>
          <h2 id="promptpay-heading">{zeroNet && !paid ? text.zeroTitle : text.title}</h2>
          <PaymentStatusBadge status={paid ? 'PAID' : 'UNPAID'} />
        </div>
        <p className={styles.note}>{text.demo}</p>
        {error && (
          <p className={styles.error} role="alert">
            {failure?.scope === 'payment' &&
            failure.error instanceof ApiError &&
            failure.error.status < 500
              ? failureMessage?.message
              : text.error}
          </p>
        )}
        {!payment && !error && <p role="status">{text.loading}</p>}
        {paid ? (
          <dl className={styles.receipt}>
            <div>
              <dt>{text.amount}</dt>
              <dd>{formatMoney(booking.netAmount, booking.currency)}</dd>
            </div>
            <div>
              <dt>{text.reference}</dt>
              <dd>
                {payment?.reference ??
                  booking.paymentReference ??
                  booking.mockReference ??
                  text.noValue}
              </dd>
            </div>
            <div>
              <dt>{text.paidAt}</dt>
              <dd>
                {booking.paidAt ? formatBangkokDateTime(booking.paidAt, language) : text.noValue}
              </dd>
            </div>
          </dl>
        ) : pending ? (
          <>
            <p role="status" className={styles.notice}>
              {attempt?.status === 'CREATING' ? text.creating : text.pending}
            </p>
            {qrUrl && (
              <Image
                key={qrUrl}
                src={qrUrl}
                alt={text.qrAlt}
                width={240}
                height={240}
                unoptimized
                className={styles.qr}
                onError={() => setQrError(true)}
              />
            )}
            {qrError && (
              <p role="alert" className={styles.error}>
                {text.qrError}
              </p>
            )}
            <p>
              {text.amount}: {formatMoney(attempt?.amount ?? booking.netAmount, booking.currency)}
            </p>
            {attempt?.expiresAt && (
              <p className={styles.help}>
                {text.expires}: {formatBangkokDateTime(attempt.expiresAt, language)}
              </p>
            )}
            <p className={styles.help}>{text.cancel}</p>
            {attempt?.status === 'CREATING' && <p className={styles.help}>{text.uncertain}</p>}
          </>
        ) : booking.status === 'CONFIRMED' ? (
          <>
            {zeroNet && <p className={styles.notice}>{text.zeroNotice}</p>}
            {(attempt?.status === 'FAILED' || attempt?.status === 'EXPIRED') && (
              <p role="status" className={styles.notice}>
                {text[attempt.status]}
              </p>
            )}
            <button
              type="button"
              className={styles.ticket}
              disabled={!canCreate || disabled || busy}
              onClick={() => {
                void create();
              }}
            >
              <span className={styles.ticketLabel}>
                {busy ? text.busy : zeroNet ? text.settle : attempt ? text.retry : text.create}
              </span>
            </button>
          </>
        ) : (
          <p className={styles.notice}>
            {booking.status === 'PENDING' ? text.unavailable : text.notPayable}
          </p>
        )}
        <button
          type="button"
          className={styles.refresh}
          disabled={busy || disabled}
          onClick={() => {
            setVerified(false);
            setQrError(false);
            setReload((value) => value + 1);
          }}
        >
          {text.refresh}
        </button>
      </section>
    </div>
  );
}
