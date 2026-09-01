import { seedAdministrator } from '@/database/seed/admin.seed';
import { AccountStatus, Role } from '@/generated/prisma/client';

import type { SeedTransactionClient } from '@/database/seed/seed-client';

describe('seedAdministrator', () => {
  it('creates an active administrator mapped to an existing Clerk identity', async () => {
    const upsert = jest.fn().mockResolvedValue({ role: Role.ADMIN });
    const client = { user: { upsert } } as unknown as SeedTransactionClient;

    await seedAdministrator(client, 'user_admin', 'admin@example.com');

    expect(upsert).toHaveBeenCalledWith({
      where: { clerkUserId: 'user_admin' },
      update: { primaryEmail: 'admin@example.com' },
      create: {
        clerkUserId: 'user_admin',
        primaryEmail: 'admin@example.com',
        role: Role.ADMIN,
        accountStatus: AccountStatus.ACTIVE,
      },
      select: { role: true },
    });
  });

  it('refuses to elevate an existing non-admin account', async () => {
    const client = {
      user: { upsert: jest.fn().mockResolvedValue({ role: Role.TUTOR }) },
    } as unknown as SeedTransactionClient;

    await expect(seedAdministrator(client, 'user_admin', 'admin@example.com')).rejects.toThrow(
      'Admin seed Clerk user ID belongs to a non-admin account',
    );
  });
});
