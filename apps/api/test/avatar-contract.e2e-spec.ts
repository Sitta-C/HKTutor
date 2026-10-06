import { UnauthorizedException } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';

import { configureApplication } from '@app/app.setup';
import { Role } from '@generated/prisma/client';
import { JwtAuthGuard } from '@modules/auth/auth.guard';
import { JWT_BEARER_AUTH } from '@modules/auth/auth.swagger';
import { RolesGuard } from '@modules/auth/roles.guard';
import {
  AvatarsController,
  PublicTutorAvatarsController,
} from '@modules/avatars/avatars.controller';
import { AvatarsService } from '@modules/avatars/avatars.service';

import type { AuthenticatedRequest } from '@modules/auth/auth.guard';
import type { ExecutionContext, INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';

const OWNER_ID = '20000000-0000-4000-8000-000000000001';
const UPDATED_AT = '2026-10-06T07:00:00.000Z';

describe('Avatar multipart and authorization contract', () => {
  let app: INestApplication<App>;
  const service = {
    upload: jest.fn(),
    remove: jest.fn(),
    getMine: jest.fn(),
    getPublicTutor: jest.fn(),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ limit: 100, ttl: 60000 }])],
      controllers: [AvatarsController, PublicTutorAvatarsController],
      providers: [RolesGuard, { provide: AvatarsService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
          const token = req.headers.authorization;
          if (!token || !['Bearer student', 'Bearer tutor', 'Bearer admin'].includes(token)) {
            throw new UnauthorizedException();
          }
          req.auth = {
            id: OWNER_ID,
            email: 'user@example.test',
            sessionId: 'session-id',
            role:
              token === 'Bearer student'
                ? Role.STUDENT
                : token === 'Bearer tutor'
                  ? Role.TUTOR
                  : Role.ADMIN,
          };
          return true;
        },
      })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    service.upload.mockResolvedValue({ avatarUpdatedAt: UPDATED_AT });
    service.remove.mockResolvedValue({ avatarUpdatedAt: null });
    service.getMine.mockResolvedValue({ avatar: null });
    service.getPublicTutor.mockResolvedValue({ avatar: null });
  });

  it.each(['student', 'tutor'])(
    'accepts one multipart file for %s with an authenticated owner ID',
    async (role) => {
      await request(app.getHttpServer())
        .post('/api/v1/profiles/me/avatar')
        .set('Authorization', `Bearer ${role}`)
        .attach('file', Buffer.from('file bytes'), {
          filename: 'photo.png',
          contentType: 'image/png',
        })
        .expect(201)
        .expect({ avatarUpdatedAt: UPDATED_AT });
      expect(service.upload).toHaveBeenCalledWith(
        expect.objectContaining({ id: OWNER_ID, role: role.toUpperCase() }),
        expect.objectContaining({ mimetype: 'image/png', buffer: Buffer.from('file bytes') }),
      );
    },
  );

  it('accepts exactly 2 MiB but rejects excess bytes at the multipart boundary', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/profiles/me/avatar')
      .set('Authorization', 'Bearer student')
      .attach('file', Buffer.alloc(2097152), 'photo.png')
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/profiles/me/avatar')
      .set('Authorization', 'Bearer student')
      .attach('file', Buffer.alloc(2097154), 'photo.png')
      .expect(413);
    expect(service.upload).toHaveBeenCalledTimes(1);
  });

  it('rejects extra form fields, untrusted owner IDs, and multiple files before service invocation', async () => {
    for (const field of ['userId', 'extra']) {
      await request(app.getHttpServer())
        .post('/api/v1/profiles/me/avatar')
        .set('Authorization', 'Bearer student')
        .field(field, OWNER_ID)
        .attach('file', Buffer.from('file'), 'photo.png')
        .expect(400);
    }
    await request(app.getHttpServer())
      .post('/api/v1/profiles/me/avatar')
      .set('Authorization', 'Bearer student')
      .attach('file', Buffer.from('file'), 'one.png')
      .attach('file', Buffer.from('file'), 'two.png')
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/profiles/me/avatar')
      .set('Authorization', 'Bearer student')
      .attach('other', Buffer.from('file'), 'photo.png')
      .expect(400);
    expect(service.upload).not.toHaveBeenCalled();
  });

  it.each(['get', 'post', 'delete'] as const)(
    'authenticates before authorizing %s operations',
    async (method) => {
      await request(app.getHttpServer())[method]('/api/v1/profiles/me/avatar').expect(401);
      await request(app.getHttpServer())
        [method]('/api/v1/profiles/me/avatar')
        .set('Authorization', 'Bearer forged')
        .expect(401);
      await request(app.getHttpServer())
        [method]('/api/v1/profiles/me/avatar')
        .set('Authorization', 'Bearer admin')
        .expect(403);
      expect(service.getMine).not.toHaveBeenCalled();
      expect(service.upload).not.toHaveBeenCalled();
      expect(service.remove).not.toHaveBeenCalled();
    },
  );

  it('returns private, non-cacheable owner URLs and supports repeated removal', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/profiles/me/avatar')
      .set('Authorization', 'Bearer student')
      .expect(200)
      .expect({ avatar: null });
    expect(response.headers['cache-control']).toBe('private, no-store');
    for (let index = 0; index < 2; index += 1) {
      await request(app.getHttpServer())
        .delete('/api/v1/profiles/me/avatar')
        .set('Authorization', 'Bearer student')
        .expect(200)
        .expect({ avatarUpdatedAt: null });
    }
  });

  it('exposes only the public tutor read route and validates UUIDs', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/tutors/${OWNER_ID}/avatar`)
      .expect(200)
      .expect({ avatar: null });
    expect(service.getPublicTutor).toHaveBeenCalledWith(OWNER_ID);
    await request(app.getHttpServer()).get('/api/v1/tutors/invalid/avatar').expect(400);
    await request(app.getHttpServer()).get(`/api/v1/students/${OWNER_ID}/avatar`).expect(404);
  });

  it('documents multipart, size errors, JWT security, and anonymous public reads', () => {
    const document = SwaggerModule.createDocument(app, {
      openapi: '3.0.0',
      info: { title: 'test', version: '1' },
      paths: {},
    });
    const upload = document.paths['/api/v1/profiles/me/avatar']?.post;
    expect(upload?.security).toEqual([{ [JWT_BEARER_AUTH]: [] }]);
    expect(upload?.responses).toHaveProperty('413');
    expect(upload?.responses).toHaveProperty('429');
    expect(upload?.requestBody).toMatchObject({
      content: {
        'multipart/form-data': { schema: { required: ['file'], additionalProperties: false } },
      },
    });
    expect(document.paths['/api/v1/tutors/{tutorId}/avatar']?.get?.security).toBeUndefined();
    expect(document.components?.schemas?.['AvatarDto']).toMatchObject({
      properties: { url: { type: 'string' }, expiresAt: { format: 'date-time' } },
    });
  });
});
