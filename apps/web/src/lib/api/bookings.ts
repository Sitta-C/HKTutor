'use client';

import { authenticatedFetch } from '@/lib/api/client';

import type {
  BookingDetail,
  BookingQuote,
  BookingResponse,
  ConfirmTutorBookingPayload,
  CreateBookingPayload,
  MyBookingsQuery,
  MyBookingsResponse,
  RejectTutorBookingPayload,
  TutorBookingActionResult,
  TutorBookingsQuery,
  TutorBookingsResponse,
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
  if (queryInput.page !== undefined) params.set('page', String(queryInput.page));
  if (queryInput.pageSize !== undefined) params.set('pageSize', String(queryInput.pageSize));
  const query = params.toString() ? `?${params.toString()}` : '';
  return authenticatedFetch<MyBookingsResponse>(`/bookings/me${query}`);
}

export function getMyBooking(bookingId: string): Promise<BookingDetail> {
  return authenticatedFetch<BookingDetail>(`/bookings/me/${encodeURIComponent(bookingId)}`);
}

export function getTutorBookings(
  queryInput: TutorBookingsQuery = {},
): Promise<TutorBookingsResponse> {
  const params = new URLSearchParams();
  if (queryInput.status) params.set('status', queryInput.status);
  if (queryInput.from) params.set('from', toIsoString(queryInput.from));
  if (queryInput.to) params.set('to', toIsoString(queryInput.to));
  if (queryInput.page !== undefined) params.set('page', String(queryInput.page));
  if (queryInput.pageSize !== undefined) params.set('pageSize', String(queryInput.pageSize));
  const query = params.toString() ? `?${params.toString()}` : '';
  return authenticatedFetch<TutorBookingsResponse>(`/bookings/tutor${query}`);
}

export function confirmTutorBooking(
  bookingId: string,
  payload: ConfirmTutorBookingPayload = {},
): Promise<TutorBookingActionResult> {
  const note = payload.note?.trim();
  return postTutorBookingAction(bookingId, 'confirm', note ? { note } : {});
}

export function rejectTutorBooking(
  bookingId: string,
  payload: RejectTutorBookingPayload = {},
): Promise<TutorBookingActionResult> {
  const reason = payload.reason?.trim();
  return postTutorBookingAction(bookingId, 'reject', reason ? { reason } : {});
}

/**
 * The tutor is taken from the access token, so the body carries only the optional note or reason.
 * A blank value is dropped because the API rejects an empty string with 400. The API accepts a
 * confirmation note without persisting it, so no screen offers one; only `reason` reaches storage.
 */
function postTutorBookingAction(
  bookingId: string,
  action: 'confirm' | 'reject',
  body: ConfirmTutorBookingPayload | RejectTutorBookingPayload,
): Promise<TutorBookingActionResult> {
  return authenticatedFetch<TutorBookingActionResult>(
    `/bookings/tutor/${encodeURIComponent(bookingId)}/${action}`,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

function toIsoString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}
