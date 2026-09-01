import type { Prisma } from '@/generated/prisma/client';

export type SeedTransactionClient = Pick<
  Prisma.TransactionClient,
  'user' | 'subject' | 'gradeLevel' | 'tutorProfile' | 'teachingListing'
>;

export interface SeedDatabaseClient {
  $queryRawUnsafe<T = unknown>(query: string): Promise<T>;
  $transaction<T>(operation: (client: SeedTransactionClient) => Promise<T>): Promise<T>;
}
