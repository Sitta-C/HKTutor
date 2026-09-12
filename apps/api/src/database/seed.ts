import { PasswordService } from '@/auth/password.service';
import { seedAdministrator } from '@/database/seed/admin.seed';
import { seedBookingFixtures } from '@/database/seed/booking-fixtures.seed';
import { seedTutorSearchFixtures } from '@/database/seed/search-fixtures.seed';
import { readSeedEnvironment } from '@/database/seed/seed-environment';
import { seedStudent } from '@/database/seed/student.seed';
import { seedTutorFoundation } from '@/database/seed/tutor-foundation.seed';

import type { SeedDatabaseClient } from '@/database/seed/seed-client';

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

export type { SeedDatabaseClient } from '@/database/seed/seed-client';
