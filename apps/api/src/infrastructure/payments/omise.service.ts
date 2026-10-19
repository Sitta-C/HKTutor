import { createHmac, timingSafeEqual } from 'node:crypto';

import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';

import { isUuid } from '@common/pipes/uuid-param.pipe';
import { PaymentsConfigService } from '@config/payments.config';

export interface OmiseCharge {
  id: string;
  amount: number;
  currency: string;
  bookingId: string;
  attemptId: string;
  status: 'pending' | 'successful' | 'failed' | 'expired';
  paid: boolean;
  paidAt: Date | null;
  expiresAt: Date | null;
  qrCodeUrl: string | null;
  failureCode: string | null;
}

/** A definitive rejection permits a new attempt; transport/5xx failures do not. */
export class OmiseRequestRejected extends Error {}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function dateOrNull(value: unknown): Date | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new ServiceUnavailableException('Invalid payment provider timestamp');
  }
  return new Date(value);
}

function parseCharge(value: unknown): OmiseCharge {
  if (
    !isRecord(value) ||
    value['object'] !== 'charge' ||
    value['livemode'] !== false ||
    typeof value['id'] !== 'string' ||
    !/^chrg_test_[A-Za-z0-9]+$/.test(value['id']) ||
    typeof value['amount'] !== 'number' ||
    !Number.isSafeInteger(value['amount']) ||
    typeof value['currency'] !== 'string' ||
    typeof value['paid'] !== 'boolean' ||
    !isRecord(value['metadata']) ||
    !isUuid(value['metadata']['bookingId']) ||
    !isUuid(value['metadata']['attemptId']) ||
    !isRecord(value['source']) ||
    value['source']['type'] !== 'promptpay' ||
    (value['status'] !== 'pending' &&
      value['status'] !== 'successful' &&
      value['status'] !== 'failed' &&
      value['status'] !== 'expired')
  ) {
    throw new ServiceUnavailableException('Invalid test PromptPay charge');
  }
  let qrCodeUrl: string | null = null;
  const code = value['source']['scannable_code'];
  if (
    isRecord(code) &&
    isRecord(code['image']) &&
    typeof code['image']['download_uri'] === 'string'
  ) {
    const url = new URL(code['image']['download_uri']);
    if (url.origin !== 'https://api.omise.co' || url.username || url.password) {
      throw new ServiceUnavailableException('Invalid payment QR location');
    }
    qrCodeUrl = url.href;
  }
  const paidAt = dateOrNull(value['paid_at']);
  const expiresAt = dateOrNull(value['expires_at']);
  if (value['status'] === 'successful' && (!value['paid'] || !paidAt)) {
    throw new ServiceUnavailableException('Payment has not been captured');
  }
  if (value['status'] === 'pending' && (!qrCodeUrl || !expiresAt)) {
    throw new ServiceUnavailableException('Payment QR is unavailable');
  }
  return {
    id: value['id'],
    amount: value['amount'],
    currency: value['currency'].toUpperCase(),
    bookingId: value['metadata']['bookingId'],
    attemptId: value['metadata']['attemptId'],
    status: value['status'],
    paid: value['paid'],
    paidAt,
    expiresAt,
    qrCodeUrl,
    failureCode: typeof value['failure_code'] === 'string' ? value['failure_code'] : null,
  };
}

@Injectable()
export class OmiseService {
  constructor(private readonly config: PaymentsConfigService) {}

  assertEnabled(): void {
    if (!this.config.values.secretKey) {
      throw new ServiceUnavailableException('PromptPay test payments are not configured');
    }
  }

  async createCharge(input: {
    amount: number;
    bookingId: string;
    attemptId: string;
    expiresAt: Date;
  }): Promise<OmiseCharge> {
    const body = new URLSearchParams({
      amount: String(input.amount),
      currency: 'THB',
      'source[type]': 'promptpay',
      'metadata[bookingId]': input.bookingId,
      'metadata[attemptId]': input.attemptId,
      expires_at: input.expiresAt.toISOString(),
    });
    return parseCharge(await this.request('/charges', { method: 'POST', body }));
  }

  async retrieveCharge(chargeId: string): Promise<OmiseCharge> {
    if (!/^chrg_test_[A-Za-z0-9]+$/.test(chargeId)) {
      throw new ServiceUnavailableException('Invalid test charge identifier');
    }
    return parseCharge(await this.request(`/charges/${encodeURIComponent(chargeId)}`));
  }

  /** Recover a POST whose response was lost. Absence never authorizes another POST. */
  async findCharge(attemptId: string, createdAt: Date): Promise<OmiseCharge | null> {
    const from = new Date(createdAt.getTime() - 60_000).toISOString();
    const to = new Date().toISOString();
    for (let offset = 0; offset < 500; offset += 100) {
      const query = new URLSearchParams({
        from,
        to,
        limit: '100',
        offset: String(offset),
        order: 'chronological',
      });
      const page = await this.request(`/charges?${query}`);
      if (!isRecord(page) || !Array.isArray(page['data'])) {
        throw new ServiceUnavailableException('Invalid payment provider response');
      }
      const charges: unknown[] = page['data'];
      const match = charges.find(
        (charge) =>
          isRecord(charge) &&
          isRecord(charge['metadata']) &&
          charge['metadata']['attemptId'] === attemptId,
      );
      if (match) {
        return parseCharge(match);
      }
      if (charges.length < 100) {
        return null;
      }
    }
    return null;
  }

  verifyWebhook(
    rawBody: Buffer | undefined,
    timestamp: string | undefined,
    signatures: string | undefined,
  ): void {
    this.assertEnabled();
    if (
      !rawBody ||
      !timestamp ||
      !/^\d{10}$/.test(timestamp) ||
      !signatures ||
      signatures.length > 512 ||
      Math.abs(Date.now() / 1000 - Number(timestamp)) > 300
    ) {
      throw new UnauthorizedException('Invalid webhook signature');
    }
    const digest = createHmac('sha256', Buffer.from(this.config.values.webhookSecret, 'base64'))
      .update(timestamp)
      .update('.')
      .update(rawBody)
      .digest();
    const valid = signatures.split(',').some((signature) => {
      const value = signature.trim();
      return /^[a-fA-F0-9]{64}$/.test(value) && timingSafeEqual(digest, Buffer.from(value, 'hex'));
    });
    if (!valid) {
      throw new UnauthorizedException('Invalid webhook signature');
    }
  }

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    this.assertEnabled();
    try {
      const response = await fetch(`https://api.omise.co${path}`, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(12_000),
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.config.values.secretKey}:`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Omise-Version': '2019-05-29',
        },
      });
      if (!response.ok) {
        if (init.method === 'POST' && [400, 401, 402, 403, 404, 422].includes(response.status)) {
          throw new OmiseRequestRejected('Payment provider rejected the charge');
        }
        throw new ServiceUnavailableException('Payment provider is unavailable');
      }
      const payload: unknown = await response.json();
      return payload;
    } catch (error) {
      if (error instanceof OmiseRequestRejected || error instanceof ServiceUnavailableException) {
        throw error;
      }
      throw new ServiceUnavailableException(
        'Payment provider result is uncertain; refresh payment status',
      );
    }
  }
}
