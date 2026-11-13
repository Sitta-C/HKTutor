import { BadRequestException } from '@nestjs/common';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Rejects non-empty objects and non-object JSON payloads (arrays, primitives, null) on routes
 * that accept no body, keeping validation uniform beyond class-validator property whitelisting.
 */
export function assertEmptyBody(
  body: unknown,
  message = 'Request accepts an empty body only',
): void {
  if (body !== undefined && (!isPlainObject(body) || Object.keys(body).length !== 0)) {
    throw new BadRequestException(message);
  }
}
