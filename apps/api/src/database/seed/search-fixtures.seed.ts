import {
  AccountStatus,
  ListingPublicationStatus,
  Role,
  TutorVerificationStatus,
} from '@/generated/prisma/client';

import type { SeedTransactionClient } from '@/database/seed/seed-client';
import type { TutorFoundationSeedResult } from '@/database/seed/tutor-foundation.seed';

const SEEDED_AT = new Date('2026-09-01T00:00:00.000Z');

const SYNTHETIC_TUTORS = [
  {
    key: 'mali',
    userId: '20000000-0000-4000-8000-000000000001',
    email: 'mali@s1t20.hktutor.invalid',
    displayName: 'Mali',
    bio: 'Mathematics tutor fixture for lowest-price search cases.',
    experienceYears: 4,
    ratingAverage: '4.40',
    reviewCount: 18,
  },
  {
    key: 'kiet',
    userId: '20000000-0000-4000-8000-000000000002',
    email: 'kiet@s1t20.hktutor.invalid',
    displayName: 'Kiet',
    bio: 'Mathematics tutor fixture for inclusive budget boundary cases.',
    experienceYears: 3,
    ratingAverage: '4.00',
    reviewCount: 10,
  },
  {
    key: 'niran',
    userId: '20000000-0000-4000-8000-000000000003',
    email: 'niran@s1t20.hktutor.invalid',
    displayName: 'Niran',
    bio: 'Physics tutor fixture for subject mismatch search cases.',
    experienceYears: 6,
    ratingAverage: '4.70',
    reviewCount: 12,
  },
  {
    key: 'pim',
    userId: '20000000-0000-4000-8000-000000000004',
    email: 'pim@s1t20.hktutor.invalid',
    displayName: 'Pim',
    bio: 'Grade 11 mathematics tutor fixture for grade mismatch cases.',
    experienceYears: 5,
    ratingAverage: '4.60',
    reviewCount: 15,
  },
] as const;

interface ListingFixture {
  id: string;
  tutorProfileId: string;
  subjectId: string;
  gradeLevelId: string;
  pricePerHour: string;
  description: string;
  publicationStatus: ListingPublicationStatus;
  publishedAt: Date | null;
}

function listingFixture(
  fixture: Omit<ListingFixture, 'publishedAt'> & { publishedAt?: Date | null },
): ListingFixture {
  return {
    ...fixture,
    publishedAt:
      fixture.publishedAt ??
      (fixture.publicationStatus === ListingPublicationStatus.PUBLISHED ? SEEDED_AT : null),
  };
}

export async function seedTutorSearchFixtures(
  client: SeedTransactionClient,
  foundation: TutorFoundationSeedResult,
): Promise<void> {
  const physics = await client.subject.upsert({
    where: { code: 'physics' },
    update: { name: 'Physics', active: true },
    create: { code: 'physics', name: 'Physics', active: true },
  });
  const grade11 = await client.gradeLevel.upsert({
    where: { code: 'grade-11' },
    update: { name: 'Grade 11', sortOrder: 11, active: true },
    create: { code: 'grade-11', name: 'Grade 11', sortOrder: 11, active: true },
  });

  await client.tutorProfile.update({
    where: { userId: foundation.tutorUserId },
    data: {
      verificationStatus: TutorVerificationStatus.VERIFIED,
      ratingAverage: '4.80',
      reviewCount: 24,
      ratingUpdatedAt: SEEDED_AT,
    },
  });

  const tutorIds = new Map<string, string>();

  for (const fixture of SYNTHETIC_TUTORS) {
    const tutor = await client.user.upsert({
      where: { id: fixture.userId },
      update: { email: fixture.email, emailVerifiedAt: SEEDED_AT },
      create: {
        id: fixture.userId,
        email: fixture.email,
        emailVerifiedAt: SEEDED_AT,
        role: Role.TUTOR,
        accountStatus: AccountStatus.ACTIVE,
      },
      select: { id: true, role: true },
    });

    if (tutor.role !== Role.TUTOR) {
      throw new Error('Search fixture user ID belongs to a non-tutor account');
    }

    if (tutor.id !== fixture.userId) {
      throw new Error('Search fixture user ID is not owned by the seed');
    }

    tutorIds.set(fixture.key, tutor.id);
    const profileData = {
      firstName: fixture.displayName,
      lastName: 'Fixture',
      nickname: fixture.displayName,
      displayName: fixture.displayName,
      bio: fixture.bio,
      experienceYears: fixture.experienceYears,
      verificationStatus: TutorVerificationStatus.VERIFIED,
      ratingAverage: fixture.ratingAverage,
      reviewCount: fixture.reviewCount,
      ratingUpdatedAt: SEEDED_AT,
    };

    await client.tutorProfile.upsert({
      where: { userId: tutor.id },
      update: profileData,
      create: {
        userId: tutor.id,
        ...profileData,
      },
    });
  }

  const requiredTutorId = (key: string): string => {
    const id = tutorIds.get(key);

    if (!id) {
      throw new Error(`Search fixture tutor ${key} was not created`);
    }

    return id;
  };

  const listings = [
    listingFixture({
      id: '10000000-0000-4000-8000-000000000001',
      tutorProfileId: foundation.tutorUserId,
      subjectId: foundation.mathematicsSubjectId,
      gradeLevelId: foundation.grade10Id,
      pricePerHour: '400.00',
      description: 'Published Mathematics Grade 10 listing for exact-match search cases.',
      publicationStatus: ListingPublicationStatus.PUBLISHED,
    }),
    listingFixture({
      id: '10000000-0000-4000-8000-000000000002',
      tutorProfileId: requiredTutorId('mali'),
      subjectId: foundation.mathematicsSubjectId,
      gradeLevelId: foundation.grade10Id,
      pricePerHour: '350.00',
      description: 'Published Mathematics Grade 10 listing for lowest-price cases.',
      publicationStatus: ListingPublicationStatus.PUBLISHED,
    }),
    listingFixture({
      id: '10000000-0000-4000-8000-000000000003',
      tutorProfileId: requiredTutorId('kiet'),
      subjectId: foundation.mathematicsSubjectId,
      gradeLevelId: foundation.grade10Id,
      pricePerHour: '500.00',
      description: 'Published Mathematics Grade 10 listing at the inclusive budget boundary.',
      publicationStatus: ListingPublicationStatus.PUBLISHED,
    }),
    listingFixture({
      id: '10000000-0000-4000-8000-000000000004',
      tutorProfileId: requiredTutorId('niran'),
      subjectId: physics.id,
      gradeLevelId: foundation.grade10Id,
      pricePerHour: '400.00',
      description: 'Published Physics Grade 10 listing for subject mismatch cases.',
      publicationStatus: ListingPublicationStatus.PUBLISHED,
    }),
    listingFixture({
      id: '10000000-0000-4000-8000-000000000005',
      tutorProfileId: requiredTutorId('pim'),
      subjectId: foundation.mathematicsSubjectId,
      gradeLevelId: grade11.id,
      pricePerHour: '450.00',
      description: 'Published Mathematics Grade 11 listing for grade mismatch cases.',
      publicationStatus: ListingPublicationStatus.PUBLISHED,
    }),
    listingFixture({
      id: '10000000-0000-4000-8000-000000000006',
      tutorProfileId: foundation.tutorUserId,
      subjectId: foundation.mathematicsSubjectId,
      gradeLevelId: foundation.grade10Id,
      pricePerHour: '300.00',
      description: 'Draft Mathematics Grade 10 listing that must stay out of public search.',
      publicationStatus: ListingPublicationStatus.DRAFT,
      publishedAt: null,
    }),
  ];

  for (const fixture of listings) {
    const { id, ...data } = fixture;

    await client.teachingListing.upsert({
      where: { id },
      update: {
        ...data,
        deletedAt: null,
      },
      create: {
        id,
        ...data,
      },
    });
  }
}
