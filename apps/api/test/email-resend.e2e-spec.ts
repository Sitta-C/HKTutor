import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import request from 'supertest';

import { configureApplication } from '@app/app.setup';
import { AuthConfigService } from '@config/auth.config';
import { AuthController } from '@modules/auth/auth.controller';
import { JwtAuthGuard } from '@modules/auth/auth.guard';
import { AuthService } from '@modules/auth/auth.service';
import { EmailFlowService, emailFlowCookieName } from '@modules/auth/email-flow.service';

import type { EmailFlowPurpose } from '@modules/auth/email-flow.service';
import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';

const NOW = new Date('2026-10-16T12:00:00Z').getTime();
const config = new AuthConfigService(
  new ConfigService({
    JWT_ACCESS_SECRET: 'test-secret-email-flow-over-thirty-two-characters',
    COOKIE_SECURE: 'true',
  }),
);
const flows = new EmailFlowService(config);
const auth = {
  register: jest.fn(),
  resendVerification: jest.fn(),
  forgotPassword: jest.fn(),
};

describe('email resend flow HTTP contract', () => {
  let app: INestApplication<App>;
  let now: jest.SpyInstance<number, []>;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: AuthConfigService, useValue: config },
        { provide: EmailFlowService, useValue: flows },
      ],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    app.use(cookieParser());
    configureApplication(app);
    await app.init();
  });
  beforeEach(() => {
    now = jest.spyOn(Date, 'now').mockReturnValue(NOW);
    auth.register.mockResolvedValue({ message: 'Generic registration result' });
    auth.resendVerification.mockResolvedValue({ message: 'Generic verification result' });
    auth.forgotPassword.mockResolvedValue({ message: 'Generic reset result' });
  });
  afterEach(() => {
    now.mockRestore();
    jest.clearAllMocks();
  });
  afterAll(async () => {
    await app.close();
  });

  function readyFlow(purpose: EmailFlowPurpose) {
    now.mockReturnValue(NOW - 61_000);
    const signed = flows.create('original@example.com', purpose);
    now.mockReturnValue(NOW);
    return { ...signed, header: `${emailFlowCookieName(purpose)}=${signed.cookie}` };
  }

  it('starts registration with a signed HttpOnly cookie bound to its normalized email', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: ' Original@Example.COM ',
        password: 'password123',
        role: 'student',
        consent: true,
        policyVersion: '2026-09-30',
      })
      .expect(201);
    expect(response.body).toHaveProperty('emailFlow.email', 'original@example.com');
    expect(response.body).toHaveProperty('emailFlow.retryAfterSeconds', 60);
    const cookies: unknown = response.headers['set-cookie'];
    expect(cookies).toEqual([
      expect.stringMatching(/hktutor_verification_flow=.*HttpOnly; Secure; SameSite=Strict/),
    ]);
    expect(response.body).not.toHaveProperty('accessToken');
  });

  it('preserves a resend flow when initial verification delivery fails', async () => {
    auth.register.mockRejectedValueOnce(new ServiceUnavailableException('Delivery failed'));
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: 'original@example.com',
        password: 'password123',
        role: 'student',
        consent: true,
        policyVersion: '2026-09-30',
      })
      .expect(503);
    expect(response.headers['set-cookie']).toEqual([
      expect.stringContaining('hktutor_verification_flow='),
    ]);
  });

  it.each(['verification', 'password-reset'] as const)(
    'restores %s email and wait after a reload without an account lookup',
    async (purpose) => {
      const signed = flows.create('original@example.com', purpose);
      now.mockReturnValue(NOW + 23_000);
      const response = await request(app.getHttpServer())
        .get(`/api/v1/auth/email-flow?purpose=${purpose}`)
        .set('Cookie', `${emailFlowCookieName(purpose)}=${signed.cookie}`)
        .expect(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).toMatchObject({
        id: signed.flow.id,
        email: 'original@example.com',
        retryAfterSeconds: 37,
      });
      expect(auth.resendVerification).not.toHaveBeenCalled();
      expect(auth.forgotPassword).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['verification', 'resend-verification'],
    ['password-reset', 'resend-password-reset'],
  ] as const)('sends %s only to the cookie-bound original address', async (purpose, endpoint) => {
    const signed = readyFlow(purpose);
    const response = await request(app.getHttpServer())
      .post(`/api/v1/auth/${endpoint}`)
      .set('Cookie', signed.header)
      .send({ flowId: signed.flow.id })
      .expect(200);
    expect(response.body).toHaveProperty('emailFlow.email', 'original@example.com');
    expect(response.body).toHaveProperty('emailFlow.retryAfterSeconds', 60);
    if (purpose === 'verification') {
      expect(auth.resendVerification).toHaveBeenCalledWith('original@example.com');
    } else {
      expect(auth.forgotPassword).toHaveBeenCalledWith({ email: 'original@example.com' });
    }
  });

  it.each([
    ['verification', 'resend-verification'],
    ['password-reset', 'resend-password-reset'],
  ] as const)('blocks early %s resend with a server Retry-After', async (purpose, endpoint) => {
    const signed = flows.create('original@example.com', purpose);
    const response = await request(app.getHttpServer())
      .post(`/api/v1/auth/${endpoint}`)
      .set('Cookie', `${emailFlowCookieName(purpose)}=${signed.cookie}`)
      .send({ flowId: signed.flow.id })
      .expect(429);
    expect(response.headers['retry-after']).toBe('60');
    expect(auth.resendVerification).not.toHaveBeenCalled();
    expect(auth.forgotPassword).not.toHaveBeenCalled();
  });

  it.each(['missing', 'tampered', 'expired', 'wrong-purpose', 'stale-tab', 'email-substitution'])(
    'rejects a %s resend flow',
    async (reason) => {
      const signed = readyFlow('verification');
      let cookie = signed.header;
      if (reason === 'missing') {
        cookie = '';
      }
      if (reason === 'tampered') {
        cookie = cookie.slice(0, -5) + 'xxxxx';
      }
      if (reason === 'expired') {
        now.mockReturnValue(NOW + 86_400_000);
      }
      if (reason === 'wrong-purpose') {
        cookie = `hktutor_verification_flow=${readyFlow('password-reset').cookie}`;
      }
      const payload =
        reason === 'email-substitution'
          ? { flowId: signed.flow.id, email: 'other@example.com' }
          : {
              flowId:
                reason === 'stale-tab' ? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' : signed.flow.id,
            };
      await request(app.getHttpServer())
        .post('/api/v1/auth/resend-verification')
        .set('Cookie', cookie)
        .send(payload)
        .expect(400);
      expect(auth.resendVerification).not.toHaveBeenCalled();
    },
  );

  it('keeps separate cookies for verification and password recovery', () => {
    const verification = flows.create('original@example.com', 'verification');
    const reset = flows.create('other@example.com', 'password-reset');
    expect(() => flows.read(reset.cookie, 'verification')).toThrow('Email request has expired');
    expect(flows.read(verification.cookie, 'verification').email).toBe('original@example.com');
  });
});
