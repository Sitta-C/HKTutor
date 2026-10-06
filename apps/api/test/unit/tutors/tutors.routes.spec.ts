import { Test } from '@nestjs/testing';
import request from 'supertest';

import { configureApplication } from '@app/app.setup';
import { Role } from '@generated/prisma/client';
import { JwtAuthGuard } from '@modules/auth/auth.guard';
import { ResourceOwnershipGuard } from '@modules/auth/ownership.guard';
import { RolesGuard } from '@modules/auth/roles.guard';
import { TutorAvailabilityService } from '@modules/tutors/tutor-availability.service';
import { TutorDirectoryService } from '@modules/tutors/tutor-directory.service';
import { TutorListingsService } from '@modules/tutors/tutor-listings.service';
import { TutorsPrivateController } from '@modules/tutors/tutors-private.controller';
import { TutorsPublicController } from '@modules/tutors/tutors-public.controller';

import type { AuthenticatedRequest, AuthenticatedUser } from '@modules/auth/auth.guard';
import type { ExecutionContext, INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import type { App } from 'supertest/types';

const TUTOR_ID = '20000000-0000-4000-8000-000000000001';

describe('tutor availability routes', () => {
  let app: INestApplication<App>;
  let currentUser: AuthenticatedUser;
  const getAvailabilityPrivate = jest.fn();
  const getAvailabilityPublic = jest.fn();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [TutorsPrivateController, TutorsPublicController],
      providers: [
        RolesGuard,
        {
          provide: TutorAvailabilityService,
          useValue: {
            getAvailabilityPrivate,
            getAvailabilityPublic,
          },
        },
        { provide: TutorDirectoryService, useValue: {} },
        { provide: TutorListingsService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
          request.auth = currentUser;
          return true;
        },
      })
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
    currentUser = {
      email: 'tutor@example.com',
      id: TUTOR_ID,
      role: Role.TUTOR,
      sessionId: 'session-id',
    };
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

  it('validates private overlap mode and passes UTC bounds with the authenticated tutor', async () => {
    getAvailabilityPrivate.mockResolvedValue([]);
    await request(app.getHttpServer())
      .get('/api/v1/tutors/me/availability')
      .query({
        from: '2026-10-04T17:00:00.000Z',
        to: '2026-10-11T17:00:00.000Z',
        rangeMode: 'overlap',
      })
      .expect(200);
    expect(getAvailabilityPrivate).toHaveBeenCalledWith(TUTOR_ID, {
      from: new Date('2026-10-04T17:00:00.000Z'),
      to: new Date('2026-10-11T17:00:00.000Z'),
      rangeMode: 'overlap',
    });
  });

  it('rejects unknown range modes before calling private availability', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/tutors/me/availability?rangeMode=unknown')
      .expect(400);
    expect(getAvailabilityPrivate).not.toHaveBeenCalled();
  });

  it('keeps the private overlap option out of the public route contract', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/tutors/${TUTOR_ID}/availability?rangeMode=overlap`)
      .expect(400);
    expect(getAvailabilityPublic).not.toHaveBeenCalled();
  });

  it('rejects an admin from tutor-private routes before calling the service', async () => {
    currentUser = { ...currentUser, email: 'admin@example.com', role: Role.ADMIN };

    await request(app.getHttpServer()).get('/api/v1/tutors/me/availability').expect(403);

    expect(getAvailabilityPrivate).not.toHaveBeenCalled();
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
