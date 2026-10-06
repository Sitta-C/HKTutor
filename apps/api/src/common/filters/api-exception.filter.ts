import { STATUS_CODES } from 'node:http';

import { Catch, HttpException, Logger } from '@nestjs/common';

import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';

/**
 * Default `code` per status for exceptions that do not carry a domain code of their own, so
 * validation, authentication and role failures are machine-readable like the domain errors are.
 */
const DEFAULT_CODES: Record<number, string> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  429: 'TOO_MANY_REQUESTS',
};
const CLIENT_FALLBACK_CODE = 'REQUEST_FAILED';
const SERVER_FALLBACK_CODE = 'INTERNAL_ERROR';

/**
 * Gives every HTTP error one envelope: `{ statusCode, error, message, code }`. An exception that
 * already sets its own `code` — `INVALID_UUID`, the booking ownership and transition errors — keeps
 * it untouched; unexpected failures return a generic 500 without exposing provider details.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter<unknown> {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const thrown =
      exception instanceof HttpException ? exception.getResponse() : 'Internal server error';
    if (!(exception instanceof HttpException)) {
      this.logger.error('An unexpected API operation failed');
    }
    const body: Record<string, unknown> =
      typeof thrown === 'string' ? { message: thrown } : { ...thrown };

    body['statusCode'] ??= status;
    body['error'] ??= STATUS_CODES[status] ?? 'Error';
    body['message'] ??= STATUS_CODES[status] ?? 'Request failed';
    body['code'] ??=
      DEFAULT_CODES[status] ?? (status >= 500 ? SERVER_FALLBACK_CODE : CLIENT_FALLBACK_CODE);

    host.switchToHttp().getResponse<Response>().status(status).json(body);
  }
}
