import { runSeed, type SeedDatabaseClient } from '@/database/seed';
import { AccountStatus, Role } from '@/generated/prisma/client';

type SeedUserUpsertArgs = Parameters<SeedDatabaseClient['user']['upsert']>[0];
const createUpsert = (role: Role) =>
  jest.fn<Promise<{ role: Role }>, [SeedUserUpsertArgs]>().mockResolvedValue({ role });

describe('runSeed', () => {
  beforeEach(() => {
    process.env['SEED_ADMIN_EMAIL'] = 'Admin@Example.com';
    process.env['SEED_ADMIN_PASSWORD'] = 'Tutor@1234';
  });

  afterEach(() => {
    delete process.env['SEED_ADMIN_EMAIL'];
    delete process.env['SEED_ADMIN_PASSWORD'];
  });

  it('probes database connectivity before seeding the administrator', async () => {
    const query = jest.fn().mockResolvedValue([{ connected: 1 }]);
    const upsert = createUpsert(Role.ADMIN);

    await runSeed({ $queryRawUnsafe: query, user: { upsert } });

    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith('SELECT 1 AS connected');
  });

  it('creates an active administrator without storing the plaintext password', async () => {
    const query = jest.fn().mockResolvedValue([{ connected: 1 }]);
    const upsert = createUpsert(Role.ADMIN);
    const client = { $queryRawUnsafe: query, user: { upsert } };

    await runSeed(client);

    const call = upsert.mock.calls[0]?.[0];
    expect(call.create.email).toBe('admin@example.com');
    expect(call.create.role).toBe(Role.ADMIN);
    expect(call.create.accountStatus).toBe(AccountStatus.ACTIVE);
    expect(call.create.passwordHash).toMatch(/^\$argon2id\$/);
    expect(call.create.passwordHash).not.toContain('Tutor@1234');
  });

  it.each([undefined, '', '   ', '[ADMIN_PASSWORD]'])(
    'rejects invalid admin seed password %p before querying the database',
    async (password) => {
      if (password === undefined) {
        delete process.env['SEED_ADMIN_PASSWORD'];
      } else {
        process.env['SEED_ADMIN_PASSWORD'] = password;
      }
      const query = jest.fn().mockResolvedValue([{ connected: 1 }]);
      const upsert = createUpsert(Role.ADMIN);

      await expect(runSeed({ $queryRawUnsafe: query, user: { upsert } })).rejects.toThrow(
        'Admin seed environment is incomplete',
      );
      expect(query).not.toHaveBeenCalled();
      expect(upsert).not.toHaveBeenCalled();
    },
  );

  it('rejects the administrator email placeholder before querying the database', async () => {
    process.env['SEED_ADMIN_EMAIL'] = '[ADMIN_EMAIL]';
    const query = jest.fn().mockResolvedValue([{ connected: 1 }]);
    const upsert = createUpsert(Role.ADMIN);

    await expect(runSeed({ $queryRawUnsafe: query, user: { upsert } })).rejects.toThrow(
      'Admin seed environment is incomplete',
    );
    expect(query).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('preserves credentials when the seeded administrator already exists', async () => {
    const query = jest.fn().mockResolvedValue([{ connected: 1 }]);
    const upsert = createUpsert(Role.ADMIN);

    await runSeed({ $queryRawUnsafe: query, user: { upsert } });

    const call = upsert.mock.calls[0]?.[0];
    expect(call.where).toEqual({ email: 'admin@example.com' });
    expect(call.update).toEqual({});
  });

  it('refuses to elevate an existing non-admin account', async () => {
    const query = jest.fn().mockResolvedValue([{ connected: 1 }]);
    const upsert = createUpsert(Role.STUDENT);

    await expect(runSeed({ $queryRawUnsafe: query, user: { upsert } })).rejects.toThrow(
      'Admin seed email belongs to a non-admin account',
    );
  });
});
