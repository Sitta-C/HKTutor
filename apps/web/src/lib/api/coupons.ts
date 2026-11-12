'use client';

import { authenticatedFetch } from '@/lib/api/client';

import type {
  AdminCoupon,
  AdminCouponList,
  CreateAdminCouponPayload,
  SetCouponActivationPayload,
} from '@/lib/api/types';

export function listAdminCoupons(cursor?: string, signal?: AbortSignal): Promise<AdminCouponList> {
  const query = new URLSearchParams({ limit: '20' });
  if (cursor) {
    query.set('cursor', cursor);
  }
  return authenticatedFetch(`/admin/coupons?${query}`, {
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(12_000)])
      : AbortSignal.timeout(12_000),
  });
}

export function createAdminCoupon(
  payload: CreateAdminCouponPayload,
  signal?: AbortSignal,
): Promise<AdminCoupon> {
  return authenticatedFetch('/admin/coupons', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(12_000)])
      : AbortSignal.timeout(12_000),
  });
}

export function setAdminCouponActivation(
  couponId: string,
  payload: SetCouponActivationPayload,
  signal?: AbortSignal,
): Promise<AdminCoupon> {
  return authenticatedFetch(`/admin/coupons/${encodeURIComponent(couponId)}/activation`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(12_000)])
      : AbortSignal.timeout(12_000),
  });
}
