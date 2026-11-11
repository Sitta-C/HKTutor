import type { Booking } from '@generated/prisma/client';

export const couponSnapshotSelect = {
  appliedCouponId: true,
  appliedCouponCode: true,
  appliedCouponPercent: true,
} as const;

export interface CouponSnapshot {
  id: string;
  code: string;
  percent: number;
}

/** Read immutable evidence, never the mutable Coupon relation. Null is also the legacy default. */
export function couponSnapshot(
  value: Pick<Booking, 'appliedCouponId' | 'appliedCouponCode' | 'appliedCouponPercent'>,
): CouponSnapshot | null {
  if (!value.appliedCouponId || !value.appliedCouponCode || !value.appliedCouponPercent) {
    return null;
  }
  return {
    id: value.appliedCouponId,
    code: value.appliedCouponCode,
    percent: value.appliedCouponPercent,
  };
}
