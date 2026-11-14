'use client';

import { loadBookingCount, useBookingCount } from '@/lib/booking-count';

import type { BookingCountState } from '@/lib/booking-count';

export {
  clearBookingCount as clearStudentBookingCount,
  getBookingCountSnapshot as getStudentBookingCountSnapshot,
  refreshBookingCount as refreshStudentBookingCountAfterCreate,
} from '@/lib/booking-count';

export function loadStudentBookingCount(userId: string, force = false): Promise<void> {
  return loadBookingCount(userId, 'STUDENT', force);
}

export function useStudentBookingCount(userId: string | null, route: string): BookingCountState {
  return useBookingCount(userId, 'STUDENT', route);
}
