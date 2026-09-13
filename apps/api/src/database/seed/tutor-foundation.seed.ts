import { AccountStatus, Role, TutorVerificationStatus } from '@/generated/prisma/client';

import type { SeedTransactionClient } from '@/database/seed/seed-client';

const SEEDED_TUTOR_PROFILE = {
  firstName: 'Anan',
  lastName: 'Sukjai',
  nickname: 'Anan',
  displayName: 'Anan',
  bio: 'Verified tutor seeded for Sprint 1 demonstrations.',
  experienceYears: 5,
  verificationStatus: TutorVerificationStatus.VERIFIED,
} as const;

const SEEDED_AT = new Date('2026-09-01T00:00:00.000Z');

export interface TutorFoundationSeedResult {
  tutorUserId: string;
  mathematicsSubjectId: string;
  grade10Id: string;
}

export async function seedTutorFoundation(
  client: SeedTransactionClient,
  email: string,
  passwordHash: string,
): Promise<TutorFoundationSeedResult> {
  const mathematics = await client.subject.upsert({
    where: { code: 'mathematics' },
    update: { name: 'Mathematics', active: true },
    create: { code: 'mathematics', name: 'Mathematics', active: true },
  });
  const grade10 = await client.gradeLevel.upsert({
    where: { code: 'grade-10' },
    update: { name: 'Grade 10', sortOrder: 10, active: true },
    create: { code: 'grade-10', name: 'Grade 10', sortOrder: 10, active: true },
  });

  const existingTutor = await client.user.findFirst({ where: { email, deletedAt: null } });
  if (existingTutor && existingTutor.role !== Role.TUTOR) {
    throw new Error('Tutor seed email belongs to a non-tutor account');
  }

  const tutor = existingTutor
    ? await client.user.update({
        where: { id: existingTutor.id },
        data: {
          passwordHash,
          emailVerifiedAt: SEEDED_AT,
          accountStatus: AccountStatus.ACTIVE,
        },
        select: { id: true, role: true },
      })
    : await client.user.create({
        data: {
          email,
          passwordHash,
          emailVerifiedAt: SEEDED_AT,
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
    update: SEEDED_TUTOR_PROFILE,
    create: {
      userId: tutor.id,
      ...SEEDED_TUTOR_PROFILE,
      ratingAverage: null,
      reviewCount: 0,
      ratingUpdatedAt: null,
    },
  });

  return {
    tutorUserId: tutor.id,
    mathematicsSubjectId: mathematics.id,
    grade10Id: grade10.id,
  };
}
