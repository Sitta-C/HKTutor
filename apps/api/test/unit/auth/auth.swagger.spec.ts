import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';

import { configureApplication } from '@/app.setup';
import { AuthController } from '@/auth/auth.controller';
import { JwtAuthGuard } from '@/auth/auth.guard';
import { AuthService } from '@/auth/auth.service';
import { JWT_BEARER_AUTH, REFRESH_COOKIE_AUTH } from '@/auth/auth.swagger';
import { AuthConfigService } from '@/config/auth.config';

import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject, OperationObject } from '@nestjs/swagger';
import type { TestingModule } from '@nestjs/testing';
import type { App } from 'supertest/types';

describe('authentication Swagger contract', () => {
  let app: INestApplication<App>;
  let document: OpenAPIObject;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: {} },
        { provide: AuthConfigService, useValue: {} },
      ],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleFixture.createNestApplication();
    configureApplication(app);
    await app.init();
    const response = await request(app.getHttpServer()).get('/api/v1/docs-json').expect(200);
    document = response.body as OpenAPIObject;
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([
    ['post', '/api/v1/auth/register', 'Register with email and password'],
    ['post', '/api/v1/auth/verify-email', 'Verify an email address and start a session'],
    ['post', '/api/v1/auth/resend-verification', 'Send a new email verification link'],
    ['post', '/api/v1/auth/login', 'Sign in with email and password'],
    ['post', '/api/v1/auth/refresh', 'Rotate the refresh session and issue a new access token'],
    ['post', '/api/v1/auth/logout', 'Revoke the current refresh session'],
    ['get', '/api/v1/auth/me', 'Return the user authenticated by the access token'],
  ])('documents %s %s', (method, path, summary) => {
    expect(operation(method, path).summary).toBe(summary);
  });

  it('documents access-token and refresh-cookie security independently', () => {
    expect(operation('get', '/api/v1/auth/me').security).toEqual([{ [JWT_BEARER_AUTH]: [] }]);
    expect(operation('post', '/api/v1/auth/refresh').security).toEqual([
      { [REFRESH_COOKIE_AUTH]: [] },
    ]);
    expect(operation('post', '/api/v1/auth/logout').security).toEqual([
      { [REFRESH_COOKIE_AUTH]: [] },
    ]);
  });

  it('shows authentication responses without exposing refresh tokens in JSON', () => {
    const login = operation('post', '/api/v1/auth/login');
    const serialized = JSON.stringify(login.responses['200']);

    expect(serialized).toContain('accessToken');
    expect(serialized).toContain('Set-Cookie');
    expect(serialized).not.toContain('refreshToken');
    expect(login.responses).toHaveProperty('401');
    expect(login.responses).toHaveProperty('403');
    expect(login.responses).toHaveProperty('429');
  });

  function operation(method: string, path: string): OperationObject {
    const item = document.paths[path];
    const found = item?.[method as keyof typeof item] as OperationObject | undefined;
    if (!found) throw new Error(`Missing Swagger operation ${method.toUpperCase()} ${path}`);
    return found;
  }
});
