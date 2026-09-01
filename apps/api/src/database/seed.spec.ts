import { runSeed } from '@/database/seed';
import { Role } from '@/generated/prisma/client';

import type { SeedDatabaseClient, SeedTransactionClient } from '@/database/seed/seed-client';
import type { Prisma } from '@/generated/prisma/client';

function createSeedClient() {
  const query = jest.fn().mockResolvedValue([{ connected: 1 }]);
  const userUpsert = jest
    .fn<Promise<{ id?: string; role: Role }>, [Prisma.UserUpsertArgs]>()
    .mockImplementation((args) => {
      const clerkUserId = args.where.clerkUserId;

      if (clerkUserId === 'user_admin') {
        return Promise.resolve({ role: Role.ADMIN });
      }

      if (clerkUserId === 'user_tutor') {
        return Promise.resolve({ id: 'tutor-user-id', role: Role.TUTOR });
      }

      return Promise.resolve({
        id: args.create.id,
        role: Role.TUTOR,
      });
    });
  const teachingListingUpsert = jest.fn().mockResolvedValue({ id: 'listing-id' });
  const transactionClient = {
    user: { upsert: userUpsert },
    subject: { upsert: jest.fn().mockResolvedValue({ id: 'subject-id' }) },
    gradeLevel: { upsert: jest.fn().mockResolvedValue({ id: 'grade-id' }) },
    tutorProfile: {
      update: jest.fn().mockResolvedValue({ userId: 'tutor-user-id' }),
      upsert: jest.fn().mockResolvedValue({ userId: 'tutor-user-id' }),
    },
    teachingListing: {
      upsert: teachingListingUpsert,
    },
  } as unknown as SeedTransactionClient;
  const transaction = jest.fn(async (operation: (client: SeedTransactionClient) => Promise<void>) =>
    operation(transactionClient),
  );

  return {
    client: {
      $queryRawUnsafe: query,
      $transaction: transaction,
    } as SeedDatabaseClient,
    query,
    transaction,
    teachingListingUpsert,
    userUpsert,
  };
}

describe('runSeed', () => {
  beforeEach(() => {
    process.env['SEED_ADMIN_CLERK_USER_ID'] = 'user_admin';
    process.env['SEED_ADMIN_EMAIL'] = 'Admin@Example.com';
    process.env['SEED_TUTOR_CLERK_USER_ID'] = 'user_tutor';
    process.env['SEED_TUTOR_EMAIL'] = 'Tutor@Example.com';
  });

  afterEach(() => {
    delete process.env['SEED_ADMIN_CLERK_USER_ID'];
    delete process.env['SEED_ADMIN_EMAIL'];
    delete process.env['SEED_TUTOR_CLERK_USER_ID'];
    delete process.env['SEED_TUTOR_EMAIL'];
  });

  it('probes connectivity before running all seed writes in one transaction', async () => {
    const { client, query, transaction } = createSeedClient();

    await runSeed(client);

    expect(query).toHaveBeenCalledWith('SELECT 1 AS connected');
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.invocationCallOrder[0]).toBeLessThan(transaction.mock.invocationCallOrder[0]);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('maps seeded users to Clerk identities without storing local credentials', async () => {
    const { client, userUpsert } = createSeedClient();

    await runSeed(client);

    const adminCall = userUpsert.mock.calls[0]?.[0];
    const tutorCall = userUpsert.mock.calls[1]?.[0];
    expect(adminCall.create).toMatchObject({
      clerkUserId: 'user_admin',
      primaryEmail: 'admin@example.com',
    });
    expect(tutorCall.create).toMatchObject({
      clerkUserId: 'user_tutor',
      primaryEmail: 'tutor@example.com',
    });
    expect(adminCall.create).not.toHaveProperty('passwordHash');
    expect(tutorCall.create).not.toHaveProperty('passwordHash');
  });

  it('adds the four non-loginable tutor fixtures and six stable listings in the same transaction', async () => {
    const { client, teachingListingUpsert, userUpsert } = createSeedClient();

    await runSeed(client);

    expect(userUpsert.mock.calls.map(([args]) => args.where.clerkUserId)).toEqual([
      'user_admin',
      'user_tutor',
      'user_s1t20_mali',
      'user_s1t20_kiet',
      'user_s1t20_niran',
      'user_s1t20_pim',
    ]);
    expect(userUpsert.mock.calls.slice(2).map(([args]) => args.create.id)).toEqual([
      '20000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000002',
      '20000000-0000-4000-8000-000000000003',
      '20000000-0000-4000-8000-000000000004',
    ]);
    expect(teachingListingUpsert).toHaveBeenCalledTimes(6);
  });

  it('normalizes cached emails and updates them by Clerk identity on repeat runs', async () => {
    const { client, userUpsert } = createSeedClient();

    await runSeed(client);

    const adminCall = userUpsert.mock.calls[0]?.[0];
    const tutorCall = userUpsert.mock.calls[1]?.[0];
    expect(adminCall.where).toEqual({ clerkUserId: 'user_admin' });
    expect(adminCall.update).toEqual({ primaryEmail: 'admin@example.com' });
    expect(tutorCall.where).toEqual({ clerkUserId: 'user_tutor' });
    expect(tutorCall.update).toEqual({ primaryEmail: 'tutor@example.com' });
  });

  it('rejects incomplete configuration before probing or opening a transaction', async () => {
    delete process.env['SEED_TUTOR_CLERK_USER_ID'];
    const { client, query, transaction } = createSeedClient();

    await expect(runSeed(client)).rejects.toThrow('Tutor seed environment is incomplete');
    expect(query).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });
});
