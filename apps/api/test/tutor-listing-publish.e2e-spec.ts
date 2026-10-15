import { Test } from '@nestjs/testing';
import request from 'supertest';

import { configureApplication } from '@app/app.setup';
import { AccountStatus, ListingPublicationStatus, Prisma, Role } from '@generated/prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { JwtAuthGuard } from '@modules/auth/auth.guard';
import { JwtTokenService } from '@modules/auth/jwt.service';
import { ResourceOwnershipGuard } from '@modules/auth/ownership.guard';
import { RolesGuard } from '@modules/auth/roles.guard';
import { TutorAvailabilityService } from '@modules/tutors/tutor-availability.service';
import { TutorListingsService } from '@modules/tutors/tutor-listings.service';
import { TutorsPrivateController } from '@modules/tutors/tutors-private.controller';

import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';

/**
 * S2-T12: the publish-permission gate is already covered against a mocked PrismaService in
 * `tutors.service.spec.ts`. These cases instead drive the real Nest pipeline (JwtAuthGuard,
 * RolesGuard, ResourceOwnershipGuard, the global validation pipe and the exception filter) so the
 * blocked-publish contract is proven end to end, the way `bookings-mock-payment.e2e-spec.ts` proves
 * the mock-payment contract. `db:verify:tutor-verification` proves the same gate and the discovery
 * exclusion it depends on against real PostgreSQL.
 */

const TUTOR_ID = '20000000-0000-4000-8000-000000000001';
const OTHER_TUTOR_ID = '20000000-0000-4000-8000-000000000002';
const LISTING_ID = '10000000-0000-4000-8000-000000000001';
const SECOND_LISTING_ID = '10000000-0000-4000-8000-000000000002';

function matchingObject(value: Record<string, unknown>): unknown {
  return expect.objectContaining(value);
}

describe('Tutor listing publish permission (e2e)', () => {
  let app: INestApplication<App>;
  const verifyAccessToken = jest.fn();
  const authSessionFindUnique = jest.fn();
  const teachingListingFindFirst = jest.fn();
  const teachingListingUpdate = jest.fn();
  const tutorProfileFindFirst = jest.fn();

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      controllers: [TutorsPrivateController],
      providers: [
        TutorListingsService,
        TutorAvailabilityService,
        JwtAuthGuard,
        ResourceOwnershipGuard,
        RolesGuard,
        { provide: JwtTokenService, useValue: { verifyAccessToken } },
        {
          provide: PrismaService,
          useValue: {
            authSession: { findUnique: authSessionFindUnique },
            teachingListing: { findFirst: teachingListingFindFirst, update: teachingListingUpdate },
            tutorProfile: { findFirst: tutorProfileFindFirst },
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

  it('returns 401 without an access token', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/tutors/me/listings/${LISTING_ID}/publish`)
      .expect(401);

    expect(response.body).toMatchObject({ code: 'UNAUTHENTICATED', statusCode: 401 });
    expect(teachingListingFindFirst).not.toHaveBeenCalled();
  });

  it('returns 403 for a student attempting to publish', async () => {
    authenticateAs(Role.STUDENT);

    const response = await publishRequest().expect(403);

    expect(response.body).toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
    expect(teachingListingFindFirst).not.toHaveBeenCalled();
  });

  it('returns 400 INVALID_UUID for a malformed listing ID', async () => {
    authenticateAs(Role.TUTOR);

    const response = await request(app.getHttpServer())
      .post('/api/v1/tutors/me/listings/not-a-uuid/publish')
      .set('Authorization', 'Bearer signed-token')
      .expect(400);

    expect(response.body).toMatchObject({ code: 'INVALID_UUID', statusCode: 400 });
    expect(tutorProfileFindFirst).not.toHaveBeenCalled();
  });

  it("returns 404, not 403, for a missing or another tutor's listing", async () => {
    // ResourceOwnershipGuard's teachingListing case has no foreignOwner branch at all: its lookup
    // is pre-scoped by tutorProfileId (asserted below), so a foreign listing and a missing one
    // resolve the identical query to null and are genuinely indistinguishable from outside the
    // query -- there is no separate "foreign listing" fixture to construct, because no mock
    // return value could tell the two cases apart.
    authenticateAs(Role.TUTOR);
    teachingListingFindFirst.mockResolvedValue(null);

    const response = await publishRequest().expect(404);

    expect(response.body).toMatchObject({ code: 'NOT_FOUND', statusCode: 404 });
    expect(teachingListingFindFirst).toHaveBeenCalledWith(
      matchingObject({ where: matchingObject({ tutorProfileId: TUTOR_ID }) }),
    );
    expect(tutorProfileFindFirst).not.toHaveBeenCalled();
  });

  describe('an ineligible tutor (UNVERIFIED, PENDING and REJECTED)', () => {
    // publicTutorWhere's eligibility query filters only on verificationStatus=VERIFIED; the real
    // query takes no other status as an input, so a mocked PrismaService literally cannot
    // distinguish UNVERIFIED from PENDING from REJECTED -- every one of them makes this same
    // findFirst resolve null. Looping this block over the three names would run the identical
    // mock three times under three different titles, not exercise three different paths.
    // `db:verify:tutor-verification` sets each real enum value on a real row and is where the
    // per-status distinction is actually meaningful.
    beforeEach(() => {
      authenticateAs(Role.TUTOR);
      teachingListingFindFirst.mockResolvedValue({ id: LISTING_ID });
      tutorProfileFindFirst.mockResolvedValue(null);
    });

    it('is blocked from publishing via POST .../publish with 403', async () => {
      const response = await publishRequest().expect(403);

      expect(response.body).toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
      expect(teachingListingUpdate).not.toHaveBeenCalled();
    });

    it('is blocked from publishing via PATCH .../status with 403', async () => {
      const response = await statusRequest(ListingPublicationStatus.PUBLISHED).expect(403);

      expect(response.body).toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
      expect(teachingListingUpdate).not.toHaveBeenCalled();
    });

    it('can still archive the listing', async () => {
      // The gate blocks publishing specifically; it must not become a blanket block on every
      // status change for a tutor who has never been verified or who was rejected.
      teachingListingUpdate.mockResolvedValue(
        listingRow({ publicationStatus: ListingPublicationStatus.ARCHIVED }),
      );

      const response = await statusRequest(ListingPublicationStatus.ARCHIVED).expect(200);

      expect(response.body).toMatchObject({ publicationStatus: 'ARCHIVED' });
      expect(tutorProfileFindFirst).not.toHaveBeenCalled();
    });
  });

  it('publishes for a VERIFIED tutor via POST .../publish', async () => {
    authenticateAs(Role.TUTOR);
    teachingListingFindFirst.mockResolvedValue({ id: LISTING_ID });
    tutorProfileFindFirst.mockResolvedValue({ userId: TUTOR_ID });
    teachingListingUpdate.mockResolvedValue(
      listingRow({
        publicationStatus: ListingPublicationStatus.PUBLISHED,
        publishedAt: new Date(),
      }),
    );

    const response = await publishRequest().expect(200);

    expect(response.body).toMatchObject({ id: LISTING_ID, publicationStatus: 'PUBLISHED' });
    expect(response.body).toHaveProperty('publishedAt');
    expect((response.body as { publishedAt: string | null }).publishedAt).not.toBeNull();
  });

  it('publishes for a VERIFIED tutor via PATCH .../status', async () => {
    authenticateAs(Role.TUTOR);
    teachingListingFindFirst.mockResolvedValue({ id: LISTING_ID });
    tutorProfileFindFirst.mockResolvedValue({ userId: TUTOR_ID });
    teachingListingUpdate.mockResolvedValue(
      listingRow({
        publicationStatus: ListingPublicationStatus.PUBLISHED,
        publishedAt: new Date(),
      }),
    );

    const response = await statusRequest(ListingPublicationStatus.PUBLISHED).expect(200);

    expect(response.body).toMatchObject({ id: LISTING_ID, publicationStatus: 'PUBLISHED' });
  });

  it('re-checks eligibility on every request: the same tutor can publish, then is blocked after revocation', async () => {
    authenticateAs(Role.TUTOR);

    // Before: the tutor is VERIFIED and publishes a first listing successfully.
    teachingListingFindFirst.mockResolvedValue({ id: LISTING_ID });
    tutorProfileFindFirst.mockResolvedValue({ userId: TUTOR_ID });
    teachingListingUpdate.mockResolvedValue(
      listingRow({
        publicationStatus: ListingPublicationStatus.PUBLISHED,
        publishedAt: new Date(),
      }),
    );
    await publishRequest().expect(200);

    // After: nothing about the request changes except the tutor's current verification status,
    // which the gate re-reads from the database on this new request rather than trusting the
    // previous success. No admin "revoke" endpoint exists in this product; this reproduces the
    // only state that matters to the gate, however it came to change.
    teachingListingFindFirst.mockResolvedValue({ id: SECOND_LISTING_ID });
    tutorProfileFindFirst.mockResolvedValue(null);

    const response = await request(app.getHttpServer())
      .post(`/api/v1/tutors/me/listings/${SECOND_LISTING_ID}/publish`)
      .set('Authorization', 'Bearer signed-token')
      .expect(403);

    expect(response.body).toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
    expect(teachingListingUpdate).toHaveBeenCalledTimes(1);
  });

  function publishRequest(): request.Test {
    return request(app.getHttpServer())
      .post(`/api/v1/tutors/me/listings/${LISTING_ID}/publish`)
      .set('Authorization', 'Bearer signed-token');
  }

  function statusRequest(publicationStatus: ListingPublicationStatus): request.Test {
    return request(app.getHttpServer())
      .patch(`/api/v1/tutors/me/listings/${LISTING_ID}/status`)
      .set('Authorization', 'Bearer signed-token')
      .send({ publicationStatus });
  }

  function listingRow(overrides: {
    publicationStatus: ListingPublicationStatus;
    publishedAt?: Date | null;
  }) {
    return {
      id: LISTING_ID,
      subject: { id: 'subject-1', code: 'MATH', name: 'Mathematics', active: true },
      gradeLevel: { id: 'grade-1', code: 'G10', name: 'Grade 10', sortOrder: 10, active: true },
      pricePerHour: new Prisma.Decimal('500.00'),
      description: 'A synthetic listing used for the publish-permission e2e contract.',
      publicationStatus: overrides.publicationStatus,
      publishedAt: overrides.publishedAt ?? null,
      createdAt: new Date('2026-08-17T00:00:00.000Z'),
      updatedAt: new Date('2026-08-17T00:00:00.000Z'),
    };
  }

  function authenticateAs(role: Role): void {
    const userId = role === Role.TUTOR ? TUTOR_ID : OTHER_TUTOR_ID;
    verifyAccessToken.mockReturnValue({ sid: 'session-id', sub: userId });
    authSessionFindUnique.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
      id: 'session-id',
      revokedAt: null,
      user: {
        accountStatus: AccountStatus.ACTIVE,
        deletedAt: null,
        email: 'tutor@example.com',
        emailVerifiedAt: new Date(),
        id: userId,
        role,
      },
      userId,
    });
  }
});
