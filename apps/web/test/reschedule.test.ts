import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { rescheduleCopy } from '@/components/bookings/reschedule-copy';
import {
  filterTargetSlots,
  getRescheduleActions,
  getRescheduleFailure,
} from '@/components/bookings/reschedule-model';
import { TargetSlotPicker } from '@/components/bookings/target-slot-picker';
import { ApiError } from '@/lib/api/error';

import type { RescheduleBooking } from '@/components/bookings/reschedule-model';
import type { CurrentRescheduleRequestResponse, RescheduleTargetSlot } from '@/lib/api/types';

const now = Date.parse('2026-10-16T03:00:00Z');
const booking: RescheduleBooking = {
  id: 'booking',
  status: 'CONFIRMED',
  slot: { id: 'original', startAtUtc: '2026-10-17T03:00:00Z', endAtUtc: '2026-10-17T04:00:00Z' },
};
const target: RescheduleTargetSlot = {
  id: 'target',
  tutorProfileId: 'tutor',
  startAtUtc: '2026-10-18T16:00:00Z',
  endAtUtc: '2026-10-18T18:00:00Z',
};
const current: CurrentRescheduleRequestResponse = {
  allowedActions: ['CREATE', 'APPROVE', 'REJECT', 'WITHDRAW'],
  targetSlot: target,
  request: {
    id: 'request',
    bookingId: booking.id,
    fromSlotId: booking.slot.id,
    requestedById: 'student',
    requestedSlotId: target.id,
    reason: 'Exam',
    status: 'PENDING',
    requestedAt: '2026-10-16T03:00:00Z',
    reviewedById: null,
    decidedAt: null,
    withdrawnAt: null,
  },
};

describe('reschedule target candidates', () => {
  it('keeps only same-tutor future non-overlapping slots, sorts them, and preserves UTC', () => {
    const earlier = {
      ...target,
      id: 'earlier',
      startAtUtc: booking.slot.endAtUtc,
      endAtUtc: '2026-10-17T05:00:00Z',
    };
    const candidates = filterTargetSlots(
      [
        target,
        earlier,
        { ...target, id: 'other-tutor', tutorProfileId: 'other' },
        { ...target, id: 'now', startAtUtc: new Date(now).toISOString() },
        { ...target, ...booking.slot },
        { ...target, id: 'overlap', startAtUtc: '2026-10-17T03:30:00Z' },
        { ...target, id: 'invalid', startAtUtc: 'invalid' },
        { ...target, id: 'reversed', endAtUtc: '2026-10-18T15:00:00Z' },
      ],
      'tutor',
      booking,
      now,
    );
    expect(candidates).toEqual([earlier, target]);
    expect(target.startAtUtc).toBe('2026-10-18T16:00:00Z');
  });
});

describe('participant actions', () => {
  it('separates requester and reviewer, intersecting with server actions', () => {
    expect(getRescheduleActions(current, 'student', booking, now)).toEqual(['WITHDRAW']);
    expect(getRescheduleActions(current, 'tutor', booking, now)).toEqual(['APPROVE', 'REJECT']);
    expect(getRescheduleActions({ ...current, allowedActions: [] }, 'tutor', booking, now)).toEqual(
      [],
    );
  });
  it('allows exactly 24h, suppresses approval after the boundary but retains closure actions', () => {
    expect(getRescheduleActions(current, 'tutor', booking, now + 1)).toEqual(['REJECT']);
    expect(getRescheduleActions(current, 'student', booking, now + 1)).toEqual(['WITHDRAW']);
    expect(getRescheduleActions(current, 'tutor', { ...booking, status: 'CANCELED' }, now)).toEqual(
      ['REJECT'],
    );
  });
  it('supports no request and fails closed for invalid dates', () => {
    const empty = { ...current, request: null, targetSlot: null };
    expect(getRescheduleActions(empty, 'student', booking, now)).toEqual(['CREATE']);
    expect(getRescheduleActions(empty, 'student', booking, now + 1)).toEqual([]);
    expect(
      getRescheduleActions(
        empty,
        'student',
        { ...booking, slot: { ...booking.slot, startAtUtc: 'bad' } },
        now,
      ),
    ).toEqual([]);
  });
});

describe('reschedule recovery', () => {
  const copy = rescheduleCopy.en;
  it.each([
    ['RESCHEDULE_TARGET_RESERVED', copy.collision],
    ['RESCHEDULE_TARGET_UNAVAILABLE', copy.collision],
    ['RESCHEDULE_CUTOFF_EXCEEDED', copy.cutoff],
    ['RESCHEDULE_RACE_CONFLICT', copy.conflict],
    ['RESCHEDULE_REQUEST_NOT_PENDING', copy.conflict],
  ])('explains %s and requires a full refresh', (code, message) => {
    expect(getRescheduleFailure(new ApiError('error', 409, { code }), copy)).toEqual({
      message,
      requiresRefresh: true,
    });
  });
  it.each([401, 403, 404, 409, 500])('locks uncertain or unauthorized HTTP %s', (status) => {
    expect(getRescheduleFailure(new ApiError('error', status), copy).requiresRefresh).toBe(true);
  });
  it('locks network failures but lets validation errors be corrected', () => {
    expect(getRescheduleFailure(new TypeError('network'), copy)).toEqual({
      message: copy.uncertain,
      requiresRefresh: true,
    });
    expect(getRescheduleFailure(new ApiError('invalid', 400), copy)).toEqual({
      message: copy.invalid,
      requiresRefresh: false,
    });
  });
  it('keeps bilingual keys aligned', () => {
    expect(Object.keys(rescheduleCopy.th).sort()).toEqual(Object.keys(copy).sort());
  });
});

describe('TargetSlotPicker component', () => {
  it.each(['en', 'th'] as const)(
    'renders labeled keyboard-operable options and actual Bangkok overnight endpoints in %s',
    (language) => {
      const html = renderToStaticMarkup(
        createElement(TargetSlotPicker, {
          slots: [target],
          selectedId: target.id,
          onSelect: () => {},
          disabled: true,
          language,
          copy: rescheduleCopy[language],
        }),
      );
      expect(html).toContain('<fieldset disabled=""');
      expect(html).toContain('type="radio"');
      expect(html).toContain('checked=""');
      expect(html).toContain('23:00 →');
      expect(html).toContain('01:00');
      expect(html).toContain(rescheduleCopy[language].choose);
    },
  );
});
