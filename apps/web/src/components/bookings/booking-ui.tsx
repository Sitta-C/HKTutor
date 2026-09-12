'use client';

import Link from 'next/link';

import { ApiError } from '@/lib/api/error';

import type { BookingStatus, BookingView } from '@/lib/api/types';

export const bookingCopy = {
  en: {
    loading: 'Loading…',
    loadError: 'We could not load this booking right now. Please try again.',
    validationError: 'The booking request is invalid. Please choose the tutor and time again.',
    unauthenticated: 'Your session has expired. Please sign in again to continue.',
    forbidden: 'This booking is not available for your account.',
    notFound: 'This booking could not be found.',
    conflict: 'This time was just booked. Choose another open time.',
    unknown: 'Something went wrong. Please try again.',
    status: 'Status',
    pending: 'PENDING',
    confirmed: 'CONFIRMED',
    completed: 'COMPLETED',
    canceled: 'CANCELED',
    expired: 'EXPIRED',
    tutor: 'Tutor',
    subject: 'Subject',
    grade: 'Grade level',
    lessonTime: 'Lesson time',
    bangkokTime: 'Bangkok time (UTC+7)',
    duration: 'Duration',
    hour: 'hour',
    hours: 'hours',
    amount: 'Amount',
    subtotal: 'Subtotal',
    discount: 'Discount',
    total: 'Request total',
    description: 'Description',
    view: 'View',
    backToBookings: 'Back to my bookings',
    findTutor: 'Find another tutor',
    signIn: 'Sign in',
    tryAgain: 'Try again',
    emptyTitle: 'No bookings yet',
    emptyBody: 'Choose a verified tutor and send your first booking request.',
    browseTutors: 'Browse tutors',
    myBookings: 'My bookings',
    all: 'All',
    bookingCount: 'booking(s)',
    bookingDetails: 'Booking details',
    created: 'Request created',
  },
  th: {
    loading: 'กำลังโหลด…',
    loadError: 'ยังโหลดการจองไม่ได้ กรุณาลองใหม่อีกครั้ง',
    validationError: 'ข้อมูลการจองไม่ถูกต้อง กรุณาเลือกติวเตอร์และเวลาใหม่',
    unauthenticated: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่อีกครั้ง',
    forbidden: 'การจองนี้ไม่สามารถเปิดดูจากบัญชีนี้ได้',
    notFound: 'ไม่พบการจองนี้',
    conflict: 'ช่วงเวลานี้เพิ่งถูกจอง กรุณาเลือกเวลาอื่น',
    unknown: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง',
    status: 'สถานะ',
    pending: 'รอยืนยัน',
    confirmed: 'ยืนยันแล้ว',
    completed: 'เสร็จสิ้น',
    canceled: 'ยกเลิกแล้ว',
    expired: 'หมดอายุ',
    tutor: 'ติวเตอร์',
    subject: 'วิชา',
    grade: 'ระดับชั้น',
    lessonTime: 'เวลาเรียน',
    bangkokTime: 'เวลาตามกรุงเทพฯ (UTC+7)',
    duration: 'ระยะเวลา',
    hour: 'ชั่วโมง',
    hours: 'ชั่วโมง',
    amount: 'ยอดเงิน',
    subtotal: 'ยอดก่อนส่วนลด',
    discount: 'ส่วนลด',
    total: 'ยอดคำขอจอง',
    description: 'รายละเอียด',
    view: 'ดู',
    backToBookings: 'กลับไปการจองของฉัน',
    findTutor: 'ค้นหาติวเตอร์เพิ่ม',
    signIn: 'เข้าสู่ระบบ',
    tryAgain: 'ลองใหม่',
    emptyTitle: 'ยังไม่มีการจอง',
    emptyBody: 'เลือกติวเตอร์ที่ยืนยันแล้วและส่งคำขอจองครั้งแรกของคุณ',
    browseTutors: 'ค้นหาติวเตอร์',
    myBookings: 'การจองของฉัน',
    all: 'ทั้งหมด',
    bookingCount: 'รายการ',
    bookingDetails: 'รายละเอียดการจอง',
    created: 'สร้างคำขอแล้ว',
  },
} as const;

export type BookingLanguage = keyof typeof bookingCopy;
export type BookingText = { [Key in keyof (typeof bookingCopy)['en']]: string };

export function formatBangkokRange(
  startAtUtc: string,
  endAtUtc: string,
  language: BookingLanguage,
): string {
  const locale = language === 'th' ? 'th-TH' : 'en-GB';
  const dateOptions: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
  };
  const timeOptions: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Bangkok',
    hour12: false,
  };
  const start = new Date(startAtUtc);
  const end = new Date(endAtUtc);
  return `${new Intl.DateTimeFormat(locale, dateOptions).format(start)} · ${new Intl.DateTimeFormat(locale, timeOptions).format(start)}–${new Intl.DateTimeFormat(locale, timeOptions).format(end)}`;
}

export function formatDuration(startAtUtc: string, endAtUtc: string, text: BookingText): string {
  const hours = (new Date(endAtUtc).getTime() - new Date(startAtUtc).getTime()) / 3_600_000;
  const rounded = Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
  return `${rounded} ${hours === 1 ? text.hour : text.hours}`;
}

export function formatMoney(amount: string, currency: string): string {
  return `${amount} ${currency}`;
}

export function getBookingErrorMessage(error: unknown, text: BookingText): string {
  if (error instanceof ApiError) {
    if (error.status === 400) return text.validationError;
    if (error.status === 401) return text.unauthenticated;
    if (error.status === 403) return text.forbidden;
    if (error.status === 404) return text.notFound;
    if (error.status === 409) return text.conflict;
  }
  return error instanceof Error && error.message ? error.message : text.unknown;
}

export function isBookingError(error: unknown, status: number): boolean {
  return error instanceof ApiError && error.status === status;
}

export function BookingStatusBadge({ status, text }: { status: BookingStatus; text: BookingText }) {
  const labels: Record<BookingStatus, string> = {
    CANCELED: text.canceled,
    COMPLETED: text.completed,
    CONFIRMED: text.confirmed,
    EXPIRED: text.expired,
    PENDING: text.pending,
  };
  return (
    <span className={`booking-status booking-status-${status.toLowerCase()}`}>
      {labels[status]}
    </span>
  );
}

export function BookingSummaryRow({
  booking,
  language,
  text,
}: {
  booking: BookingView;
  language: BookingLanguage;
  text: BookingText;
}) {
  return (
    <article className="booking-list-row">
      <div className="booking-list-avatar" aria-hidden="true">
        {getInitials(booking.tutor.displayName)}
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-base font-extrabold text-[#1a1916]">
          {booking.tutor.displayName}
        </h2>
        <p className="mt-1 text-sm font-semibold text-[#332e28]">
          {booking.listing.subjectName} · {booking.listing.gradeLevelName}
        </p>
        <p className="mt-1 text-sm text-[#70695f]">
          {formatBangkokRange(booking.slot.startAtUtc, booking.slot.endAtUtc, language)} ·{' '}
          {formatMoney(booking.netAmount, booking.currency)}
        </p>
      </div>
      <div className="booking-list-actions">
        <BookingStatusBadge status={booking.status} text={text} />
        <Link
          href={`/dashboard/bookings/${encodeURIComponent(booking.id)}`}
          className="booking-secondary-button"
        >
          {text.view}
        </Link>
      </div>
    </article>
  );
}

function getInitials(displayName: string): string {
  const initials = displayName
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('');
  return initials.toUpperCase() || '?';
}
