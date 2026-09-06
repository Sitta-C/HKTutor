import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadEnvironment } from 'dotenv';

import { normalizeDatabaseUrlForPg } from '@/config/database-url';
import { validateDatabaseEnvironment } from '@/config/database.config';
import { runSeed } from '@/database/seed';
import { PrismaClient } from '@/generated/prisma/client';

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
