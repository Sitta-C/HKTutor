import { argon2id, hash } from 'argon2';

import { seedAdministrator } from '@/database/seed/admin.seed';
import type { SeedDatabaseClient } from '@/database/seed/seed-client';
import { readSeedEnvironment } from '@/database/seed/seed-environment';
import { seedTutorFoundation } from '@/database/seed/tutor-foundation.seed';

async function hashSeedPassword(password: string): Promise<string> {
  return hash(password, {
    type: argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
}

export async function runSeed(client: SeedDatabaseClient): Promise<void> {
  const config = readSeedEnvironment(process.env);

  await client.$queryRawUnsafe('SELECT 1 AS connected');

  const adminPasswordHash = await hashSeedPassword(config.adminPassword);
  const tutorPasswordHash = await hashSeedPassword(config.tutorPassword);

  await client.$transaction(async (transaction) => {
    await seedAdministrator(transaction, config.adminEmail, adminPasswordHash);
    await seedTutorFoundation(transaction, config.tutorEmail, tutorPasswordHash);
  });
}

export type { SeedDatabaseClient } from '@/database/seed/seed-client';
