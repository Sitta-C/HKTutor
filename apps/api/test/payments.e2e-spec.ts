import { createHmac } from 'node:crypto';

import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { configureApplication } from '@app/app.setup';
import { PaymentsConfigService } from '@config/payments.config';
import { AccountStatus, Role } from '@generated/prisma/enums';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { OmiseService } from '@infrastructure/payments/omise.service';
import { JwtAuthGuard } from '@modules/auth/auth.guard';
import { JwtTokenService } from '@modules/auth/jwt.service';
import { ResourceOwnershipGuard } from '@modules/auth/ownership.guard';
import { RolesGuard } from '@modules/auth/roles.guard';
import { BookingsController } from '@modules/bookings/bookings.controller';
import { BookingsService } from '@modules/bookings/bookings.service';
import { OmiseWebhookController, PaymentsController } from '@modules/payments/payments.controller';
import { PaymentsService } from '@modules/payments/payments.service';

import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';

const STUDENT_ID = '30000000-0000-4000-8000-000000000001';
const BOOKING_ID = '40000000-0000-4000-8000-000000000001';
const SECRET = Buffer.alloc(32, 7).toString('base64');
const BASE = `/api/v1/bookings/me/${BOOKING_ID}/payments`;

describe('PromptPay HTTP contract', () => {
  let app: INestApplication<App>;
  const payments = { create: jest.fn(), getStatus: jest.fn(), webhook: jest.fn() };
  const verifyAccessToken = jest.fn();
  const session = jest.fn();
  const booking = jest.fn();

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [PaymentsController, OmiseWebhookController, BookingsController],
      providers: [
        { provide: PaymentsService, useValue: payments },
        { provide: BookingsService, useValue: {} },
        {
          provide: ConfigService,
          useValue: new ConfigService({
            OMISE_SECRET_KEY: 'skey_test_example123',
            OMISE_WEBHOOK_SECRET: SECRET,
          }),
        },
        PaymentsConfigService,
        OmiseService,
        JwtAuthGuard,
        RolesGuard,
        ResourceOwnershipGuard,
        { provide: JwtTokenService, useValue: { verifyAccessToken } },
        {
          provide: PrismaService,
          useValue: { authSession: { findUnique: session }, booking: { findUnique: booking } },
        },
      ],
    }).compile();
    app = module.createNestApplication({ rawBody: true });
    configureApplication(app);
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    jest.resetAllMocks();
    authenticate(Role.STUDENT);
    booking.mockResolvedValue({ studentUserId: STUDENT_ID, tutorProfileId: 'tutor' });
    payments.create.mockResolvedValue({
      bookingId: BOOKING_ID,
      paymentStatus: 'UNPAID',
      paymentPending: true,
    });
    payments.getStatus.mockResolvedValue({ bookingId: BOOKING_ID, paymentStatus: 'PAID' });
  });

  it('requires authentication for creation and status reads', async () => {
    await request(app.getHttpServer()).post(`${BASE}/promptpay`).expect(401);
    await request(app.getHttpServer()).get(`${BASE}/current`).expect(401);
    expect(payments.create).not.toHaveBeenCalled();
    expect(payments.getStatus).not.toHaveBeenCalled();
  });

  it.each([Role.TUTOR, Role.ADMIN])('rejects the %s role', async (role) => {
    authenticate(role);
    await request(app.getHttpServer())
      .post(`${BASE}/promptpay`)
      .auth('test', { type: 'bearer' })
      .expect(403);
    await request(app.getHttpServer())
      .get(`${BASE}/current`)
      .auth('test', { type: 'bearer' })
      .expect(403);
    expect(payments.create).not.toHaveBeenCalled();
  });

  it('rejects a foreign booking before calling the payment service', async () => {
    booking.mockResolvedValue({ studentUserId: 'someone-else', tutorProfileId: 'tutor' });
    await request(app.getHttpServer())
      .post(`${BASE}/promptpay`)
      .auth('test', { type: 'bearer' })
      .expect(403);
    expect(payments.create).not.toHaveBeenCalled();
  });

  it('returns 404 for missing bookings and 400 for invalid UUIDs', async () => {
    booking.mockResolvedValue(null);
    await request(app.getHttpServer())
      .get(`${BASE}/current`)
      .auth('test', { type: 'bearer' })
      .expect(404);
    await request(app.getHttpServer())
      .get('/api/v1/bookings/me/invalid/payments/current')
      .auth('test', { type: 'bearer' })
      .expect(400);
  });

  it('takes identity from the session, accepts no client amount and disables caching', async () => {
    await request(app.getHttpServer())
      .post(`${BASE}/promptpay`)
      .auth('test', { type: 'bearer' })
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(payments.create).toHaveBeenCalledWith(BOOKING_ID, STUDENT_ID);
    await request(app.getHttpServer())
      .get(`${BASE}/current`)
      .auth('test', { type: 'bearer' })
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(payments.getStatus).toHaveBeenCalledWith(BOOKING_ID, STUDENT_ID);
    payments.create.mockClear();
    await request(app.getHttpServer())
      .post(`${BASE}/promptpay`)
      .auth('test', { type: 'bearer' })
      .send({ amount: '1.00', studentUserId: 'other' })
      .expect(400);
    expect(payments.create).not.toHaveBeenCalled();
  });

  it('retires the old mock-payment endpoint with no payment write', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/bookings/me/${BOOKING_ID}/mock-payment`)
      .auth('test', { type: 'bearer' })
      .send({ amount: '450.00', reference: 'DEMO-1' })
      .expect(410);
    expect(payments.create).not.toHaveBeenCalled();
  });

  it('accepts a signed webhook without JWT and verifies the unmodified raw bytes', async () => {
    const body =
      '{ "object": "event", "livemode": false, "key": "charge.complete", "data": {"id":"chrg_test_example123"} }';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac('sha256', Buffer.from(SECRET, 'base64'))
      .update(`${timestamp}.${body}`)
      .digest('hex');
    await request(app.getHttpServer())
      .post('/api/v1/payments/omise/webhook')
      .set('Content-Type', 'application/json')
      .set('Omise-Signature-Timestamp', timestamp)
      .set('Omise-Signature', signature)
      .send(body)
      .expect(200)
      .expect({ received: true });
    expect(payments.webhook).toHaveBeenCalledWith(JSON.parse(body));
    payments.webhook.mockClear();
    await request(app.getHttpServer())
      .post('/api/v1/payments/omise/webhook')
      .set('Omise-Signature-Timestamp', timestamp)
      .set('Omise-Signature', signature)
      .send({ object: 'event' })
      .expect(401);
    expect(payments.webhook).not.toHaveBeenCalled();
  });

  function authenticate(role: Role): void {
    verifyAccessToken.mockReturnValue({ sid: 'session-id', sub: STUDENT_ID });
    session.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      id: 'session-id',
      revokedAt: null,
      user: {
        accountStatus: AccountStatus.ACTIVE,
        deletedAt: null,
        email: 'student@example.test',
        emailVerifiedAt: new Date(),
        id: STUDENT_ID,
        role,
      },
      userId: STUDENT_ID,
    });
  }
});
