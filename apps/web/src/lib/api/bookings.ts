'use client';

import { authenticatedFetch } from '@/lib/api/client';

import type {
  BookingDetail,
  BookingQuote,
  BookingResponse,
  CreateBookingPayload,
  MyBookingsQuery,
  MyBookingsResponse,
} from '@/lib/api/types';

export interface BookingSubmitGate {
  current: boolean;
}

export function getBookingQuote(listingId: string, slotId: string): Promise<BookingQuote> {
  const params = new URLSearchParams({ listingId, slotId });
  return authenticatedFetch<BookingQuote>(`/bookings/quote?${params.toString()}`);
}

export function createBooking(payload: CreateBookingPayload): Promise<BookingResponse> {
  return authenticatedFetch<BookingResponse>('/bookings', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function createBookingOnce(
  payload: CreateBookingPayload,
  gate: BookingSubmitGate,
): Promise<BookingResponse | null> {
  if (gate.current) return null;
  gate.current = true;
  try {
    return await createBooking(payload);
  } finally {
    gate.current = false;
  }
}

export function getMyBookings(queryInput: MyBookingsQuery = {}): Promise<MyBookingsResponse> {
  const params = new URLSearchParams();
  if (queryInput.status) params.set('status', queryInput.status);
  if (queryInput.from) params.set('from', toIsoString(queryInput.from));
  if (queryInput.to) params.set('to', toIsoString(queryInput.to));
  const query = params.toString() ? `?${params.toString()}` : '';
  return authenticatedFetch<MyBookingsResponse>(`/bookings/me${query}`);
}

export function getMyBooking(bookingId: string): Promise<BookingDetail> {
  return authenticatedFetch<BookingDetail>(`/bookings/me/${encodeURIComponent(bookingId)}`);
}

function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}
