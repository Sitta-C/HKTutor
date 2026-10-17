import { ApiError } from '@/lib/api/error';

import type { RescheduleCopy } from '@/components/bookings/reschedule-copy';
import type {
  BookingQuoteSlot,
  BookingStatus,
  CurrentRescheduleRequestResponse,
  RescheduleAction,
  RescheduleTargetSlot,
} from '@/lib/api/types';

export interface RescheduleBooking {
  id: string;
  status: BookingStatus;
  slot: BookingQuoteSlot;
}

export const RESCHEDULE_CUTOFF_MS = 86_400_000;

export function filterTargetSlots(
  slots: RescheduleTargetSlot[],
  tutorId: string,
  booking: RescheduleBooking,
  now: number,
): RescheduleTargetSlot[] {
  const currentStart = Date.parse(booking.slot.startAtUtc);
  const currentEnd = Date.parse(booking.slot.endAtUtc);
  return slots
    .filter((slot) => {
      const start = Date.parse(slot.startAtUtc);
      const end = Date.parse(slot.endAtUtc);
      return (
        slot.tutorProfileId === tutorId &&
        slot.id !== booking.slot.id &&
        start > now &&
        end > start &&
        (end <= currentStart || start >= currentEnd)
      );
    })
    .sort((left, right) => Date.parse(left.startAtUtc) - Date.parse(right.startAtUtc));
}

export function getRescheduleActions(
  current: CurrentRescheduleRequestResponse,
  userId: string,
  booking: RescheduleBooking,
  now: number,
): RescheduleAction[] {
  const eligible =
    booking.status === 'CONFIRMED' &&
    Date.parse(booking.slot.startAtUtc) - now >= RESCHEDULE_CUTOFF_MS;
  const pending = current.request?.status === 'PENDING';
  const requester = current.request?.requestedById === userId;
  const hasFutureTarget =
    current.targetSlot !== null && Date.parse(current.targetSlot.startAtUtc) > now;
  return current.allowedActions.filter((action) => {
    switch (action) {
      case 'CREATE':
        return !pending && eligible;
      case 'APPROVE':
        return pending && !requester && eligible && hasFutureTarget;
      case 'REJECT':
        return pending && !requester;
      case 'WITHDRAW':
        return pending && requester;
    }
  });
}

export function getRescheduleFailure(
  error: unknown,
  copy: RescheduleCopy,
): { message: string; requiresRefresh: boolean } {
  if (!(error instanceof ApiError)) {
    return { message: copy.uncertain, requiresRefresh: true };
  }
  const details = error.details;
  const code =
    typeof details === 'object' && details !== null && 'code' in details ? details.code : null;
  const messages: Record<string, string> = {
    RESCHEDULE_CUTOFF_EXCEEDED: copy.cutoff,
    RESCHEDULE_TARGET_RESERVED: copy.collision,
    RESCHEDULE_TARGET_UNAVAILABLE: copy.collision,
    RESCHEDULE_TARGET_PAST: copy.targetPast,
    RESCHEDULE_ALREADY_PENDING: copy.conflict,
    RESCHEDULE_REQUEST_NOT_PENDING: copy.conflict,
    RESCHEDULE_RACE_CONFLICT: copy.conflict,
  };
  return {
    message:
      (typeof code === 'string' ? messages[code] : undefined) ??
      (error.status === 401
        ? copy.session
        : error.status === 403
          ? copy.forbidden
          : error.status === 404
            ? copy.missing
            : error.status === 409
              ? copy.conflict
              : error.status === 400
                ? copy.invalid
                : copy.uncertain),
    requiresRefresh: error.status !== 400 || code === 'RESCHEDULE_TARGET_PAST',
  };
}
