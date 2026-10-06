import { ServiceUnavailableException } from '@nestjs/common';

const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

function failureCode(error: unknown, depth = 0): string {
  if (!error || typeof error !== 'object') {
    return 'STORAGE_REQUEST_FAILED';
  }
  if (
    'status' in error &&
    typeof error.status === 'number' &&
    Number.isInteger(error.status) &&
    error.status >= 400 &&
    error.status <= 599
  ) {
    return `STORAGE_HTTP_${error.status}`;
  }
  if ('code' in error && typeof error.code === 'string' && NETWORK_CODES.has(error.code)) {
    return error.code;
  }
  if ('name' in error && error.name === 'TimeoutError') {
    return 'STORAGE_TIMEOUT';
  }
  if ('name' in error && error.name === 'AbortError') {
    return 'STORAGE_ABORTED';
  }
  if (depth < 2) {
    if ('originalError' in error) {
      return failureCode(error.originalError, depth + 1);
    }
    if ('cause' in error) {
      return failureCode(error.cause, depth + 1);
    }
  }
  return 'STORAGE_REQUEST_FAILED';
}

/** Keeps a bounded diagnostic code server-side; the HTTP response remains a sanitized 503. */
export class StorageRequestError extends ServiceUnavailableException {
  readonly failureCode: string;

  constructor(message: string, error: unknown) {
    super(message);
    this.failureCode = failureCode(error);
  }
}
