import { seedAdministrator } from '@/database/seed/admin.seed';
import type { SeedTransactionClient } from '@/database/seed/seed-client';
import { AccountStatus, Role } from '@/generated/prisma/client';

describe('seedAdministrator', () => {
  it('creates an active administrator without changing existing credentials', async () => {
    const upsert = jest.fn().mockResolvedValue({ role: Role.ADMIN });
    const client = { user: { upsert } } as unknown as SeedTransactionClient;

    await seedAdministrator(client, 'admin@example.com', '$argon2id$admin-hash');

    expect(upsert).toHaveBeenCalledWith({
      where: { email: 'admin@example.com' },
      update: {},
      create: {
        email: 'admin@example.com',
        passwordHash: '$argon2id$admin-hash',
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

    await expect(
      seedAdministrator(client, 'admin@example.com', '$argon2id$admin-hash'),
    ).rejects.toThrow('Admin seed email belongs to a non-admin account');
  });
});
