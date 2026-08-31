import { AccountStatus, Role, TutorVerificationStatus } from '@/generated/prisma/client';

import type { SeedTransactionClient } from '@/database/seed/seed-client';

const SEEDED_TUTOR_PROFILE = {
  displayName: 'Anan',
  bio: 'Verified tutor seeded for Sprint 1 demonstrations.',
  experienceYears: 5,
  verificationStatus: TutorVerificationStatus.VERIFIED,
} as const;

export async function seedTutorFoundation(
  client: SeedTransactionClient,
  email: string,
  passwordHash: string,
): Promise<void> {
  await client.subject.upsert({
    where: { code: 'mathematics' },
    update: { name: 'Mathematics', active: true },
    create: { code: 'mathematics', name: 'Mathematics', active: true },
  });
  await client.gradeLevel.upsert({
    where: { code: 'grade-10' },
    update: { name: 'Grade 10', sortOrder: 10, active: true },
    create: { code: 'grade-10', name: 'Grade 10', sortOrder: 10, active: true },
  });

  const tutor = await client.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      passwordHash,
      role: Role.TUTOR,
      accountStatus: AccountStatus.ACTIVE,
    },
    select: { id: true, role: true },
  });

  if (tutor.role !== Role.TUTOR) {
    throw new Error('Tutor seed email belongs to a non-tutor account');
  }

  await client.tutorProfile.upsert({
    where: { userId: tutor.id },
    update: { verificationStatus: TutorVerificationStatus.VERIFIED },
    create: {
      userId: tutor.id,
      ...SEEDED_TUTOR_PROFILE,
      ratingAverage: null,
      reviewCount: 0,
      ratingUpdatedAt: null,
    },
  });
}
