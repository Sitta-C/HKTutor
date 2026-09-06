import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadEnvironment } from 'dotenv';

import { normalizeDatabaseUrlForPg } from '@/config/database-url';
import { validateDatabaseEnvironment } from '@/config/database.config';
import {
  formatClerkMigrationPreflightResult,
  runClerkMigrationPreflight,
} from '@/database/clerk-migration-preflight';
import { PrismaClient } from '@/generated/prisma/client';

loadEnvironment({ path: '../../.env', quiet: true });
loadEnvironment({ quiet: true });

async function main(): Promise<void> {
  const environment = validateDatabaseEnvironment(process.env);
  const connectionString = normalizeDatabaseUrlForPg(environment['DATABASE_URL'] as string);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    const result = await runClerkMigrationPreflight(prisma);
    console.info(formatClerkMigrationPreflightResult(result));
    if (result.state === 'rejected') process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch(() => {
  process.exitCode = 1;
});
