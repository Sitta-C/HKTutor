import { createHmac } from 'node:crypto';

import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PaymentsConfigService, validatePaymentsEnvironment } from '@config/payments.config';
import { OmiseRequestRejected, OmiseService } from '@infrastructure/payments/omise.service';

const SECRET = Buffer.alloc(32, 7).toString('base64');
const BOOKING_ID = '30000000-0000-4000-8000-000000000001';
const ATTEMPT_ID = '40000000-0000-4000-8000-000000000001';
const CHARGE_ID = 'chrg_test_example123';

const charge = () => ({
  object: 'charge',
  id: CHARGE_ID,
  livemode: false,
  amount: 45000,
  currency: 'thb',
  status: 'pending',
  paid: false,
  paid_at: null,
  expires_at: '2030-01-01T00:15:00.000Z',
  metadata: { bookingId: BOOKING_ID, attemptId: ATTEMPT_ID },
  source: {
    type: 'promptpay',
    scannable_code: { image: { download_uri: 'https://api.omise.co/charges/qr.svg' } },
  },
});

describe('Omise test gateway', () => {
  const fetchMock = jest.fn<Promise<Response>, Parameters<typeof fetch>>();
  const originalFetch = global.fetch;
  let service: OmiseService;

  beforeEach(() => {
    service = new OmiseService(
      new PaymentsConfigService(
        new ConfigService({
          OMISE_SECRET_KEY: 'skey_test_example123',
          OMISE_WEBHOOK_SECRET: SECRET,
        }),
      ),
    );
    global.fetch = fetchMock;
  });
  afterEach(() => {
    global.fetch = originalFetch;
    jest.resetAllMocks();
  });

  it('creates a PromptPay charge with satang, metadata and no public key', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(charge()), { status: 200 }));
    const result = await service.createCharge({
      amount: 45000,
      bookingId: BOOKING_ID,
      attemptId: ATTEMPT_ID,
      expiresAt: new Date('2030-01-01T00:15:00Z'),
    });
    expect(result).toMatchObject({ id: CHARGE_ID, currency: 'THB', amount: 45000 });
    const request = fetchMock.mock.calls[0]?.[1];
    expect(request?.body).toBeInstanceOf(URLSearchParams);
    if (!(request?.body instanceof URLSearchParams)) {
      throw new Error('Expected form body');
    }
    expect(request.body.get('source[type]')).toBe('promptpay');
    expect(request.body.get('amount')).toBe('45000');
    expect(request.body.get('metadata[attemptId]')).toBe(ATTEMPT_ID);
    expect(request.redirect).toBe('error');
  });

  it.each([
    { livemode: true },
    { source: { type: 'card' } },
    { paid: false, status: 'successful', paid_at: '2030-01-01T00:00:00Z' },
    { metadata: { bookingId: 'invalid', attemptId: ATTEMPT_ID } },
    {
      source: {
        type: 'promptpay',
        scannable_code: { image: { download_uri: 'https://evil.example/qr' } },
      },
    },
  ])('rejects unsafe or inconsistent provider data: %j', async (change) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ...charge(), ...change })));
    await expect(service.retrieveCharge(CHARGE_ID)).rejects.toThrow(ServiceUnavailableException);
  });

  it('distinguishes a definitive rejection from an uncertain network outcome and never retries POST', async () => {
    const input = {
      amount: 45000,
      bookingId: BOOKING_ID,
      attemptId: ATTEMPT_ID,
      expiresAt: new Date(),
    };
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 400 }));
    await expect(service.createCharge(input)).rejects.toThrow(OmiseRequestRejected);
    fetchMock.mockRejectedValueOnce(new Error('network error'));
    await expect(service.createCharge(input)).rejects.toThrow(ServiceUnavailableException);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('recovers a lost creation response from charge metadata', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: [charge()] })));
    await expect(service.findCharge(ATTEMPT_ID, new Date())).resolves.toMatchObject({
      id: CHARGE_ID,
    });
    expect(fetchMock.mock.calls[0]?.[0]).toEqual(expect.stringContaining('/charges?'));
  });

  it('verifies the exact raw body and supports dual signatures during secret rotation', () => {
    const body = Buffer.from('{ "object": "event" }');
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac('sha256', Buffer.from(SECRET, 'base64'))
      .update(`${timestamp}.`)
      .update(body)
      .digest('hex');
    expect(() =>
      service.verifyWebhook(body, timestamp, `${'0'.repeat(64)},${signature}`),
    ).not.toThrow();
    expect(() => service.verifyWebhook(Buffer.from('{}'), timestamp, signature)).toThrow(
      UnauthorizedException,
    );
    expect(() => service.verifyWebhook(body, timestamp, 'abc')).toThrow(UnauthorizedException);
    expect(() => service.verifyWebhook(body, '1000000000', signature)).toThrow(
      UnauthorizedException,
    );
    expect(() => service.verifyWebhook(body, undefined, undefined)).toThrow(UnauthorizedException);
  });

  it('permits disabled payments but rejects live keys, partial configuration and invalid secrets', () => {
    expect(() => validatePaymentsEnvironment({})).not.toThrow();
    for (const values of [
      { OMISE_SECRET_KEY: 'skey_live_example', OMISE_WEBHOOK_SECRET: SECRET },
      { OMISE_SECRET_KEY: 'skey_test_example' },
      { OMISE_SECRET_KEY: 'skey_test_example', OMISE_WEBHOOK_SECRET: 'REPLACE_ME' },
    ]) {
      expect(() => validatePaymentsEnvironment(values)).toThrow();
    }
    const disabled = new OmiseService(new PaymentsConfigService(new ConfigService({})));
    expect(() => disabled.assertEnabled()).toThrow(ServiceUnavailableException);
  });
});
