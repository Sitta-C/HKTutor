'use client';

import { authenticatedFetch } from '@/lib/api/client';

import type {
  ApproveRescheduleResponse,
  CreateRescheduleRequestPayload,
  CreateRescheduleRequestResponse,
  CurrentRescheduleRequestResponse,
  RejectRescheduleResponse,
  WithdrawRescheduleResponse,
} from '@/lib/api/types';

export function getCurrentRescheduleRequest(
  bookingId: string,
): Promise<CurrentRescheduleRequestResponse> {
  return authenticatedFetch(
    `/bookings/${encodeURIComponent(bookingId)}/reschedule-requests/current`,
  );
}

export function createRescheduleRequest(
  bookingId: string,
  payload: CreateRescheduleRequestPayload,
): Promise<CreateRescheduleRequestResponse> {
  const reason = payload.reason?.trim();
  return authenticatedFetch(`/bookings/${encodeURIComponent(bookingId)}/reschedule-requests`, {
    method: 'POST',
    body: JSON.stringify({ targetSlotId: payload.targetSlotId, ...(reason ? { reason } : {}) }),
  });
}

export function approveRescheduleRequest(requestId: string): Promise<ApproveRescheduleResponse> {
  return authenticatedFetch(`/reschedule-requests/${encodeURIComponent(requestId)}/approve`, {
    method: 'POST',
  });
}

export function rejectRescheduleRequest(requestId: string): Promise<RejectRescheduleResponse> {
  return authenticatedFetch(`/reschedule-requests/${encodeURIComponent(requestId)}/reject`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function withdrawRescheduleRequest(requestId: string): Promise<WithdrawRescheduleResponse> {
  return authenticatedFetch(`/reschedule-requests/${encodeURIComponent(requestId)}/withdraw`, {
    method: 'POST',
  });
}
