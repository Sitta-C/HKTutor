import { seedStudent } from '@/database/seed/student.seed';
import { AccountStatus, Role } from '@/generated/prisma/client';

import type { SeedTransactionClient } from '@/database/seed/seed-client';
import type { Prisma } from '@/generated/prisma/client';

function createClient(existing: { id: string; role: Role } | null = null) {
  const findFirst = jest.fn().mockResolvedValue(existing);
  const create = jest
    .fn<Promise<{ id: string }>, [Prisma.UserCreateArgs]>()
    .mockResolvedValue({ id: 'student-user-id' });
  const update = jest
    .fn<Promise<{ id: string }>, [Prisma.UserUpdateArgs]>()
    .mockResolvedValue({ id: existing?.id ?? 'student-user-id' });
  const studentProfileUpsert = jest
    .fn<Promise<{ userId: string }>, [Prisma.StudentProfileUpsertArgs]>()
    .mockResolvedValue({ userId: existing?.id ?? 'student-user-id' });

  return {
    client: {
      studentProfile: { upsert: studentProfileUpsert },
      user: { create, findFirst, update },
    } as unknown as SeedTransactionClient,
    create,
    studentProfileUpsert,
    update,
  };
}

describe('seedStudent', () => {
  it('creates an active student with the nickname required by tutor booking views', async () => {
    const { client, create, studentProfileUpsert } = createClient();

    await expect(seedStudent(client, 'student@example.com', 'argon2id-hash')).resolves.toEqual({
      studentUserId: 'student-user-id',
    });
    expect(create.mock.calls[0]?.[0].data).toMatchObject({
      accountStatus: AccountStatus.ACTIVE,
      email: 'student@example.com',
      passwordHash: 'argon2id-hash',
      role: Role.STUDENT,
    });
    const profileArgs = studentProfileUpsert.mock.calls[0]?.[0];
    expect(profileArgs?.where).toEqual({ userId: 'student-user-id' });
    expect(profileArgs?.update).toMatchObject({ nickname: 'Nan' });
    expect(profileArgs?.create).toMatchObject({ nickname: 'Nan', userId: 'student-user-id' });
  });

  it('updates credentials and repairs a missing profile on repeat seed', async () => {
    const { client, create, studentProfileUpsert, update } = createClient({
      id: 'existing-student-id',
      role: Role.STUDENT,
    });

    await seedStudent(client, 'student@example.com', 'new-hash');

    expect(create).not.toHaveBeenCalled();
    expect(update.mock.calls[0]?.[0]).toMatchObject({
      data: { accountStatus: AccountStatus.ACTIVE, passwordHash: 'new-hash' },
      where: { id: 'existing-student-id' },
    });
    expect(studentProfileUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'existing-student-id' } }),
    );
  });

  it('refuses to convert an existing non-student account', async () => {
    const { client, studentProfileUpsert } = createClient({
      id: 'tutor-id',
      role: Role.TUTOR,
    });

    await expect(seedStudent(client, 'student@example.com', 'argon2id-hash')).rejects.toThrow(
      'Student seed email belongs to a non-student account',
    );
    expect(studentProfileUpsert).not.toHaveBeenCalled();
  });
});
