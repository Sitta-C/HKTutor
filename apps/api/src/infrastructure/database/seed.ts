import { seedAdministrator } from '@infrastructure/database/seed/admin.seed';
import { seedBookingFixtures } from '@infrastructure/database/seed/booking-fixtures.seed';
import { seedTutorSearchFixtures } from '@infrastructure/database/seed/search-fixtures.seed';
import { readSeedEnvironment } from '@infrastructure/database/seed/seed-environment';
import { seedStudent } from '@infrastructure/database/seed/student.seed';
import { seedTutorFoundation } from '@infrastructure/database/seed/tutor-foundation.seed';
import { PasswordService } from '@modules/auth/password.service';

import type { SeedDatabaseClient } from '@infrastructure/database/seed/seed-client';

export async function runSeed(client: SeedDatabaseClient): Promise<void> {
  const config = readSeedEnvironment(process.env);
  const passwords = new PasswordService();
  const [adminPasswordHash, tutorPasswordHash, studentPasswordHash] = await Promise.all([
    passwords.hash(config.adminPassword),
    passwords.hash(config.tutorPassword),
    passwords.hash(config.studentPassword),
  ]);

  await client.$queryRawUnsafe('SELECT 1 AS connected');

  await client.$transaction(async (transaction) => {
    await seedAdministrator(transaction, config.adminEmail, adminPasswordHash);
    const foundation = await seedTutorFoundation(transaction, config.tutorEmail, tutorPasswordHash);
    await seedTutorSearchFixtures(transaction, foundation);
    await seedStudent(transaction, config.studentEmail, studentPasswordHash);
    await seedBookingFixtures(transaction, foundation);
  });
}

export type { SeedDatabaseClient } from '@infrastructure/database/seed/seed-client';
