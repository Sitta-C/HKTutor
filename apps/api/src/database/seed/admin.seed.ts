import { AccountStatus, Role } from '@/generated/prisma/client';

import type { SeedTransactionClient } from '@/database/seed/seed-client';

const VERIFIED_AT = new Date('2026-09-01T00:00:00.000Z');

export async function seedAdministrator(
  client: SeedTransactionClient,
  email: string,
  passwordHash: string,
): Promise<void> {
  const existing = await client.user.findFirst({ where: { email, deletedAt: null } });

  if (existing && existing.role !== Role.ADMIN) {
    throw new Error('Admin seed email belongs to a non-admin account');
  }

  if (existing) {
    await client.user.update({
      where: { id: existing.id },
      data: { passwordHash, emailVerifiedAt: VERIFIED_AT, accountStatus: AccountStatus.ACTIVE },
    });
    return;
  }

  await client.user.create({
    data: {
      email,
      passwordHash,
      emailVerifiedAt: VERIFIED_AT,
      role: Role.ADMIN,
      accountStatus: AccountStatus.ACTIVE,
    },
  });
}
