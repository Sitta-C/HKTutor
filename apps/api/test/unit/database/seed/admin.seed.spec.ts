import { seedAdministrator } from '@/database/seed/admin.seed';
import { AccountStatus, Role } from '@/generated/prisma/client';

import type { SeedTransactionClient } from '@/database/seed/seed-client';

describe('seedAdministrator', () => {
  it('creates a verified local administrator', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const create = jest.fn().mockResolvedValue({ id: 'admin-id' });
    const client = { user: { findFirst, create } } as unknown as SeedTransactionClient;

    await seedAdministrator(client, 'admin@example.com', 'argon-hash');

    expect(create).toHaveBeenCalledTimes(1);
    const calls = create.mock.calls as unknown as Array<
      [
        {
          data: {
            accountStatus: AccountStatus;
            email: string;
            emailVerifiedAt: Date;
            passwordHash: string;
            role: Role;
          };
        },
      ]
    >;
    const data = calls[0]?.[0].data;
    expect(data).toMatchObject({
      email: 'admin@example.com',
      passwordHash: 'argon-hash',
      role: Role.ADMIN,
      accountStatus: AccountStatus.ACTIVE,
    });
    expect(data?.emailVerifiedAt).toBeInstanceOf(Date);
  });

  it('refuses to elevate a non-admin account', async () => {
    const client = {
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'user-id', role: Role.TUTOR }) },
    } as unknown as SeedTransactionClient;

    await expect(seedAdministrator(client, 'admin@example.com', 'argon-hash')).rejects.toThrow(
      'Admin seed email belongs to a non-admin account',
    );
  });
});
