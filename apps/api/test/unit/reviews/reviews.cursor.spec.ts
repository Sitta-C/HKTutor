import { BadRequestException } from '@nestjs/common';

import {
  decodeTutorReviewsCursor,
  encodeTutorReviewsCursor,
} from '@modules/reviews/reviews.cursor';

const TUTOR_ID = '6f1c2b8e-3d4a-4f5b-9c7d-2e8a1b0c9d3f';
const OTHER_TUTOR_ID = '7a2d3c9f-4e5b-4a6c-8d7e-3f9b2c1d0e4a';
const REVIEW_ID = 'b8d2a1c4-6e5f-4a3b-9c8d-1e2f3a4b5c6d';
const CREATED_AT = '2026-09-30T08:05:00.000Z';

const encodeJson = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

describe('tutor reviews list cursor', () => {
  it('decodes the cursor it encodes for the same tutor', () => {
    const cursor = encodeTutorReviewsCursor({
      createdAt: CREATED_AT,
      id: REVIEW_ID,
      tutorId: TUTOR_ID,
    });

    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeTutorReviewsCursor(cursor, TUTOR_ID)).toEqual({
      createdAt: CREATED_AT,
      id: REVIEW_ID,
    });
  });

  it('rejects the same cursor replayed against a different tutor', () => {
    const cursor = encodeTutorReviewsCursor({
      createdAt: CREATED_AT,
      id: REVIEW_ID,
      tutorId: TUTOR_ID,
    });

    expect(() => decodeTutorReviewsCursor(cursor, OTHER_TUTOR_ID)).toThrow(
      new BadRequestException('Invalid review list cursor'),
    );
  });

  it.each([
    ['characters outside base64url', 'abc+/='],
    ['a cursor over 512 characters', 'a'.repeat(513)],
    ['text that is not JSON', Buffer.from('not json').toString('base64url')],
    ['a missing tutorId', encodeJson({ createdAt: CREATED_AT, id: REVIEW_ID })],
    [
      'an extra key',
      encodeJson({ createdAt: CREATED_AT, id: REVIEW_ID, page: 2, tutorId: TUTOR_ID }),
    ],
    [
      'an id that is not a UUID',
      encodeJson({ createdAt: CREATED_AT, id: 'r-10', tutorId: TUTOR_ID }),
    ],
    [
      'a date without a time',
      encodeJson({ createdAt: '2026-09-30', id: REVIEW_ID, tutorId: TUTOR_ID }),
    ],
    [
      'a value that is not a date',
      encodeJson({ createdAt: 'yesterday', id: REVIEW_ID, tutorId: TUTOR_ID }),
    ],
  ])('rejects %s with 400', (_label, cursor) => {
    expect(() => decodeTutorReviewsCursor(cursor, TUTOR_ID)).toThrow(
      new BadRequestException('Invalid review list cursor'),
    );
  });
});
