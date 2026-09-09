import { seedTutorFoundation } from '@/database/seed/tutor-foundation.seed';
import { AccountStatus, Role, TutorVerificationStatus } from '@/generated/prisma/client';

import type { SeedTransactionClient } from '@/database/seed/seed-client';
import type { Prisma } from '@/generated/prisma/client';

function createClient(existing: { id: string; role: Role } | null = null) {
  const subjectUpsert = jest.fn().mockResolvedValue({ id: 'subject-id' });
  const gradeLevelUpsert = jest.fn().mockResolvedValue({ id: 'grade-id' });
  const findFirst = jest.fn().mockResolvedValue(existing);
  const create = jest
    .fn<Promise<{ id: string; role: Role }>, [Prisma.UserCreateArgs]>()
    .mockResolvedValue({ id: 'tutor-user-id', role: Role.TUTOR });
  const update = jest
    .fn<Promise<{ id: string | undefined; role: Role | undefined }>, [Prisma.UserUpdateArgs]>()
    .mockResolvedValue({ id: existing?.id, role: existing?.role });
  const tutorProfileUpsert = jest
    .fn<Promise<{ userId: string }>, [Prisma.TutorProfileUpsertArgs]>()
    .mockResolvedValue({ userId: 'tutor-user-id' });

  return {
    client: {
      subject: { upsert: subjectUpsert },
      gradeLevel: { upsert: gradeLevelUpsert },
      user: { findFirst, create, update },
      tutorProfile: { upsert: tutorProfileUpsert },
    } as unknown as SeedTransactionClient,
    create,
    gradeLevelUpsert,
    subjectUpsert,
    tutorProfileUpsert,
    update,
  };
}

describe('seedTutorFoundation', () => {
  it('creates a verified local tutor and canonical catalog rows', async () => {
    const { client, create, gradeLevelUpsert, subjectUpsert, tutorProfileUpsert } = createClient();

    await expect(
      seedTutorFoundation(client, 'tutor@example.com', 'argon2id-hash'),
    ).resolves.toEqual({
      tutorUserId: 'tutor-user-id',
      mathematicsSubjectId: 'subject-id',
      grade10Id: 'grade-id',
    });

    expect(subjectUpsert).toHaveBeenCalledWith({
      where: { code: 'mathematics' },
      update: { name: 'Mathematics', active: true },
      create: { code: 'mathematics', name: 'Mathematics', active: true },
    });
    expect(gradeLevelUpsert).toHaveBeenCalledWith({
      where: { code: 'grade-10' },
      update: { name: 'Grade 10', sortOrder: 10, active: true },
      create: { code: 'grade-10', name: 'Grade 10', sortOrder: 10, active: true },
    });
    const createArgs = create.mock.calls[0]?.[0];
    expect(createArgs?.data).toMatchObject({
      email: 'tutor@example.com',
      passwordHash: 'argon2id-hash',
      role: Role.TUTOR,
      accountStatus: AccountStatus.ACTIVE,
    });
    expect(createArgs?.data.emailVerifiedAt).toBeInstanceOf(Date);
    expect(createArgs?.select).toEqual({ id: true, role: true });

    const profileArgs = tutorProfileUpsert.mock.calls[0]?.[0];
    expect(profileArgs?.where).toEqual({ userId: 'tutor-user-id' });
    expect(profileArgs?.update).toMatchObject({
      firstName: 'Anan',
      lastName: 'Sukjai',
      nickname: 'Anan',
      displayName: 'Anan',
      verificationStatus: TutorVerificationStatus.VERIFIED,
    });
    expect(profileArgs?.create).toMatchObject({
      userId: 'tutor-user-id',
      firstName: 'Anan',
      lastName: 'Sukjai',
      nickname: 'Anan',
      verificationStatus: TutorVerificationStatus.VERIFIED,
    });
  });

  it('updates credentials on a repeat seed without creating a second tutor', async () => {
    const { client, create, update } = createClient({ id: 'existing-id', role: Role.TUTOR });

    await seedTutorFoundation(client, 'tutor@example.com', 'new-hash');

    expect(create).not.toHaveBeenCalled();
    const updateArgs = update.mock.calls[0]?.[0];
    expect(updateArgs?.where).toEqual({ id: 'existing-id' });
    expect(updateArgs?.data).toMatchObject({
      passwordHash: 'new-hash',
      accountStatus: AccountStatus.ACTIVE,
    });
    expect(updateArgs?.data.emailVerifiedAt).toBeInstanceOf(Date);
    expect(updateArgs?.select).toEqual({ id: true, role: true });
  });

  it('refuses to convert an existing non-tutor account', async () => {
    const { client, tutorProfileUpsert } = createClient({
      id: 'student-id',
      role: Role.STUDENT,
    });

    await expect(seedTutorFoundation(client, 'tutor@example.com', 'argon2id-hash')).rejects.toThrow(
      'Tutor seed email belongs to a non-tutor account',
    );
    expect(tutorProfileUpsert).not.toHaveBeenCalled();
  });
});
