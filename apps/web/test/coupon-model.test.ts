import { describe, expect, it, vi } from 'vitest';

import {
  getCouponRequestError,
  getCouponServerErrors,
  getCouponStatuses,
  mergeCouponPages,
  reconcileCouponCode,
  validateCouponDraft,
} from '@/components/coupons/coupon-model';
import { ApiError } from '@/lib/api/error';

import type { CouponDraft } from '@/components/coupons/coupon-model';
import type { AdminCoupon } from '@/lib/api/types';

const now = Date.parse('2026-11-11T00:00:00Z');
const draft: CouponDraft = {
  code: ' welcome10 ',
  percent: '10',
  maxUses: '100',
  date: '2026-11-12',
  time: '00:00',
  active: false,
};
const coupon: AdminCoupon = {
  id: 'one',
  code: 'WELCOME10',
  percent: 10,
  maxUses: 100,
  expiresAt: '2026-11-11T17:00:00.000Z',
  active: true,
  consumedUses: 12,
  reservedUses: 3,
  availableUses: 85,
  createdAt: '2026-11-11T00:00:00Z',
  updatedAt: '2026-11-11T00:00:00Z',
};

describe('admin coupon form contract', () => {
  it('normalizes ASCII codes and converts Bangkok midnight to the previous UTC date', () => {
    expect(validateCouponDraft(draft, now)).toEqual({
      payload: {
        code: 'WELCOME10',
        percent: 10,
        maxUses: 100,
        expiresAt: '2026-11-11T17:00:00.000Z',
        active: false,
      },
    });
  });

  it.each(['1', '100'])('accepts the percentage boundary %s', (percent) => {
    expect(validateCouponDraft({ ...draft, percent }, now).payload?.percent).toBe(Number(percent));
  });
  it.each(['', '0', '-10', '101', '120', '1.5', '1e2', 'Infinity'])(
    'rejects invalid percent %s',
    (percent) => {
      expect(validateCouponDraft({ ...draft, percent }, now).errors?.percent).toBe('percent');
    },
  );
  it.each(['1', '2147483647'])('accepts the usage boundary %s', (maxUses) => {
    expect(validateCouponDraft({ ...draft, maxUses }, now).payload?.maxUses).toBe(Number(maxUses));
  });
  it.each(['', '0', '-1', '1.2', '1e3', '2147483648'])('rejects invalid max uses %s', (maxUses) => {
    expect(validateCouponDraft({ ...draft, maxUses }, now).errors?.maxUses).toBe('maxUses');
  });
  it.each(['ab', 'A'.repeat(33), 'กขค', 'A B', 'A!B', 'ıxx', 'ßxx'])(
    'rejects invalid code %s',
    (code) => {
      expect(validateCouponDraft({ ...draft, code }, now).errors?.code).toBe('code');
    },
  );
  it.each(['ABC', 'A'.repeat(32), 'test_10-OK'])('accepts valid code %s', (code) => {
    expect(validateCouponDraft({ ...draft, code }, now).payload).toBeDefined();
  });
  it('rejects invalid calendar dates and expiry at or before now', () => {
    expect(validateCouponDraft({ ...draft, date: '2026-02-30' }, now).errors?.expiry).toBe(
      'expiry',
    );
    expect(validateCouponDraft({ ...draft, time: '24:00' }, now).errors?.expiry).toBe('expiry');
    expect(validateCouponDraft(draft, Date.parse(coupon.expiresAt)).errors?.expiry).toBe('future');
    expect(validateCouponDraft(draft, Date.parse(coupon.expiresAt) + 1).errors?.expiry).toBe(
      'future',
    );
  });
  it('requires a Bangkok time instead of guessing an end-of-day expiry for a date alone', () => {
    const result = validateCouponDraft({ ...draft, time: '' }, now);
    expect(result.errors?.expiry).toBe('expiry');
    expect(result.payload).toBeUndefined();
  });
  it('sends Bangkok 23:59 as the matching UTC instant', () => {
    expect(validateCouponDraft({ ...draft, time: '23:59' }, now).payload?.expiresAt).toBe(
      '2026-11-12T16:59:00.000Z',
    );
  });
  it('associates server validation with fields without exposing raw messages', () => {
    expect(
      getCouponServerErrors(
        new ApiError('invalid', 400, {
          message: ['percent must be integer', 'expiresAt must be future'],
        }),
      ),
    ).toEqual({ percent: 'server', expiry: 'server' });
    expect(getCouponRequestError(new ApiError('duplicate', 409))).toBe('duplicate');
    expect(getCouponRequestError(new ApiError('denied', 403))).toBe('forbidden');
    expect(getCouponRequestError(new ApiError('expired', 401))).toBe('unauthorized');
    expect(getCouponRequestError(new ApiError('server', 500))).toBe('uncertain');
    expect(getCouponRequestError(new TypeError('Failed to fetch'))).toBe('uncertain');
  });
});

describe('coupon capacity and recovery', () => {
  it('shows independent inactive, expired and exhausted badges without fabricating counts', () => {
    expect(getCouponStatuses(coupon, now)).toEqual(['active']);
    expect(getCouponStatuses(coupon, Date.parse(coupon.expiresAt))).toEqual(['expired']);
    expect(
      getCouponStatuses(
        { ...coupon, active: false, availableUses: 0 },
        Date.parse(coupon.expiresAt),
      ),
    ).toEqual(['inactive', 'expired', 'exhausted']);
    expect(getCouponStatuses({ ...coupon, reservedUses: 88, availableUses: 0 }, now)).toEqual([
      'exhausted',
    ]);
  });
  it('updates duplicate IDs on paging without adding duplicate rows', () => {
    expect(
      mergeCouponPages(
        [coupon],
        [
          { ...coupon, reservedUses: 4, availableUses: 84 },
          { ...coupon, id: 'two' },
        ],
      ),
    ).toHaveLength(2);
    expect(mergeCouponPages([coupon], [{ ...coupon, availableUses: 84 }])[0]?.availableUses).toBe(
      84,
    );
  });
  it('checks later pages before reporting code absence', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({ items: [], nextCursor: 'second' })
      .mockResolvedValueOnce({ items: [coupon], nextCursor: null });
    await expect(
      reconcileCouponCode(' welcome10 ', read, new AbortController().signal),
    ).resolves.toEqual(coupon);
    expect(read).toHaveBeenNthCalledWith(2, 'second');
  });
  it('allows a retry only after reaching the end of the list', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({ items: [], nextCursor: 'second' })
      .mockResolvedValueOnce({ items: [], nextCursor: null });
    await expect(
      reconcileCouponCode('NOTFOUND', read, new AbortController().signal),
    ).resolves.toBeNull();
    expect(read).toHaveBeenCalledTimes(2);
  });
  it('never treats failed, looping, aborted or incomplete traversal as absence', async () => {
    await expect(
      reconcileCouponCode(
        'X',
        vi.fn().mockRejectedValue(new Error('offline')),
        new AbortController().signal,
      ),
    ).rejects.toThrow('offline');
    await expect(
      reconcileCouponCode(
        'X',
        vi.fn().mockResolvedValue({ items: [], nextCursor: 'same' }),
        new AbortController().signal,
      ),
    ).rejects.toThrow('Repeated');
    let page = 0;
    await expect(
      reconcileCouponCode(
        'X',
        async () => ({ items: [], nextCursor: String(++page) }),
        new AbortController().signal,
      ),
    ).rejects.toThrow('page limit');
    const controller = new AbortController();
    controller.abort();
    const read = vi.fn();
    await expect(reconcileCouponCode('X', read, controller.signal)).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  });
});
