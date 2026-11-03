import { ListingPublicationStatus, Role } from '@generated/prisma/client';
import { seedTutorSearchFixtures } from '@infrastructure/database/seed/search-fixtures.seed';

import type { Prisma } from '@generated/prisma/client';
import type { SeedTransactionClient } from '@infrastructure/database/seed/seed-client';
import type { TutorFoundationSeedResult } from '@infrastructure/database/seed/tutor-foundation.seed';

const foundation: TutorFoundationSeedResult = {
  tutorUserId: 'anan-id',
  mathematicsSubjectId: 'mathematics-id',
  grade10Id: 'grade-10-id',
};

function createClient(firstRole: Role = Role.TUTOR) {
  const userUpsert = jest
    .fn<Promise<{ id: string; role: Role }>, [Prisma.UserUpsertArgs]>()
    .mockImplementation((args) =>
      Promise.resolve({
        id: String(args.where.id),
        role: args.where.id === '20000000-0000-4000-8000-000000000001' ? firstRole : Role.TUTOR,
      }),
    );
  const teachingListingUpsert = jest
    .fn<Promise<{ id: string }>, [Prisma.TeachingListingUpsertArgs]>()
    .mockResolvedValue({ id: 'listing-id' });
  const tutorProfileUpdateMany = jest.fn().mockResolvedValue({ count: 5 });
  const tutorProfileUpsert = jest
    .fn<Promise<{ userId: string }>, [Prisma.TutorProfileUpsertArgs]>()
    .mockResolvedValue({ userId: 'fixture-id' });

  return {
    client: {
      subject: { upsert: jest.fn().mockResolvedValue({ id: 'physics-id' }) },
      gradeLevel: { upsert: jest.fn().mockResolvedValue({ id: 'grade-11-id' }) },
      user: { upsert: userUpsert },
      tutorProfile: {
        update: jest.fn().mockResolvedValue({ userId: 'anan-id' }),
        upsert: tutorProfileUpsert,
        updateMany: tutorProfileUpdateMany,
      },
      teachingListing: { upsert: teachingListingUpsert },
    } as unknown as SeedTransactionClient,
    teachingListingUpsert,
    tutorProfileUpsert,
    tutorProfileUpdateMany,
    userUpsert,
  };
}

describe('seedTutorSearchFixtures', () => {
  it('creates deterministic non-loginable tutor and listing fixtures', async () => {
    const { client, teachingListingUpsert, userUpsert } = createClient();

    await seedTutorSearchFixtures(client, foundation);

    expect(userUpsert).toHaveBeenCalledTimes(4);
    expect(userUpsert.mock.calls.map(([args]) => args.where.id)).toEqual([
      '20000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000002',
      '20000000-0000-4000-8000-000000000003',
      '20000000-0000-4000-8000-000000000004',
    ]);
    expect(userUpsert.mock.calls.map(([args]) => args.create.passwordHash)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(teachingListingUpsert).toHaveBeenCalledTimes(6);
    expect(
      teachingListingUpsert.mock.calls.map(([args]) => ({
        id: args.where.id,
        status: args.create.publicationStatus,
      })),
    ).toEqual([
      { id: '10000000-0000-4000-8000-000000000001', status: ListingPublicationStatus.PUBLISHED },
      { id: '10000000-0000-4000-8000-000000000002', status: ListingPublicationStatus.PUBLISHED },
      { id: '10000000-0000-4000-8000-000000000003', status: ListingPublicationStatus.PUBLISHED },
      { id: '10000000-0000-4000-8000-000000000004', status: ListingPublicationStatus.PUBLISHED },
      { id: '10000000-0000-4000-8000-000000000005', status: ListingPublicationStatus.PUBLISHED },
      { id: '10000000-0000-4000-8000-000000000006', status: ListingPublicationStatus.DRAFT },
    ]);
  });

  it('clears synthetic ratings only for seeded tutors without reviews', async () => {
    const { client, tutorProfileUpsert, tutorProfileUpdateMany } = createClient();

    await seedTutorSearchFixtures(client, foundation);

    expect(tutorProfileUpdateMany).toHaveBeenCalledWith({
      where: {
        userId: {
          in: [
            foundation.tutorUserId,
            '20000000-0000-4000-8000-000000000001',
            '20000000-0000-4000-8000-000000000002',
            '20000000-0000-4000-8000-000000000003',
            '20000000-0000-4000-8000-000000000004',
          ],
        },
        reviews: { none: {} },
      },
      data: { ratingAverage: null, reviewCount: 0, ratingUpdatedAt: null },
    });
    for (const [args] of tutorProfileUpsert.mock.calls) {
      expect(args.update).not.toHaveProperty('ratingAverage');
      expect(args.update).not.toHaveProperty('reviewCount');
      expect(args.create).not.toHaveProperty('ratingAverage');
      expect(args.create).not.toHaveProperty('reviewCount');
    }
  });

  it('refuses a deterministic fixture id owned by a non-tutor', async () => {
    const { client, teachingListingUpsert, tutorProfileUpsert } = createClient(Role.STUDENT);

    await expect(seedTutorSearchFixtures(client, foundation)).rejects.toThrow(
      'Search fixture user ID belongs to a non-tutor account',
    );
    expect(tutorProfileUpsert).not.toHaveBeenCalled();
    expect(teachingListingUpsert).not.toHaveBeenCalled();
  });
});
