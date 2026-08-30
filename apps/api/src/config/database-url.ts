export function normalizeDatabaseUrlForPg(databaseUrl: string): string {
  const parsed = new URL(databaseUrl);

  if (
    parsed.searchParams.get('sslmode') === 'require' &&
    !parsed.searchParams.has('uselibpqcompat')
  ) {
    parsed.searchParams.set('uselibpqcompat', 'true');
    return parsed.toString();
  }

  return databaseUrl;
}
