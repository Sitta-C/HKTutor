import { bangkokDateTimeToUtc } from '@/lib/api/availability';
import { ApiError } from '@/lib/api/error';

import type { AdminCoupon, AdminCouponList, CreateAdminCouponPayload } from '@/lib/api/types';

export interface CouponDraft {
  code: string;
  percent: string;
  maxUses: string;
  date: string;
  time: string;
  active: boolean;
}

export const EMPTY_COUPON_DRAFT: CouponDraft = {
  code: '',
  percent: '',
  maxUses: '',
  date: '',
  time: '',
  active: true,
};

export type CouponField = 'code' | 'percent' | 'maxUses' | 'expiry';
export type CouponFieldError =
  'code' | 'percent' | 'maxUses' | 'expiry' | 'future' | 'duplicate' | 'server';
export type CouponErrors = Partial<Record<CouponField, CouponFieldError>>;
export type CouponStatus = 'active' | 'inactive' | 'expired' | 'exhausted';

export function normalizeCouponCode(value: string): string {
  return value.trim().replace(/[a-z]/g, (letter) => letter.toUpperCase());
}

export function validateCouponDraft(
  draft: CouponDraft,
  now: number,
):
  | { payload: CreateAdminCouponPayload; errors?: never }
  | { errors: CouponErrors; payload?: never } {
  const errors: CouponErrors = {};
  const code = normalizeCouponCode(draft.code);
  if (!/^[A-Z0-9_-]{3,32}$/.test(code)) {
    errors.code = 'code';
  }
  const percent = Number(draft.percent);
  if (!/^\d+$/.test(draft.percent) || !Number.isInteger(percent) || percent < 1 || percent > 100) {
    errors.percent = 'percent';
  }
  const maxUses = Number(draft.maxUses);
  if (
    !/^\d+$/.test(draft.maxUses) ||
    !Number.isInteger(maxUses) ||
    maxUses < 1 ||
    maxUses > 2147483647
  ) {
    errors.maxUses = 'maxUses';
  }
  let expiresAt = '';
  try {
    const expiry = bangkokDateTimeToUtc(draft.date, draft.time);
    if (expiry.getUTCFullYear() < 1 || expiry.getUTCFullYear() > 9999) {
      errors.expiry = 'expiry';
    } else if (expiry.getTime() <= now) {
      errors.expiry = 'future';
    } else {
      expiresAt = expiry.toISOString();
    }
  } catch {
    errors.expiry = 'expiry';
  }
  if (Object.keys(errors).length) {
    return { errors };
  }
  return { payload: { code, percent, maxUses, expiresAt, active: draft.active } };
}

export function getCouponStatuses(coupon: AdminCoupon, now: number): CouponStatus[] {
  const statuses: CouponStatus[] = [];
  if (!coupon.active) {
    statuses.push('inactive');
  }
  if (now >= Date.parse(coupon.expiresAt)) {
    statuses.push('expired');
  }
  if (coupon.availableUses <= 0) {
    statuses.push('exhausted');
  }
  return statuses.length ? statuses : ['active'];
}

export function getCouponRequestError(
  error: unknown,
): 'unauthorized' | 'forbidden' | 'uncertain' | 'validation' | 'duplicate' {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return 'unauthorized';
    }
    if (error.status === 403) {
      return 'forbidden';
    }
    if (error.status === 409) {
      return 'duplicate';
    }
    if (error.status === 400) {
      return 'validation';
    }
  }
  return 'uncertain';
}

export function getCouponServerErrors(error: unknown): CouponErrors {
  if (
    !(error instanceof ApiError) ||
    !error.details ||
    typeof error.details !== 'object' ||
    !('message' in error.details)
  ) {
    return {};
  }
  const messages: unknown = error.details.message;
  const text =
    typeof messages === 'string'
      ? messages
      : Array.isArray(messages)
        ? messages.filter((value: unknown) => typeof value === 'string').join(' ')
        : '';
  const errors: CouponErrors = {};
  for (const field of ['code', 'percent', 'maxUses', 'expiresAt'] as const) {
    if (new RegExp(`\\b${field}\\b`, 'i').test(text)) {
      errors[field === 'expiresAt' ? 'expiry' : field] = 'server';
    }
  }
  return errors;
}

export function mergeCouponPages(current: AdminCoupon[], incoming: AdminCoupon[]): AdminCoupon[] {
  const updates = new Map(incoming.map((coupon) => [coupon.id, coupon]));
  return [
    ...current.map((coupon) => updates.get(coupon.id) ?? coupon),
    ...incoming.filter((coupon) => !current.some((item) => item.id === coupon.id)),
  ];
}

// There is no server-side code filter. Only a complete, bounded traversal can clear the retry gate.
// Finding a code confirms its existence, not which administrator/request created it.
export async function reconcileCouponCode(
  code: string,
  readPage: (cursor?: string) => Promise<AdminCouponList>,
  signal: AbortSignal,
): Promise<AdminCoupon | null> {
  let cursor: string | undefined;
  const seen = new Set<string>();
  const deadline = Date.now() + 30_000;
  for (let page = 0; page < 100; page += 1) {
    signal.throwIfAborted();
    if (Date.now() >= deadline) {
      throw new Error('Coupon reconciliation deadline reached');
    }
    const result = await readPage(cursor);
    signal.throwIfAborted();
    if (Date.now() >= deadline) {
      throw new Error('Coupon reconciliation deadline reached');
    }
    const found = result.items.find((coupon) => coupon.code === normalizeCouponCode(code));
    if (found) {
      return found;
    }
    if (result.nextCursor === null) {
      return null;
    }
    if (seen.has(result.nextCursor)) {
      throw new Error('Repeated coupon cursor');
    }
    seen.add(result.nextCursor);
    cursor = result.nextCursor;
  }
  throw new Error('Coupon reconciliation page limit reached');
}
