import { BadRequestException } from '@nestjs/common';

import { UuidParamPipe } from '@/common/pipes/uuid-param.pipe';

import type { ArgumentMetadata } from '@nestjs/common';

const metadata: ArgumentMetadata = {
  data: 'tutorId',
  metatype: String,
  type: 'param',
};

describe('UuidParamPipe', () => {
  const pipe = new UuidParamPipe();

  it('returns a valid UUID unchanged', () => {
    const value = '20000000-0000-4000-8000-000000000001';

    expect(pipe.transform(value, metadata)).toBe(value);
  });

  it('rejects an invalid UUID with the shared API error shape', () => {
    expect(() => pipe.transform('not-a-uuid', metadata)).toThrow(
      new BadRequestException({
        code: 'INVALID_UUID',
        error: 'Bad Request',
        message: 'tutorId must be a valid UUID',
        statusCode: 400,
      }),
    );
  });

  it('uses id when parameter metadata has no name', () => {
    expect(() => pipe.transform('not-a-uuid', { type: 'param' })).toThrow(
      new BadRequestException({
        code: 'INVALID_UUID',
        error: 'Bad Request',
        message: 'id must be a valid UUID',
        statusCode: 400,
      }),
    );
  });
});
