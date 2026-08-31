import type { SeedTransactionClient } from '@/database/seed/seed-client';
import { AccountStatus, Role } from '@/generated/prisma/client';

export async function seedAdministrator(
  client: SeedTransactionClient,
  email: string,
  passwordHash: string,
): Promise<void> {
  const admin = await client.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      passwordHash,
      role: Role.ADMIN,
      accountStatus: AccountStatus.ACTIVE,
    },
    select: { role: true },
  });

  if (admin.role !== Role.ADMIN) {
    throw new Error('Admin seed email belongs to a non-admin account');
  }
}
