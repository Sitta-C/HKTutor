import { ListingPublicationStatus, Role, TutorVerificationStatus } from '@/generated/prisma/client';

import type { SeedTransactionClient } from '@/database/seed/seed-client';
import type { TutorFoundationSeedResult } from '@/database/seed/tutor-foundation.seed';
import type { Prisma } from '@/generated/prisma/client';

interface SearchFixturesModule {
  seedTutorSearchFixtures: (
    client: SeedTransactionClient,
    foundation: TutorFoundationSeedResult,
    fixturePasswordHash: string,
  ) => Promise<void>;
}

const foundation: TutorFoundationSeedResult = {
  tutorUserId: 'anan-id',
  mathematicsSubjectId: 'mathematics-id',
  grade10Id: 'grade-10-id',
};

function loadSearchFixturesModule(): SearchFixturesModule {
  return jest.requireActual<SearchFixturesModule>('@/database/seed/search-fixtures.seed');
}

function createClient(
  role: Role = Role.TUTOR,
  maliUserId = '20000000-0000-4000-8000-000000000001',
) {
  const subjectUpsert = jest
    .fn<Promise<{ id: string }>, [Prisma.SubjectUpsertArgs]>()
    .mockResolvedValue({ id: 'physics-id' });
  const gradeLevelUpsert = jest
    .fn<Promise<{ id: string }>, [Prisma.GradeLevelUpsertArgs]>()
    .mockResolvedValue({ id: 'grade-11-id' });
  const userIdsByEmail: Record<string, string> = {
    'mali@s1t20.hktutor.invalid': maliUserId,
    'kiet@s1t20.hktutor.invalid': '20000000-0000-4000-8000-000000000002',
    'niran@s1t20.hktutor.invalid': '20000000-0000-4000-8000-000000000003',
    'pim@s1t20.hktutor.invalid': '20000000-0000-4000-8000-000000000004',
  };
  const userUpsert = jest
    .fn<Promise<{ id: string; role: Role }>, [Prisma.UserUpsertArgs]>()
    .mockImplementation((args) => {
      const email = String(args.where.email);

      return Promise.resolve({
        id: userIdsByEmail[email] ?? 'unexpected-user-id',
        role: email === 'mali@s1t20.hktutor.invalid' ? role : Role.TUTOR,
      });
    });
  const tutorProfileUpdate = jest
    .fn<Promise<{ userId: string }>, [Prisma.TutorProfileUpdateArgs]>()
    .mockResolvedValue({ userId: 'anan-id' });
  const tutorProfileUpsert = jest
    .fn<Promise<{ userId: string }>, [Prisma.TutorProfileUpsertArgs]>()
    .mockResolvedValue({ userId: 'fixture-id' });
  const teachingListingUpsert = jest
    .fn<Promise<{ id: string }>, [Prisma.TeachingListingUpsertArgs]>()
    .mockResolvedValue({ id: 'listing-id' });

  return {
    client: {
      subject: { upsert: subjectUpsert },
      gradeLevel: { upsert: gradeLevelUpsert },
      user: { upsert: userUpsert },
      tutorProfile: { update: tutorProfileUpdate, upsert: tutorProfileUpsert },
      teachingListing: { upsert: teachingListingUpsert },
    } as unknown as SeedTransactionClient,
    gradeLevelUpsert,
    subjectUpsert,
    teachingListingUpsert,
    tutorProfileUpdate,
    tutorProfileUpsert,
    userUpsert,
  };
}

describe('seedTutorSearchFixtures', () => {
  it('seeds the exact-match, boundary, subject-mismatch, and grade-mismatch matrix', async () => {
    const {
      client,
      gradeLevelUpsert,
      subjectUpsert,
      teachingListingUpsert,
      tutorProfileUpdate,
      tutorProfileUpsert,
      userUpsert,
    } = createClient();
    const { seedTutorSearchFixtures } = loadSearchFixturesModule();

    await seedTutorSearchFixtures(client, foundation, '$argon2id$fixture-hash');

    expect(subjectUpsert).toHaveBeenCalledWith({
      where: { code: 'physics' },
      update: { name: 'Physics', active: true },
      create: { code: 'physics', name: 'Physics', active: true },
    });
    expect(gradeLevelUpsert).toHaveBeenCalledWith({
      where: { code: 'grade-11' },
      update: { name: 'Grade 11', sortOrder: 11, active: true },
      create: { code: 'grade-11', name: 'Grade 11', sortOrder: 11, active: true },
    });
    expect(userUpsert.mock.calls.map(([args]) => args.where.email)).toEqual([
      'mali@s1t20.hktutor.invalid',
      'kiet@s1t20.hktutor.invalid',
      'niran@s1t20.hktutor.invalid',
      'pim@s1t20.hktutor.invalid',
    ]);
    expect(userUpsert.mock.calls.map(([args]) => args.create.id)).toEqual([
      '20000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000002',
      '20000000-0000-4000-8000-000000000003',
      '20000000-0000-4000-8000-000000000004',
    ]);
    expect(userUpsert.mock.calls.every(([args]) => Object.keys(args.update).length === 0)).toBe(
      true,
    );
    expect(tutorProfileUpdate).toHaveBeenCalledWith({
      where: { userId: 'anan-id' },
      data: {
        verificationStatus: TutorVerificationStatus.VERIFIED,
        ratingAverage: '4.80',
        reviewCount: 24,
        ratingUpdatedAt: new Date('2026-09-01T00:00:00.000Z'),
      },
    });
    expect(
      tutorProfileUpsert.mock.calls.map(([args]) => ({
        userId: args.where.userId,
        ratingAverage: args.create.ratingAverage,
        reviewCount: args.create.reviewCount,
      })),
    ).toEqual([
      {
        userId: '20000000-0000-4000-8000-000000000001',
        ratingAverage: '4.40',
        reviewCount: 18,
      },
      {
        userId: '20000000-0000-4000-8000-000000000002',
        ratingAverage: '4.00',
        reviewCount: 10,
      },
      {
        userId: '20000000-0000-4000-8000-000000000003',
        ratingAverage: '4.70',
        reviewCount: 12,
      },
      {
        userId: '20000000-0000-4000-8000-000000000004',
        ratingAverage: '4.60',
        reviewCount: 15,
      },
    ]);

    expect(
      teachingListingUpsert.mock.calls.map(([args]) => ({
        id: args.where.id,
        tutorProfileId: args.create.tutorProfileId,
        subjectId: args.create.subjectId,
        gradeLevelId: args.create.gradeLevelId,
        pricePerHour: args.create.pricePerHour,
        publicationStatus: args.create.publicationStatus,
        publishedAt: args.create.publishedAt,
      })),
    ).toEqual([
      {
        id: '10000000-0000-4000-8000-000000000001',
        tutorProfileId: 'anan-id',
        subjectId: 'mathematics-id',
        gradeLevelId: 'grade-10-id',
        pricePerHour: '400.00',
        publicationStatus: ListingPublicationStatus.PUBLISHED,
        publishedAt: new Date('2026-09-01T00:00:00.000Z'),
      },
      {
        id: '10000000-0000-4000-8000-000000000002',
        tutorProfileId: '20000000-0000-4000-8000-000000000001',
        subjectId: 'mathematics-id',
        gradeLevelId: 'grade-10-id',
        pricePerHour: '350.00',
        publicationStatus: ListingPublicationStatus.PUBLISHED,
        publishedAt: new Date('2026-09-01T00:00:00.000Z'),
      },
      {
        id: '10000000-0000-4000-8000-000000000003',
        tutorProfileId: '20000000-0000-4000-8000-000000000002',
        subjectId: 'mathematics-id',
        gradeLevelId: 'grade-10-id',
        pricePerHour: '500.00',
        publicationStatus: ListingPublicationStatus.PUBLISHED,
        publishedAt: new Date('2026-09-01T00:00:00.000Z'),
      },
      {
        id: '10000000-0000-4000-8000-000000000004',
        tutorProfileId: '20000000-0000-4000-8000-000000000003',
        subjectId: 'physics-id',
        gradeLevelId: 'grade-10-id',
        pricePerHour: '400.00',
        publicationStatus: ListingPublicationStatus.PUBLISHED,
        publishedAt: new Date('2026-09-01T00:00:00.000Z'),
      },
      {
        id: '10000000-0000-4000-8000-000000000005',
        tutorProfileId: '20000000-0000-4000-8000-000000000004',
        subjectId: 'mathematics-id',
        gradeLevelId: 'grade-11-id',
        pricePerHour: '450.00',
        publicationStatus: ListingPublicationStatus.PUBLISHED,
        publishedAt: new Date('2026-09-01T00:00:00.000Z'),
      },
      {
        id: '10000000-0000-4000-8000-000000000006',
        tutorProfileId: 'anan-id',
        subjectId: 'mathematics-id',
        gradeLevelId: 'grade-10-id',
        pricePerHour: '300.00',
        publicationStatus: ListingPublicationStatus.DRAFT,
        publishedAt: null,
      },
    ]);
  });

  it('refuses a reserved fixture email that belongs to a non-tutor account', async () => {
    const { client, teachingListingUpsert, tutorProfileUpsert } = createClient(Role.STUDENT);
    const { seedTutorSearchFixtures } = loadSearchFixturesModule();

    await expect(
      seedTutorSearchFixtures(client, foundation, '$argon2id$fixture-hash'),
    ).rejects.toThrow('Search fixture email belongs to a non-tutor account');
    expect(tutorProfileUpsert).not.toHaveBeenCalled();
    expect(teachingListingUpsert).not.toHaveBeenCalled();
  });

  it('refuses a reserved fixture email claimed by an unrelated tutor account', async () => {
    const { client, teachingListingUpsert, tutorProfileUpsert } = createClient(
      Role.TUTOR,
      'claimed-tutor-id',
    );
    const { seedTutorSearchFixtures } = loadSearchFixturesModule();

    await expect(
      seedTutorSearchFixtures(client, foundation, '$argon2id$fixture-hash'),
    ).rejects.toThrow('Search fixture email is not owned by the seed');
    expect(tutorProfileUpsert).not.toHaveBeenCalled();
    expect(teachingListingUpsert).not.toHaveBeenCalled();
  });

  it('uses stable listing ids so repeat runs update the same fixture rows', async () => {
    const { client, teachingListingUpsert } = createClient();
    const { seedTutorSearchFixtures } = loadSearchFixturesModule();

    await seedTutorSearchFixtures(client, foundation, '$argon2id$fixture-hash');
    const firstRunIds = teachingListingUpsert.mock.calls.map(([args]) => args.where.id);

    teachingListingUpsert.mockClear();
    await seedTutorSearchFixtures(client, foundation, '$argon2id$fixture-hash');
    const secondRunIds = teachingListingUpsert.mock.calls.map(([args]) => args.where.id);

    expect(secondRunIds).toEqual(firstRunIds);
    expect(new Set(secondRunIds).size).toBe(6);
  });
});
