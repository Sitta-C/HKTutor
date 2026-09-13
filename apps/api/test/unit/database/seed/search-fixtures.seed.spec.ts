import { seedTutorSearchFixtures } from '@/database/seed/search-fixtures.seed';
import { ListingPublicationStatus, Role } from '@/generated/prisma/client';

import type { SeedTransactionClient } from '@/database/seed/seed-client';
import type { TutorFoundationSeedResult } from '@/database/seed/tutor-foundation.seed';
import type { Prisma } from '@/generated/prisma/client';

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
  const tutorProfileUpsert = jest.fn().mockResolvedValue({ userId: 'fixture-id' });

  return {
    client: {
      subject: { upsert: jest.fn().mockResolvedValue({ id: 'physics-id' }) },
      gradeLevel: { upsert: jest.fn().mockResolvedValue({ id: 'grade-11-id' }) },
      user: { upsert: userUpsert },
      tutorProfile: {
        update: jest.fn().mockResolvedValue({ userId: 'anan-id' }),
        upsert: tutorProfileUpsert,
      },
      teachingListing: { upsert: teachingListingUpsert },
    } as unknown as SeedTransactionClient,
    teachingListingUpsert,
    tutorProfileUpsert,
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

  it('refuses a deterministic fixture id owned by a non-tutor', async () => {
    const { client, teachingListingUpsert, tutorProfileUpsert } = createClient(Role.STUDENT);

    await expect(seedTutorSearchFixtures(client, foundation)).rejects.toThrow(
      'Search fixture user ID belongs to a non-tutor account',
    );
    expect(tutorProfileUpsert).not.toHaveBeenCalled();
    expect(teachingListingUpsert).not.toHaveBeenCalled();
  });
});
