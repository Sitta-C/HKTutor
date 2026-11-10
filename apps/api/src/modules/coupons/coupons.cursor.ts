import { BadRequestException } from '@nestjs/common';

import { isUuid } from '@common/pipes/uuid-param.pipe';
import { MAX_COUPON_CURSOR_LENGTH } from '@modules/coupons/coupons.dto';

interface CouponCursor {
  createdAt: string;
  id: string;
}

export function encodeCouponCursor(cursor: CouponCursor): string {
  return Buffer.from(JSON.stringify({ createdAt: cursor.createdAt, id: cursor.id })).toString(
    'base64url',
  );
}

export function decodeCouponCursor(cursor: string): CouponCursor {
  try {
    if (cursor.length > MAX_COUPON_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
      throw new Error('Invalid cursor');
    }
    const bytes = Buffer.from(cursor, 'base64url');
    const value: unknown = JSON.parse(bytes.toString('utf8'));
    if (
      bytes.toString('base64url') !== cursor ||
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).length !== 2 ||
      !('createdAt' in value) ||
      !('id' in value) ||
      typeof value.createdAt !== 'string' ||
      !/^(?!0000)\d{4}-\d{2}-\d{2}T/.test(value.createdAt) ||
      new Date(value.createdAt).toISOString() !== value.createdAt ||
      !isUuid(value.id)
    ) {
      throw new Error('Invalid cursor');
    }
    return { createdAt: value.createdAt, id: value.id };
  } catch {
    throw new BadRequestException('Invalid coupon list cursor');
  }
}
