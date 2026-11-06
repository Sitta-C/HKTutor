import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '@infrastructure/database/prisma.service';
import { reconcileTutorReviewRatings } from '@modules/reviews/review-ratings';

export function reconciliationDatabaseUrl(environment: NodeJS.ProcessEnv): string {
  if (environment['HKTUTOR_APPLY_REVIEW_RATING_RECONCILIATION'] !== '1') {
    throw new Error('Explicit review-rating reconciliation opt-in required');
  }
  const value = environment['DATABASE_URL'];
  if (!value) {
    throw new Error('Explicit DATABASE_URL required; this command never loads .env');
  }
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.pathname.length <= 1) {
    throw new Error('A PostgreSQL database target is required');
  }
  return value;
}

async function main(): Promise<void> {
  const connectionString = reconciliationDatabaseUrl(process.env);
  const prisma = new PrismaService(new ConfigService({ DATABASE_URL: connectionString }));
  try {
    await prisma.$connect();
    const reconciled = await reconcileTutorReviewRatings(prisma);
    new Logger('ReviewRatings').log({ message: 'Review rating caches rebuilt', reconciled });
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main().catch(() => {
    // Driver errors may contain connection details; never log the target or raw error.
    new Logger('ReviewRatings').error('Review rating reconciliation failed');
    process.exitCode = 1;
  });
}
