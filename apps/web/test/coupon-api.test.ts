import { beforeEach, describe, expect, it, vi } from 'vitest';

import { authenticatedFetch } from '@/lib/api/client';
import {
  createAdminCoupon,
  increaseAdminCouponCapacity,
  listAdminCoupons,
  setAdminCouponActivation,
} from '@/lib/api/coupons';

vi.mock('@/lib/api/client', () => ({ authenticatedFetch: vi.fn() }));

describe('admin coupon API', () => {
  beforeEach(() => vi.clearAllMocks());
  it('uses the existing authenticated client with encoded opaque pagination and cancellation', async () => {
    await listAdminCoupons('a+/=');
    expect(authenticatedFetch).toHaveBeenCalledWith('/admin/coupons?limit=20&cursor=a%2B%2F%3D', {
      signal: expect.any(AbortSignal),
    });
    await listAdminCoupons();
    expect(authenticatedFetch).toHaveBeenLastCalledWith('/admin/coupons?limit=20', {
      signal: expect.any(AbortSignal),
    });
    const controller = new AbortController();
    controller.abort();
    await listAdminCoupons(undefined, controller.signal);
    const last = vi.mocked(authenticatedFetch).mock.lastCall;
    expect(last?.[1]?.signal?.aborted).toBe(true);
  });
  it('sets the desired activation with an encoded ID and only a boolean body', async () => {
    const controller = new AbortController();
    await setAdminCouponActivation('coupon/id', { active: false }, controller.signal);
    expect(authenticatedFetch).toHaveBeenCalledWith('/admin/coupons/coupon%2Fid/activation', {
      method: 'PATCH',
      body: JSON.stringify({ active: false }),
      signal: expect.any(AbortSignal),
    });
  });
  it('sets a desired total using the same authenticated client and encoded ID', async () => {
    await increaseAdminCouponCapacity('coupon/id', { maxUses: 150 });
    expect(authenticatedFetch).toHaveBeenCalledWith('/admin/coupons/coupon%2Fid/capacity', {
      method: 'PATCH',
      body: JSON.stringify({ maxUses: 150 }),
      signal: expect.any(AbortSignal),
    });
  });
  it('posts the exact JSON contract and preserves the active=false choice', async () => {
    const payload = {
      code: 'WELCOME10',
      percent: 10,
      expiresAt: '2026-11-30T16:59:00.000Z',
      maxUses: 100,
      active: false,
    };
    await createAdminCoupon(payload);
    expect(authenticatedFetch).toHaveBeenCalledWith('/admin/coupons', {
      method: 'POST',
      body: JSON.stringify(payload),
      signal: expect.any(AbortSignal),
    });
  });
});
