import { normalizeDatabaseUrlForPg } from '@/config/database-url';

describe('normalizeDatabaseUrlForPg', () => {
  it('uses libpq semantics for sslmode=require connections', () => {
    const normalized = normalizeDatabaseUrlForPg(
      'postgresql://user:password@example.test:5432/postgres?sslmode=require',
    );

    const parsed = new URL(normalized);
    expect(parsed.searchParams.get('sslmode')).toBe('require');
    expect(parsed.searchParams.get('uselibpqcompat')).toBe('true');
  });

  it('does not weaken an sslmode=verify-full connection', () => {
    const databaseUrl = 'postgresql://user:password@example.test:5432/postgres?sslmode=verify-full';

    expect(normalizeDatabaseUrlForPg(databaseUrl)).toBe(databaseUrl);
  });

  it('respects an explicitly configured libpq compatibility mode', () => {
    const databaseUrl =
      'postgresql://user:password@example.test:5432/postgres?sslmode=require&uselibpqcompat=false';

    expect(normalizeDatabaseUrlForPg(databaseUrl)).toBe(databaseUrl);
  });
});
