import type { BookingStatus } from '@/lib/api/types';

export function hasClassroomAccess(status: BookingStatus): boolean {
  return status === 'CONFIRMED' || status === 'COMPLETED';
}

export function isSafeMeetingUrl(value: string): boolean {
  if (!/^https:\/\/[^\s/?#]+([/?#].*)?$/i.test(value) || value !== value.trim()) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.length > 0 && !url.username && !url.password;
  } catch {
    return false;
  }
}
