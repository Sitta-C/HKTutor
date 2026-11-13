import { seedAdministrator } from '@infrastructure/database/seed/admin.seed';
import { seedBookingFixtures } from '@infrastructure/database/seed/booking-fixtures.seed';
import { seedReviewFixtures } from '@infrastructure/database/seed/review-fixtures.seed';
import { seedTutorSearchFixtures } from '@infrastructure/database/seed/search-fixtures.seed';
import { readSeedEnvironment } from '@infrastructure/database/seed/seed-environment';
import { seedSprint2Demo } from '@infrastructure/database/seed/sprint2-demo.seed';
import { seedSprint3Demo } from '@infrastructure/database/seed/sprint3-demo.seed';
import { seedSprint3Fixtures } from '@infrastructure/database/seed/sprint3-fixtures.seed';
import { seedStudent } from '@infrastructure/database/seed/student.seed';
import { seedTutorFoundation } from '@infrastructure/database/seed/tutor-foundation.seed';
import { PasswordService } from '@modules/auth/password.service';

import type { SeedDatabaseClient } from '@infrastructure/database/seed/seed-client';

export async function runSeed(client: SeedDatabaseClient, now: Date = new Date()): Promise<void> {
  const config = readSeedEnvironment(process.env);
  const passwords = new PasswordService();
  const [adminPasswordHash, tutorPasswordHash, studentPasswordHash] = await Promise.all([
    passwords.hash(config.adminPassword),
    passwords.hash(config.tutorPassword),
    passwords.hash(config.studentPassword),
  ]);

  await client.$queryRawUnsafe('SELECT 1 AS connected');

  await client.$transaction(
    async (transaction) => {
      await seedAdministrator(transaction, config.adminEmail, adminPasswordHash);
      const foundation = await seedTutorFoundation(
        transaction,
        config.tutorEmail,
        tutorPasswordHash,
      );
      await seedTutorSearchFixtures(transaction, foundation);
      const student = await seedStudent(transaction, config.studentEmail, studentPasswordHash);
      await seedBookingFixtures(transaction, foundation);
      await seedReviewFixtures(transaction, student);
      await seedSprint2Demo(transaction, foundation, student, now);
      await seedSprint3Demo(transaction, foundation, student, now);
      await seedSprint3Fixtures(transaction, now);
    },
    { timeout: 30_000 },
  );
}

export type { SeedDatabaseClient } from '@infrastructure/database/seed/seed-client';
