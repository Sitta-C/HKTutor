import { Test } from '@nestjs/testing';
import request from 'supertest';

import { configureApplication } from '@/app.setup';
import { JwtAuthGuard } from '@/auth/auth.guard';
import { JwtTokenService } from '@/auth/jwt.service';
import { ResourceOwnershipGuard } from '@/auth/ownership.guard';
import { RolesGuard } from '@/auth/roles.guard';
import { PrismaService } from '@/database/prisma.service';
import { AuthExampleController } from '@/examples/auth-example.controller';
import { AccountStatus, Role } from '@/generated/prisma/client';

import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';

const RESOURCE_ID = '10000000-0000-4000-8000-000000000001';
const MISSING_RESOURCE_ID = '10000000-0000-4000-8000-000000000099';
const USER_ID = '20000000-0000-4000-8000-000000000001';

describe('Authentication and authorization guards (e2e)', () => {
  let app: INestApplication<App>;
  const verifyAccessToken = jest.fn();
  const authSessionFindUnique = jest.fn();
  const teachingListingFindFirst = jest.fn();

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      controllers: [AuthExampleController],
      providers: [
        JwtAuthGuard,
        ResourceOwnershipGuard,
        RolesGuard,
        { provide: JwtTokenService, useValue: { verifyAccessToken } },
        {
          provide: PrismaService,
          useValue: {
            authSession: { findUnique: authSessionFindUnique },
            teachingListing: { findFirst: teachingListingFindFirst },
          },
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => jest.resetAllMocks());

  it('returns 401 for a missing access token', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/examples/private-listings/${RESOURCE_ID}`)
      .expect(401);
    expect(authSessionFindUnique).not.toHaveBeenCalled();
    expect(teachingListingFindFirst).not.toHaveBeenCalled();
  });

  it('returns 401 for an invalid access token', async () => {
    verifyAccessToken.mockReturnValue(null);

    await authorizedRequest(RESOURCE_ID).expect(401);
    expect(authSessionFindUnique).not.toHaveBeenCalled();
    expect(teachingListingFindFirst).not.toHaveBeenCalled();
  });

  it('returns 403 for an authenticated user with the wrong role', async () => {
    authenticateAs(Role.STUDENT);

    await authorizedRequest(RESOURCE_ID).expect(403);
    expect(teachingListingFindFirst).not.toHaveBeenCalled();
  });

  it("returns the same 404 for another tutor's private record and a missing record", async () => {
    authenticateAs(Role.TUTOR);
    teachingListingFindFirst.mockResolvedValue(null);

    const inaccessible = await authorizedRequest(RESOURCE_ID).expect(404);
    const missing = await authorizedRequest(MISSING_RESOURCE_ID).expect(404);

    expect(inaccessible.body).toEqual(missing.body);
    expect(inaccessible.body).toMatchObject({
      error: 'Not Found',
      message: 'Resource not found',
      statusCode: 404,
    });
    expect(teachingListingFindFirst).toHaveBeenNthCalledWith(1, {
      where: { id: RESOURCE_ID, deletedAt: null, tutorProfileId: USER_ID },
      select: { id: true },
    });
  });

  it('allows the tutor who owns the private record', async () => {
    authenticateAs(Role.TUTOR);
    teachingListingFindFirst.mockResolvedValue({ id: RESOURCE_ID });

    await authorizedRequest(RESOURCE_ID).expect(200, {
      listingId: RESOURCE_ID,
      message: 'Private listing access accepted',
      requesterId: USER_ID,
      role: Role.TUTOR,
    });
  });

  function authenticateAs(role: Role): void {
    verifyAccessToken.mockReturnValue({ sub: USER_ID, sid: 'session-id' });
    authSessionFindUnique.mockResolvedValue({
      id: 'session-id',
      userId: USER_ID,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      user: {
        id: USER_ID,
        email: 'user@example.com',
        role,
        accountStatus: AccountStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        deletedAt: null,
      },
    });
  }

  function authorizedRequest(resourceId: string): request.Test {
    return request(app.getHttpServer())
      .get(`/api/v1/examples/private-listings/${resourceId}`)
      .set('Authorization', 'Bearer signed-token');
  }
});
