import { BadRequestException } from '@nestjs/common';

import { isUuid } from '@common/pipes/uuid-param.pipe';
import { MAX_TUTOR_REVIEWS_CURSOR_LENGTH } from '@modules/reviews/reviews.dto';

/** Where a page of one tutor's review list ended: the last item's createdAt and ID. */
export interface TutorReviewsCursor {
  createdAt: string;
  id: string;
}

export function encodeTutorReviewsCursor(cursor: TutorReviewsCursor & { tutorId: string }): string {
  return Buffer.from(
    JSON.stringify({ createdAt: cursor.createdAt, id: cursor.id, tutorId: cursor.tutorId }),
  ).toString('base64url');
}

/**
 * Decodes a review-list cursor and checks it was minted for this exact tutor, so a cursor cannot
 * be replayed against a different tutor's list: a mismatch is reported the same as a malformed one.
 */
export function decodeTutorReviewsCursor(cursor: string, tutorId: string): TutorReviewsCursor {
  try {
    if (cursor.length > MAX_TUTOR_REVIEWS_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
      throw new Error('Invalid cursor');
    }
    const bytes = Buffer.from(cursor, 'base64url');
    const value: unknown = JSON.parse(bytes.toString('utf8'));
    if (
      bytes.toString('base64url') !== cursor ||
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).length !== 3 ||
      !('createdAt' in value) ||
      !('id' in value) ||
      !('tutorId' in value) ||
      typeof value.createdAt !== 'string' ||
      // Public API timestamps use four-digit AD years. Date also accepts extreme BC dates
      // outside PostgreSQL's range; reject forged boundaries before they reach persistence.
      !/^(?!0000)\d{4}-\d{2}-\d{2}T/.test(value.createdAt) ||
      new Date(value.createdAt).toISOString() !== value.createdAt ||
      !isUuid(value.id) ||
      value.tutorId !== tutorId
    ) {
      throw new Error('Invalid cursor');
    }
    return { createdAt: value.createdAt, id: value.id };
  } catch {
    throw new BadRequestException('Invalid review list cursor');
  }
}
