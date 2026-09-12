import type { Prisma } from '@/generated/prisma/client';

export type SeedTransactionClient = Pick<
  Prisma.TransactionClient,
  | 'user'
  | 'studentProfile'
  | 'subject'
  | 'gradeLevel'
  | 'tutorProfile'
  | 'teachingListing'
  | 'availabilitySlot'
>;

export interface SeedDatabaseClient {
  $queryRawUnsafe<T = unknown>(query: string): Promise<T>;
  $transaction<T>(operation: (client: SeedTransactionClient) => Promise<T>): Promise<T>;
}
