import { seedTutorFoundation } from '@/database/seed/tutor-foundation.seed';
import { AccountStatus, Role, TutorVerificationStatus } from '@/generated/prisma/client';

import type { SeedTransactionClient } from '@/database/seed/seed-client';

function createClient(role: Role = Role.TUTOR) {
  const subjectUpsert = jest.fn().mockResolvedValue({ id: 'subject-id' });
  const gradeLevelUpsert = jest.fn().mockResolvedValue({ id: 'grade-id' });
  const userUpsert = jest.fn().mockResolvedValue({ id: 'tutor-user-id', role });
  const tutorProfileUpsert = jest.fn().mockResolvedValue({ userId: 'tutor-user-id' });

  return {
    client: {
      subject: { upsert: subjectUpsert },
      gradeLevel: { upsert: gradeLevelUpsert },
      user: { upsert: userUpsert },
      tutorProfile: { upsert: tutorProfileUpsert },
    } as unknown as SeedTransactionClient,
    gradeLevelUpsert,
    subjectUpsert,
    tutorProfileUpsert,
    userUpsert,
  };
}

describe('seedTutorFoundation', () => {
  it('upserts canonical Mathematics and Grade 10 catalog rows', async () => {
    const { client, gradeLevelUpsert, subjectUpsert } = createClient();

    await seedTutorFoundation(client, 'tutor@example.com', '$argon2id$tutor-hash');

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
  });

  it('creates an active tutor and verified profile without overwriting credentials on repeat runs', async () => {
    const { client, tutorProfileUpsert, userUpsert } = createClient();

    await seedTutorFoundation(client, 'tutor@example.com', '$argon2id$tutor-hash');

    expect(userUpsert).toHaveBeenCalledWith({
      where: { email: 'tutor@example.com' },
      update: {},
      create: {
        email: 'tutor@example.com',
        passwordHash: '$argon2id$tutor-hash',
        role: Role.TUTOR,
        accountStatus: AccountStatus.ACTIVE,
      },
      select: { id: true, role: true },
    });
    expect(tutorProfileUpsert).toHaveBeenCalledWith({
      where: { userId: 'tutor-user-id' },
      update: { verificationStatus: TutorVerificationStatus.VERIFIED },
      create: {
        userId: 'tutor-user-id',
        displayName: 'Anan',
        bio: 'Verified tutor seeded for Sprint 1 demonstrations.',
        experienceYears: 5,
        verificationStatus: TutorVerificationStatus.VERIFIED,
        ratingAverage: null,
        reviewCount: 0,
        ratingUpdatedAt: null,
      },
    });
  });

  it.each([Role.STUDENT, Role.ADMIN])(
    'refuses to convert an existing %s account into the seeded tutor',
    async (role) => {
      const { client, tutorProfileUpsert } = createClient(role);

      await expect(
        seedTutorFoundation(client, 'tutor@example.com', '$argon2id$tutor-hash'),
      ).rejects.toThrow('Tutor seed email belongs to a non-tutor account');
      expect(tutorProfileUpsert).not.toHaveBeenCalled();
    },
  );
});
