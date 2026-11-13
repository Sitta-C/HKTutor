import { BadRequestException } from '@nestjs/common';

import { assertEmptyBody } from '@common/pipes/empty-body';

describe('assertEmptyBody', () => {
  it('accepts undefined and an empty plain object', () => {
    expect(() => assertEmptyBody(undefined)).not.toThrow();
    expect(() => assertEmptyBody({})).not.toThrow();
  });

  it.each([
    ['non-empty object', { tutorId: '123' }],
    ['array', ['extra']],
    ['null', null],
    ['string', 'unexpected'],
    ['number', 42],
    ['boolean', true],
  ])('throws BadRequestException with the provided message for %s', (_label, payload) => {
    expect(() => assertEmptyBody(payload, 'Custom empty body message')).toThrow(
      new BadRequestException('Custom empty body message'),
    );
  });
});
