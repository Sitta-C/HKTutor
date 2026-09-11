import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import request from 'supertest';

import { configureApplication } from '@/app.setup';
import { REFRESH_COOKIE_NAME } from '@/auth/auth.constants';
import { AuthController } from '@/auth/auth.controller';
import { JwtAuthGuard } from '@/auth/auth.guard';
import { AuthService } from '@/auth/auth.service';
import { AuthConfigService } from '@/config/auth.config';

import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';

describe('AuthController HTTP contract (e2e)', () => {
  let app: INestApplication<App>;
  const auth = {
    login: jest.fn(),
    logout: jest.fn(),
    refresh: jest.fn(),
    register: jest.fn(),
  };
  const config = {
    refreshCookieOptions: {
      httpOnly: true,
      maxAge: 60_000,
      path: '/',
      sameSite: 'lax' as const,
      secure: false,
    },
  };

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: AuthConfigService, useValue: config },
      ],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  afterEach(() => jest.resetAllMocks());

  it('rejects public admin registration before calling the auth service', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: 'admin@example.com',
        password: 'password123',
        role: 'admin',
        consent: true,
        policyVersion: '2026-09-09',
      })
      .expect(400);

    expect(auth.register).not.toHaveBeenCalled();
  });

  it('rejects unverified-email login without issuing a refresh cookie', async () => {
    auth.login.mockRejectedValue(new ForbiddenException('Verify your email before signing in'));

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'student@example.com', password: 'password123' })
      .expect(403);

    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('rotates the refresh cookie after a successful refresh', async () => {
    auth.refresh.mockResolvedValue({
      accessToken: 'rotated-access-token',
      expiresIn: 900,
      refreshToken: 'rotated-refresh-token',
      user: { id: 'user-id', email: 'student@example.com', role: 'STUDENT' },
    });

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', `${REFRESH_COOKIE_NAME}=old-refresh-token`)
      .expect(200);

    expect(auth.refresh).toHaveBeenCalledWith('old-refresh-token');
    expect(response.body).toMatchObject({ accessToken: 'rotated-access-token', expiresIn: 900 });
    expect(response.headers['set-cookie']).toEqual(
      expect.arrayContaining([
        expect.stringContaining(`${REFRESH_COOKIE_NAME}=rotated-refresh-token`),
      ]),
    );
  });

  it('returns unauthorized for a refresh failure and does not issue a cookie', async () => {
    auth.refresh.mockRejectedValue(new UnauthorizedException('Invalid or expired refresh token'));

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', `${REFRESH_COOKIE_NAME}=reused-refresh-token`)
      .expect(401);

    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('revokes the session and clears the refresh cookie on logout', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Cookie', `${REFRESH_COOKIE_NAME}=refresh-token`)
      .expect(204);

    expect(auth.logout).toHaveBeenCalledWith('refresh-token');
    expect(response.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringMatching(new RegExp(`${REFRESH_COOKIE_NAME}=;`))]),
    );
  });
});
