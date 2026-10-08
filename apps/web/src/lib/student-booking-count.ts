'use client';

import { useEffect, useSyncExternalStore } from 'react';

import { getMyBookings } from '@/lib/api/bookings';

interface BookingCountState {
  userId: string | null;
  total: number | null;
  refreshing: boolean;
}
interface BookingCountCache {
  userId: string;
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

export function clearStudentBookingCount(): void {
  cache = null;
  publish(emptyState);
}

export function getStudentBookingCountSnapshot(): BookingCountState {
  return state;
}

export function loadStudentBookingCount(userId: string, force = false): Promise<void> {
  if (cache?.userId !== userId) {
    cache = { userId, request: null };
    publish({ userId, total: null, refreshing: false });
  }
  if (cache.request) return cache.request;
  if (!force && state.total !== null) return Promise.resolve();

  const activeCache = cache;
  publish({ ...state, refreshing: true });
  activeCache.request = getMyBookings({ page: 1, pageSize: 1 })
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
export function refreshStudentBookingCountAfterCreate(): void {
  if (!cache) return;
  const userId = cache.userId;
  cache = { userId, request: null };
  void loadStudentBookingCount(userId, true);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useStudentBookingCount(userId: string | null, route: string): BookingCountState {
  const snapshot = useSyncExternalStore(
    subscribe,
    getStudentBookingCountSnapshot,
    () => emptyState,
  );

  useEffect(() => {
    if (!userId) return;
    const refresh = () => {
      if (document.visibilityState === 'visible') void loadStudentBookingCount(userId, true);
    };
    void loadStudentBookingCount(userId, true);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [userId, route]);

  return snapshot.userId === userId && userId ? snapshot : emptyState;
}
