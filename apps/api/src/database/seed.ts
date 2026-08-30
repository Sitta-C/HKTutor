export interface SeedDatabaseClient {
  $queryRawUnsafe<T = unknown>(query: string): Promise<T>;
}

export async function runSeed(client: SeedDatabaseClient): Promise<void> {
  await client.$queryRawUnsafe('SELECT 1 AS connected');
}
