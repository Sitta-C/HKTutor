import { runSeed } from '@/database/seed';
import { Role } from '@/generated/prisma/client';

import type { SeedDatabaseClient, SeedTransactionClient } from '@/database/seed/seed-client';
import type { Prisma } from '@/generated/prisma/client';

function createSeedClient() {
  const query = jest.fn().mockResolvedValue([{ connected: 1 }]);
  const userUpsert = jest
    .fn<Promise<{ id?: string; role: Role }>, [Prisma.UserUpsertArgs]>()
    .mockResolvedValueOnce({ role: Role.ADMIN })
    .mockResolvedValueOnce({ id: 'tutor-user-id', role: Role.TUTOR });
  const transactionClient = {
    user: { upsert: userUpsert },
    subject: { upsert: jest.fn().mockResolvedValue({ id: 'subject-id' }) },
    gradeLevel: { upsert: jest.fn().mockResolvedValue({ id: 'grade-id' }) },
    tutorProfile: {
      upsert: jest.fn().mockResolvedValue({ userId: 'tutor-user-id' }),
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
    userUpsert,
  };
}

describe('runSeed', () => {
  beforeEach(() => {
    process.env['SEED_ADMIN_EMAIL'] = 'Admin@Example.com';
    process.env['SEED_ADMIN_PASSWORD'] = 'AdminPass';
    process.env['SEED_TUTOR_EMAIL'] = 'Tutor@Example.com';
    process.env['SEED_TUTOR_PASSWORD'] = 'TutorPass';
  });

  afterEach(() => {
    delete process.env['SEED_ADMIN_EMAIL'];
    delete process.env['SEED_ADMIN_PASSWORD'];
    delete process.env['SEED_TUTOR_EMAIL'];
    delete process.env['SEED_TUTOR_PASSWORD'];
  });

  it('probes connectivity before running all seed writes in one transaction', async () => {
    const { client, query, transaction } = createSeedClient();

    await runSeed(client);

    expect(query).toHaveBeenCalledWith('SELECT 1 AS connected');
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.invocationCallOrder[0]).toBeLessThan(transaction.mock.invocationCallOrder[0]);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('hashes both seed passwords with Argon2id before creating users', async () => {
    const { client, userUpsert } = createSeedClient();

    await runSeed(client);

    const adminCall = userUpsert.mock.calls[0]?.[0];
    const tutorCall = userUpsert.mock.calls[1]?.[0];
    expect(adminCall.create.passwordHash).toMatch(/^\$argon2id\$/);
    expect(adminCall.create.passwordHash).not.toContain('AdminPass');
    expect(tutorCall.create.passwordHash).toMatch(/^\$argon2id\$/);
    expect(tutorCall.create.passwordHash).not.toContain('TutorPass');
  });

  it('normalizes both emails and preserves existing user credentials on repeat runs', async () => {
    const { client, userUpsert } = createSeedClient();

    await runSeed(client);

    const adminCall = userUpsert.mock.calls[0]?.[0];
    const tutorCall = userUpsert.mock.calls[1]?.[0];
    expect(adminCall.where).toEqual({ email: 'admin@example.com' });
    expect(adminCall.update).toEqual({});
    expect(tutorCall.where).toEqual({ email: 'tutor@example.com' });
    expect(tutorCall.update).toEqual({});
  });

  it('rejects incomplete configuration before probing or opening a transaction', async () => {
    delete process.env['SEED_TUTOR_PASSWORD'];
    const { client, query, transaction } = createSeedClient();

    await expect(runSeed(client)).rejects.toThrow('Tutor seed environment is incomplete');
    expect(query).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });
});
