'use client';

import { useEffect, useSyncExternalStore } from 'react';

import { getMyBookings, getTutorBookings } from '@/lib/api/bookings';

type BookingCountRole = 'STUDENT' | 'TUTOR';

export interface BookingCountState {
  userId: string | null;
  total: number | null;
  refreshing: boolean;
}
interface BookingCountCache {
  userId: string;
  role: BookingCountRole;
  request: Promise<void> | null;
}

const emptyState: BookingCountState = { userId: null, total: null, refreshing: false };
let state = emptyState;
let cache: BookingCountCache | null = null;
const listeners = new Set<() => void>();

function publish(next: BookingCountState): void {
  state = next;
  for (const listener of listeners) listener();
}

export function clearBookingCount(): void {
  cache = null;
  publish(emptyState);
}

export function getBookingCountSnapshot(): BookingCountState {
  return state;
}

export function loadBookingCount(
  userId: string,
  role: BookingCountRole,
  force = false,
): Promise<void> {
  if (cache?.userId !== userId || cache.role !== role) {
    cache = { userId, role, request: null };
    publish({ userId, total: null, refreshing: false });
  }
  if (cache.request) return cache.request;
  if (!force && state.total !== null) return Promise.resolve();

  const activeCache = cache;
  publish({ ...state, refreshing: true });
  const read =
    role === 'TUTOR'
      ? getTutorBookings({ status: 'PENDING', page: 1, pageSize: 1 })
      : getMyBookings({ page: 1, pageSize: 1 });
  activeCache.request = read
    .then((response) => {
      if (cache !== activeCache) return;
      publish({ userId, total: response.total, refreshing: false });
    })
    .catch(() => {
      if (cache !== activeCache) return;
      publish({ userId, total: null, refreshing: false });
    })
    .finally(() => {
      if (cache === activeCache) activeCache.request = null;
    });
  return activeCache.request;
}

/** A pre-submission read must not overwrite the count after a successful booking. */
export function refreshBookingCount(): void {
  if (!cache) return;
  const { userId, role } = cache;
  cache = { userId, role, request: null };
  void loadBookingCount(userId, role, true);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useBookingCount(
  userId: string | null,
  role: BookingCountRole | null,
  route: string,
): BookingCountState {
  const snapshot = useSyncExternalStore(subscribe, getBookingCountSnapshot, () => emptyState);

  useEffect(() => {
    if (!userId || !role) return;
    const refresh = () => {
      if (document.visibilityState === 'visible') void loadBookingCount(userId, role, true);
    };
    void loadBookingCount(userId, role, true);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [userId, role, route]);

  return snapshot.userId === userId && userId && cache?.role === role ? snapshot : emptyState;
}
