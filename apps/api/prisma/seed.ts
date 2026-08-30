import { config as loadEnvironment } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';

import { validateDatabaseEnvironment } from '../src/config/database.config';
import { normalizeDatabaseUrlForPg } from '../src/config/database-url';
import { runSeed } from '../src/database/seed';
import { PrismaClient } from '../src/generated/prisma/client';

loadEnvironment({ path: '../../.env', quiet: true });
loadEnvironment({ quiet: true });

async function main(): Promise<void> {
  const environment = validateDatabaseEnvironment(process.env);
  const connectionString = normalizeDatabaseUrlForPg(environment['DATABASE_URL'] as string);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    await runSeed(prisma);
    console.info('Database seed completed');
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch(() => {
  console.error('Database seed failed');
  process.exitCode = 1;
});
