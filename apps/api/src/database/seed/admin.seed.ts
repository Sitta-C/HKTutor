import { AccountStatus, Role } from '@/generated/prisma/client';

import type { SeedTransactionClient } from '@/database/seed/seed-client';

export async function seedAdministrator(
  client: SeedTransactionClient,
  clerkUserId: string,
  primaryEmail: string,
): Promise<void> {
  const admin = await client.user.upsert({
    where: { clerkUserId },
    update: { primaryEmail },
    create: {
      clerkUserId,
      primaryEmail,
      role: Role.ADMIN,
      accountStatus: AccountStatus.ACTIVE,
    },
    select: { role: true },
  });

  if (admin.role !== Role.ADMIN) {
    throw new Error('Admin seed Clerk user ID belongs to a non-admin account');
  }
}
