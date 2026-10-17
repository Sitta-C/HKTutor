import isURL from 'validator/lib/isURL';

import type { BookingStatus } from '@/lib/api/types';

export function hasClassroomAccess(status: BookingStatus): boolean {
  return status === 'CONFIRMED' || status === 'COMPLETED';
}

export function attendanceEligibility({
  status,
  endAt,
  isOwner,
  attendance,
  now = Date.now(),
}: {
  status: BookingStatus;
  endAt: string;
  isOwner: boolean;
  attendance: 'ATTENDED' | 'ABSENT' | null;
  now?: number;
}): 'eligible' | 'owner' | 'pending' | 'unavailable' | 'future' | 'saved' {
  if (!isOwner) return 'owner';
  if (attendance !== null) return 'saved';
  if (status === 'PENDING') return 'pending';
  if (status !== 'CONFIRMED') return 'unavailable';
  if (new Date(endAt).getTime() > now) return 'future';
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
