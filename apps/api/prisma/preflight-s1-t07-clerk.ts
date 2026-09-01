import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadEnvironment } from 'dotenv';

import { validateDatabaseEnvironment } from '../src/config/database.config';
import { normalizeDatabaseUrlForPg } from '../src/config/database-url';
import {
  formatClerkMigrationPreflightResult,
  runClerkMigrationPreflight,
} from '../src/database/clerk-migration-preflight';
import { PrismaClient } from '../src/generated/prisma/client';

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
