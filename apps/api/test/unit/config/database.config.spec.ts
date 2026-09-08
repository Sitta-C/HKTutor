import { validateDatabaseEnvironment } from '@/config/database.config';

describe('validateDatabaseEnvironment', () => {
  it.each([undefined, '', '   '])('rejects a missing or blank DATABASE_URL', (databaseUrl) => {
    const config = databaseUrl === undefined ? {} : { DATABASE_URL: databaseUrl };

    expect(() => validateDatabaseEnvironment(config)).toThrow('DATABASE_URL is required');
  });

  it('returns valid configuration unchanged', () => {
    const config = {
      DATABASE_URL: 'postgresql://user:password@example.test:5432/postgres?sslmode=require',
      PORT: '3001',
    };

    expect(validateDatabaseEnvironment(config)).toBe(config);
  });

  it('does not expose the supplied URL when validation fails', () => {
    const secretBearingValue = {
      toString: () => 'postgresql://user:do-not-print@example.test/postgres',
    };

    expect(() => validateDatabaseEnvironment({ DATABASE_URL: secretBearingValue })).toThrow(
      'DATABASE_URL is required',
    );

    try {
      validateDatabaseEnvironment({ DATABASE_URL: secretBearingValue });
    } catch (error) {
      expect(String(error)).not.toContain('do-not-print');
    }
  });
});
