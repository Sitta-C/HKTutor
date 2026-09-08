import { PasswordService } from '@/auth/password.service';
import { seedAdministrator } from '@/database/seed/admin.seed';
import { seedTutorSearchFixtures } from '@/database/seed/search-fixtures.seed';
import { readSeedEnvironment } from '@/database/seed/seed-environment';
import { seedTutorFoundation } from '@/database/seed/tutor-foundation.seed';

import type { SeedDatabaseClient } from '@/database/seed/seed-client';

export async function runSeed(client: SeedDatabaseClient): Promise<void> {
  const config = readSeedEnvironment(process.env);
  const passwords = new PasswordService();
  const [adminPasswordHash, tutorPasswordHash] = await Promise.all([
    passwords.hash(config.adminPassword),
    passwords.hash(config.tutorPassword),
  ]);

  await client.$queryRawUnsafe('SELECT 1 AS connected');

  await client.$transaction(async (transaction) => {
    await seedAdministrator(transaction, config.adminEmail, adminPasswordHash);
    const foundation = await seedTutorFoundation(transaction, config.tutorEmail, tutorPasswordHash);
    await seedTutorSearchFixtures(transaction, foundation);
  });
}

export type { SeedDatabaseClient } from '@/database/seed/seed-client';
