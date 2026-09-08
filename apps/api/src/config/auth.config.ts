import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { CookieOptions } from 'express';

const TEST_VALUES: Record<string, string> = {
  JWT_ACCESS_SECRET: 'test-access-secret-that-is-at-least-thirty-two-characters',
  JWT_REFRESH_SECRET: 'test-refresh-secret-that-is-at-least-thirty-two-characters',
  RESEND_API_KEY: 're_test_placeholder',
  EMAIL_FROM: 'HKTutor <no-reply@hktutor.test>',
};

function positiveInteger(value: string | undefined, fallback: number, key: string): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }
  return parsed;
}

export function validateAuthEnvironment(config: Record<string, unknown>): Record<string, unknown> {
  if (config['NODE_ENV'] === 'test') return config;

  for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'RESEND_API_KEY', 'EMAIL_FROM']) {
    const value = config[key];
    if (typeof value !== 'string' || !value.trim() || /^\[.*\]$/.test(value.trim())) {
      throw new Error(`${key} is required`);
    }
  }

  for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
    if ((config[key] as string).length < 32) {
      throw new Error(`${key} must be at least 32 characters`);
    }
  }

  if (config['JWT_ACCESS_SECRET'] === config['JWT_REFRESH_SECRET']) {
    throw new Error('JWT access and refresh secrets must be different');
  }

  return config;
}

@Injectable()
export class AuthConfigService {
  constructor(private readonly config: ConfigService) {}

  get accessSecret(): string {
    return this.required('JWT_ACCESS_SECRET');
  }

  get refreshSecret(): string {
    return this.required('JWT_REFRESH_SECRET');
  }

  get issuer(): string {
    return this.config.get<string>('JWT_ISSUER', 'hktutor-api');
  }

  get audience(): string {
    return this.config.get<string>('JWT_AUDIENCE', 'hktutor-web');
  }

  get accessTtlSeconds(): number {
    return positiveInteger(
      this.config.get<string>('JWT_ACCESS_TTL_SECONDS'),
      900,
      'JWT_ACCESS_TTL_SECONDS',
    );
  }

  get refreshTtlSeconds(): number {
    return positiveInteger(
      this.config.get<string>('JWT_REFRESH_TTL_SECONDS'),
      604_800,
      'JWT_REFRESH_TTL_SECONDS',
    );
  }

  get verificationTtlMinutes(): number {
    return positiveInteger(
      this.config.get<string>('EMAIL_VERIFICATION_TTL_MINUTES'),
      60,
      'EMAIL_VERIFICATION_TTL_MINUTES',
    );
  }

  get appUrl(): string {
    return this.config.get<string>('APP_URL', 'http://localhost:3000');
  }

  get webOrigin(): string {
    return this.config.get<string>('WEB_ORIGIN', 'http://localhost:3000');
  }

  get resendApiKey(): string {
    return this.required('RESEND_API_KEY');
  }

  get emailFrom(): string {
    return this.required('EMAIL_FROM');
  }

  get refreshCookieOptions(): CookieOptions {
    const secure = this.config.get<string>('COOKIE_SECURE', 'false') === 'true';
    const sameSite = this.config.get<'lax' | 'strict' | 'none'>('COOKIE_SAME_SITE', 'lax');
    const domain = this.config.get<string>('COOKIE_DOMAIN')?.trim();

    return {
      domain: domain || undefined,
      httpOnly: true,
      maxAge: this.refreshTtlSeconds * 1000,
      path: '/',
      sameSite,
      secure,
    };
  }

  private required(key: string): string {
    const value = this.config.get<string>(key);
    if (value?.trim()) return value;
    if (process.env['NODE_ENV'] === 'test') return TEST_VALUES[key] ?? `test-${key}`;
    throw new Error(`${key} is required`);
  }
}
