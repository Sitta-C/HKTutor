import { Test } from '@nestjs/testing';
import request from 'supertest';

import { configureApplication } from '@/app.setup';
import { JwtAuthGuard } from '@/auth/auth.guard';
import { ResourceOwnershipGuard } from '@/auth/ownership.guard';
import { RolesGuard } from '@/auth/roles.guard';
import { Role } from '@/generated/prisma/client';
import { TutorsPrivateController } from '@/tutors/tutors-private.controller';
import { TutorsPublicController } from '@/tutors/tutors-public.controller';
import { TutorsService } from '@/tutors/tutors.service';

import type { AuthenticatedRequest } from '@/auth/auth.guard';
import type { ExecutionContext, INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import type { App } from 'supertest/types';

const TUTOR_ID = '20000000-0000-4000-8000-000000000001';

describe('tutor availability routes', () => {
  let app: INestApplication<App>;
  const getAvailabilityPrivate = jest.fn();
  const getAvailabilityPublic = jest.fn();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [TutorsPrivateController, TutorsPublicController],
      providers: [
        {
          provide: TutorsService,
          useValue: {
            getAvailabilityPrivate,
            getAvailabilityPublic,
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
          request.auth = {
            email: 'tutor@example.com',
            id: TUTOR_ID,
            role: Role.TUTOR,
            sessionId: 'session-id',
          };
          return true;
        },
      })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ResourceOwnershipGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleFixture.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('routes the literal me segment to private availability', async () => {
    getAvailabilityPrivate.mockResolvedValue([{ id: 'private-slot' }]);

    await request(app.getHttpServer())
      .get('/api/v1/tutors/me/availability')
      .expect(200)
      .expect([{ id: 'private-slot' }]);

    expect(getAvailabilityPrivate).toHaveBeenCalledWith(TUTOR_ID, {});
    expect(getAvailabilityPublic).not.toHaveBeenCalled();
  });

  it('routes a UUID tutor ID to public availability without using private identity', async () => {
    getAvailabilityPublic.mockResolvedValue([{ id: 'public-slot' }]);

    await request(app.getHttpServer())
      .get(`/api/v1/tutors/${TUTOR_ID}/availability`)
      .expect(200)
      .expect([{ id: 'public-slot' }]);

    expect(getAvailabilityPublic).toHaveBeenCalledWith(TUTOR_ID, {});
    expect(getAvailabilityPrivate).not.toHaveBeenCalled();
  });

  it('rejects a malformed public tutor ID before calling the service', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/tutors/not-a-uuid/availability')
      .expect(400);

    expect(response.body).toMatchObject({
      code: 'INVALID_UUID',
      message: 'tutorId must be a valid UUID',
      statusCode: 400,
    });
    expect(getAvailabilityPublic).not.toHaveBeenCalled();
  });
});
