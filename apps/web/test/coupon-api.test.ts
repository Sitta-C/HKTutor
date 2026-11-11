import { beforeEach, describe, expect, it, vi } from 'vitest';

import { authenticatedFetch } from '@/lib/api/client';
import { createAdminCoupon, listAdminCoupons } from '@/lib/api/coupons';

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
