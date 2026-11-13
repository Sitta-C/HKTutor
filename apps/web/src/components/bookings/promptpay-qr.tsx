'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';

import { getQrCountdown } from '@/components/bookings/qr-countdown';
import { formatBangkokDateTime } from '@/lib/date-time';
import { useLanguage } from '@/lib/i18n';

import styles from './promptpay-payment-panel.module.css';

const COPY = {
  th: {
    remaining: 'เหลือเวลา',
    label: 'เวลาที่เหลือก่อน QR หมดอายุ',
    expired: 'หมดเวลาแล้ว',
    confirming: 'กำลังรอยืนยันผลชำระเงิน กรุณาตรวจสถานะก่อนทำรายการต่อ',
    deadline: 'หมดอายุ',
    qrAlt: 'QR PromptPay สำหรับการชำระเงินทดสอบ',
  },
  en: {
    remaining: 'Time left',
    label: 'Time remaining before QR expiry',
    expired: 'Time is up',
    confirming: 'Waiting for payment confirmation. Check the status before continuing.',
    deadline: 'Expires',
    qrAlt: 'PromptPay QR for test payment',
  },
};

export function PromptPayQr({
  url,
  expiresAt,
  onError,
}: {
  url: string;
  expiresAt: string;
  onError: () => void;
}) {
  const { language } = useLanguage();
  const text = COPY[language];
  const [now, setNow] = useState(() => Date.now());
  const countdown = getQrCountdown(expiresAt, now);
  const expired = countdown === '00:00';

  useEffect(() => {
    const deadline = Date.parse(expiresAt);
    if (!Number.isFinite(deadline)) {
      return;
    }
    let interval: ReturnType<typeof setInterval> | undefined;
    function tick(): void {
      const current = Date.now();
      setNow(current);
      if (current >= deadline) {
        clearInterval(interval);
      }
    }
    function onVisibilityChange(): void {
      clearInterval(interval);
      if (!document.hidden) {
        tick();
        if (Date.now() < deadline) {
          interval = setInterval(tick, 1000);
        }
      }
    }
    if (!document.hidden && Date.now() < deadline) {
      interval = setInterval(tick, 1000);
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [expiresAt]);

  if (countdown === null) {
    return null;
  }

  return (
    <>
      {!expired && (
        <Image
          src={url}
          alt={text.qrAlt}
          width={240}
          height={240}
          unoptimized
          className={styles.qr}
          onError={onError}
        />
      )}
      <div className={styles.countdown} data-expired={expired}>
        <span>{expired ? text.expired : text.remaining}</span>
        <span
          role="timer"
          aria-label={text.label}
          aria-live="off"
          className={styles.countdownValue}
          title={`${text.deadline}: ${formatBangkokDateTime(expiresAt, language)}`}
        >
          {countdown}
        </span>
      </div>
      {expired && (
        <p className={styles.help} role="status">
          {text.confirming}
        </p>
      )}
    </>
  );
}
