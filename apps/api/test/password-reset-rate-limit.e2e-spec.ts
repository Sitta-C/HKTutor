import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';

import { configureApplication } from '@app/app.setup';
import { AuthConfigService } from '@config/auth.config';
import { AuthController } from '@modules/auth/auth.controller';
import { JwtAuthGuard } from '@modules/auth/auth.guard';
import { AuthService } from '@modules/auth/auth.service';
import { EmailFlowService } from '@modules/auth/email-flow.service';

import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';

describe('password reset rate limits', () => {
  let app: INestApplication<App>;
  const auth = {
    forgotPassword: jest.fn().mockResolvedValue({ message: 'Generic result' }),
    resetPassword: jest.fn().mockResolvedValue({ message: 'Password reset' }),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ limit: 100, ttl: 60_000 }])],
      controllers: [AuthController],
      providers: [
        EmailFlowService,
        { provide: AuthService, useValue: auth },
        {
          provide: AuthConfigService,
          useValue: {
            accessSecret: 'test-email-flow-secret-more-than-thirty-two-characters',
            audience: 'hktutor-web',
            issuer: 'hktutor-api',
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });

  it('limits recovery requests to three per IP per minute', async () => {
    for (let count = 0; count < 3; count += 1) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send({ email: `student${count}@example.com` })
        .expect(200);
    }
    await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'another@example.com' })
      .expect(429);
    expect(auth.forgotPassword).toHaveBeenCalledTimes(3);
  });

  it('limits token redemption to five per IP per minute', async () => {
    for (let count = 0; count < 5; count += 1) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/reset-password')
        .send({ token: 'a'.repeat(43), password: 'password123' })
        .expect(200);
    }
    await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token: 'a'.repeat(43), password: 'password123' })
      .expect(429);
    expect(auth.resetPassword).toHaveBeenCalledTimes(5);
  });
});
