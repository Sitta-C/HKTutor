import { AccountStatus, Role } from '@/generated/prisma/client';

import type { SeedTransactionClient } from '@/database/seed/seed-client';

const VERIFIED_AT = new Date('2026-09-01T00:00:00.000Z');

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

  if (existing) {
    const updated = await client.user.update({
      where: { id: existing.id },
      data: { passwordHash, emailVerifiedAt: VERIFIED_AT, accountStatus: AccountStatus.ACTIVE },
      select: { id: true },
    });
    return { studentUserId: updated.id };
  }

  const created = await client.user.create({
    data: {
      email,
      passwordHash,
      emailVerifiedAt: VERIFIED_AT,
      role: Role.STUDENT,
      accountStatus: AccountStatus.ACTIVE,
    },
    select: { id: true },
  });
  return { studentUserId: created.id };
}
