import { BadRequestException, Injectable } from '@nestjs/common';

import type { ArgumentMetadata, PipeTransform } from '@nestjs/common';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function invalidUuidException(parameterName: string): BadRequestException {
  return new BadRequestException({
    code: 'INVALID_UUID',
    error: 'Bad Request',
    message: `${parameterName} must be a valid UUID`,
    statusCode: 400,
  });
}

@Injectable()
export class UuidParamPipe implements PipeTransform<unknown, string> {
  transform(value: unknown, metadata: ArgumentMetadata): string {
    if (!isUuid(value)) {
      throw invalidUuidException(typeof metadata.data === 'string' ? metadata.data : 'id');
    }

    return value;
  }
}
