import { AccountStatus, Role } from '@/generated/prisma/client';

import type { SeedTransactionClient } from '@/database/seed/seed-client';

const VERIFIED_AT = new Date('2026-09-01T00:00:00.000Z');
const SEEDED_STUDENT_PROFILE = {
  firstName: 'Nanthida',
  lastName: 'Sukjai',
  nickname: 'Nan',
  school: 'HKTutor Demonstration School',
  gradeLevel: 'Grade 10',
  phone: '0800000000',
} as const;

export interface StudentSeedResult {
  studentUserId: string;
}

export async function seedStudent(
  client: SeedTransactionClient,
  email: string,
  passwordHash: string,
): Promise<StudentSeedResult> {
  const existing = await client.user.findFirst({ where: { email, deletedAt: null } });

  if (existing && existing.role !== Role.STUDENT) {
    throw new Error('Student seed email belongs to a non-student account');
  }

  const student = existing
    ? await client.user.update({
        where: { id: existing.id },
        data: { passwordHash, emailVerifiedAt: VERIFIED_AT, accountStatus: AccountStatus.ACTIVE },
        select: { id: true },
      })
    : await client.user.create({
        data: {
          email,
          passwordHash,
          emailVerifiedAt: VERIFIED_AT,
          role: Role.STUDENT,
          accountStatus: AccountStatus.ACTIVE,
        },
        select: { id: true },
      });

  await client.studentProfile.upsert({
    where: { userId: student.id },
    update: SEEDED_STUDENT_PROFILE,
    create: { userId: student.id, ...SEEDED_STUDENT_PROFILE },
  });

  return { studentUserId: student.id };
}
