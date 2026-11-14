'use client';

import { useState } from 'react';

import { bookingCouponCopy } from '@/components/bookings/booking-coupon-copy';
import { getBookingPaymentFailure } from '@/components/bookings/booking-coupon-model';
import { formatBookingDocketSlot } from '@/components/bookings/booking-docket-model';
import { formatMoney } from '@/components/bookings/booking-ui';
import { PromptPayQr } from '@/components/bookings/promptpay-qr';
import { DashboardIcon } from '@/components/dashboard/dashboard-icon';
import { NotebookAction } from '@/components/ui/notebook-action';
import { NotebookConfirmDialog } from '@/components/ui/notebook-confirm-dialog';
import { formatBangkokDateTime } from '@/lib/date-time';
import { useLanguage } from '@/lib/i18n';

import styles from './promptpay-payment-panel.module.css';

import type { BookingCheckout } from '@/components/bookings/use-booking-checkout';
import type { BookingDetail, PaymentStatus } from '@/lib/api/types';

const COPY = {
  th: {
    title: 'ชำระด้วย PromptPay',
    deadline: 'ต้องชำระเงินก่อนเริ่มเรียน',
    deadlinePassed: 'พ้นเส้นตายชำระเงินแล้ว ไม่สามารถเริ่มชำระเงินใหม่ได้',
    paid: 'ชำระแล้ว',
    unpaid: 'ยังไม่ชำระ',
    demo: 'โหมดทดสอบ ไม่มีการเรียกเก็บเงินจริง จำลองผลสำเร็จหรือล้มเหลวใน Omise Test Dashboard',
    create: 'สร้าง QR ทดสอบ',
    confirmTitle: 'ยืนยันเริ่มรายการชำระเงิน?',
    confirmHelp: 'ตรวจสอบยอดสุทธิและคอร์สก่อนดำเนินการ การสร้าง QR ยังไม่ถือว่าชำระเงินสำเร็จ',
    retry: 'สร้าง QR ทดสอบใหม่',
    busy: 'กำลังดำเนินการ…',
    refresh: 'ตรวจสถานะชำระเงิน',
    loading: 'กำลังตรวจสถานะชำระเงิน…',
    error: 'ยังยืนยันสถานะไม่ได้ กรุณาตรวจสถานะอีกครั้งก่อนทำรายการต่อ',
    qrError: 'โหลดรูป QR ไม่สำเร็จ กรุณาตรวจสถานะอีกครั้ง',
    pending: 'รอผลชำระเงิน ระบบจะตรวจสถานะให้อัตโนมัติ',
    pendingClosed: 'เริ่มเรียนแล้ว QR ปิดรับชำระเงิน ระบบกำลังตรวจผลรายการเดิม กรุณารอและตรวจสถานะ',
    creating: 'กำลังตรวจสอบรายการกับผู้ให้บริการ กรุณารอและตรวจสถานะ ห้ามสร้างรายการซ้ำ',
    uncertain: 'หากสถานะนี้ค้างอยู่ ให้ผู้ดูแลตรวจรายการใน Omise ก่อนปลดล็อกการชำระเงิน',
    FAILED: 'การชำระเงินไม่สำเร็จ สามารถสร้าง QR ใหม่ได้',
    EXPIRED: 'QR หมดอายุแล้ว สามารถสร้าง QR ใหม่ได้',
    unavailable: 'รอติวเตอร์ยืนยันการจองจึงจะชำระได้',
    notPayable: 'สถานะการจองนี้ไม่เปิดให้ชำระเงิน',
    amount: 'ยอดชำระ',
    reference: 'เลขอ้างอิง',
    paidAt: 'ชำระเมื่อ',
    noValue: 'ไม่มีข้อมูล',
    cancel: 'ระหว่างรอผลชำระเงินจะยังยกเลิกการจองไม่ได้',
    zeroTitle: 'ยืนยันสิทธิ์ส่วนลด',
    zeroNotice: 'ยอดสุทธิ 0.00 บาท ยืนยันเพื่อใช้สิทธิ์ได้โดยไม่ต้องสร้าง QR',
    settle: 'ยืนยันยอด 0.00 บาท',
    closedTitle: 'ปิดรับชำระเงินแล้ว',
    checkingTitle: 'กำลังตรวจผลรายการเดิม',
    pendingTitle: 'รายการชำระเงินกำลังดำเนินการ',
  },
  en: {
    title: 'Pay with PromptPay',
    deadline: 'Pay before the lesson starts',
    deadlinePassed: 'The payment deadline has passed. New payments are closed.',
    paid: 'Paid',
    unpaid: 'Unpaid',
    demo: 'Test mode. No real money is collected. Simulate success or failure in the Omise Test Dashboard.',
    create: 'Create test QR',
    confirmTitle: 'Start this payment?',
    confirmHelp:
      'Check the net amount and lesson before continuing. Creating a QR does not complete payment.',
    retry: 'Create another test QR',
    busy: 'Processing…',
    refresh: 'Check payment status',
    loading: 'Checking payment status…',
    error: 'Payment status is uncertain. Check the status again before continuing.',
    qrError: 'Could not load the QR image. Check the payment status again.',
    pending: 'Waiting for payment. Status updates automatically.',
    pendingClosed:
      'The lesson has started and the QR is closed. Checking the existing payment result; wait and check status.',
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
    noValue: 'Unavailable',
    cancel: 'Cancellation is unavailable while payment is in progress.',
    zeroTitle: 'Confirm coupon payment',
    zeroNotice: 'The total is THB 0.00. Confirm to use the coupon without creating a QR.',
    settle: 'Confirm THB 0.00',
    closedTitle: 'Payment window closed',
    checkingTitle: 'Checking the existing payment',
    pendingTitle: 'Payment in progress',
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
  checkout,
}: {
  booking: BookingDetail;
  checkout: BookingCheckout;
}) {
  const { language } = useLanguage();
  const text = COPY[language];
  const { payment, verification, failure, readFailed, operation, paid, pending, canPay, zeroNet } =
    checkout;
  const [qrError, setQrError] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const busy = operation !== null;
  const errorMessage =
    failure?.scope === 'payment'
      ? getBookingPaymentFailure(
          failure.error,
          bookingCouponCopy[language],
          text.error,
          Boolean(booking.coupon),
        )
      : readFailed
        ? text.error
        : null;
  const attempt = payment?.attempt;
  const qrUrl =
    attempt?.status === 'PENDING' && attempt.expiresAt && !checkout.deadlinePassed
      ? attempt.qrCodeUrl
      : null;

  return (
    <section
      className={styles.panel}
      aria-labelledby="promptpay-heading"
      aria-busy={busy}
      data-phase={paid ? 'paid' : pending ? 'pending' : checkout.deadlinePassed ? 'closed' : 'open'}
    >
      <div className={styles.heading}>
        <h2 id="promptpay-heading">{zeroNet && !paid ? text.zeroTitle : text.title}</h2>
        <PaymentStatusBadge status={paid ? 'PAID' : 'UNPAID'} />
      </div>
      <div className={styles.body}>
        {!paid && (
          <p className={styles.deadline}>
            <span>{text.deadline}</span>
            <strong>
              {formatBangkokDateTime(new Date(checkout.deadlineAt).toISOString(), language)}
            </strong>
          </p>
        )}
        {errorMessage && (
          <p className={styles.error} role="alert">
            {errorMessage}
          </p>
        )}
        {verification === 'checking' && <p role="status">{text.loading}</p>}
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
            <div className={styles.stateMessage}>
              <DashboardIcon name="clock" />
              <div>
                <h3>{checkout.deadlinePassed ? text.checkingTitle : text.pendingTitle}</h3>
                <p role="status" className={styles.notice}>
                  {checkout.deadlinePassed
                    ? text.pendingClosed
                    : attempt?.status === 'CREATING'
                      ? text.creating
                      : text.pending}
                </p>
              </div>
            </div>
            {qrUrl && attempt?.expiresAt && (
              <PromptPayQr
                key={`${attempt.id}:${attempt.expiresAt}`}
                url={qrUrl}
                expiresAt={attempt.expiresAt}
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
            <p className={styles.help}>{text.cancel}</p>
            {attempt?.status === 'CREATING' && <p className={styles.help}>{text.uncertain}</p>}
          </>
        ) : checkout.deadlinePassed ? (
          <div className={styles.stateMessage}>
            <DashboardIcon name="clock" />
            <div>
              <h3>{text.closedTitle}</h3>
              <p className={styles.notice}>{text.deadlinePassed}</p>
            </div>
          </div>
        ) : booking.status === 'CONFIRMED' ? (
          <>
            {zeroNet && <p className={styles.notice}>{text.zeroNotice}</p>}
            {(attempt?.status === 'FAILED' || attempt?.status === 'EXPIRED') && (
              <p role="status" className={styles.notice}>
                {text[attempt.status]}
              </p>
            )}
          </>
        ) : (
          <p className={styles.notice}>
            {booking.status === 'PENDING' ? text.unavailable : text.notPayable}
          </p>
        )}
      </div>
      <div className={styles.actions}>
        {!paid && !pending && !checkout.deadlinePassed && booking.status === 'CONFIRMED' && (
          <NotebookAction
            role="student"
            className={styles.createPayment}
            icon={<DashboardIcon name={zeroNet ? 'check' : attempt ? 'refresh' : 'arrow-right'} />}
            iconPosition="end"
            disabled={!canPay}
            onClick={() => {
              setConfirming(true);
            }}
          >
            {busy ? text.busy : zeroNet ? text.settle : attempt ? text.retry : text.create}
          </NotebookAction>
        )}
        <button
          type="button"
          className={styles.refresh}
          disabled={!checkout.canRefresh}
          onClick={() => {
            setQrError(false);
            checkout.refresh();
          }}
        >
          {text.refresh}
        </button>
      </div>
      <p className={styles.note}>{text.demo}</p>
      <NotebookConfirmDialog
        open={confirming}
        role="student"
        title={text.confirmTitle}
        description={zeroNet ? text.zeroNotice : text.confirmHelp}
        confirmLabel={zeroNet ? text.settle : text.create}
        busy={busy}
        disabled={!canPay}
        error={errorMessage}
        onCancel={() => setConfirming(false)}
        onConfirm={async () => {
          if (!checkout.canPay) return;
          setQrError(false);
          await checkout.createPayment();
          setConfirming(false);
        }}
      >
        <p>
          <strong>
            {booking.listing.subjectName} · {booking.listing.gradeLevelName}
          </strong>
        </p>
        <p>{formatBookingDocketSlot(booking.slot, language).label}</p>
        <p>
          {text.amount}: <strong>{formatMoney(booking.netAmount, booking.currency)}</strong>
        </p>
        {booking.coupon && (
          <p>
            {booking.coupon.code} · {booking.coupon.percent}%
          </p>
        )}
      </NotebookConfirmDialog>
    </section>
  );
}
