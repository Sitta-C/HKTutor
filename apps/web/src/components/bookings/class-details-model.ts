import isURL from 'validator/lib/isURL';

import type { BookingStatus, PaymentStatus } from '@/lib/api/types';

export function hasClassroomAccess(status: BookingStatus, paymentStatus: PaymentStatus): boolean {
  return paymentStatus === 'PAID' && (status === 'CONFIRMED' || status === 'COMPLETED');
}

export function attendanceEligibility({
  status,
  endAt,
  isOwner,
  attendance,
  paymentStatus,
  now = Date.now(),
}: {
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  endAt: string;
  isOwner: boolean;
  attendance: 'ATTENDED' | 'ABSENT' | null;
  now?: number;
}): 'eligible' | 'owner' | 'unpaid' | 'pending' | 'unavailable' | 'future' | 'saved' {
  if (!isOwner) {
    return 'owner';
  }
  if (status === 'PENDING') {
    return 'pending';
  }
  if (status !== 'CONFIRMED' && status !== 'COMPLETED') {
    return 'unavailable';
  }
  if (paymentStatus !== 'PAID') {
    return 'unpaid';
  }
  const end = new Date(endAt).getTime();
  if (!Number.isFinite(end)) {
    return 'unavailable';
  }
  if (end > now) {
    return 'future';
  }
  if (attendance !== null) {
    return status === 'COMPLETED' ? 'saved' : 'unavailable';
  }
  if (status === 'COMPLETED') {
    return 'unavailable';
  }
  return 'eligible';
}

export function isSafeMeetingUrl(value: string): boolean {
  if (
    !/^https:\/\//i.test(value) ||
    value !== value.trim() ||
    !isURL(value, {
      protocols: ['https'],
      require_protocol: true,
      require_valid_protocol: true,
      disallow_auth: true,
      // Preserve the API's URL length behavior instead of adding validator's default limit.
      validate_length: false,
    })
  ) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.length > 0 && !url.username && !url.password;
  } catch {
    return false;
  }
}
