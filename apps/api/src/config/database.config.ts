export function validateDatabaseEnvironment(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const databaseUrl = config['DATABASE_URL'];

  if (typeof databaseUrl !== 'string' || databaseUrl.trim() === '') {
    throw new Error('DATABASE_URL is required');
  }

  return config;
}
