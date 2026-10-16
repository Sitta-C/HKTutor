import { resolve } from 'node:path';

const { disposableDatabaseUrl } = jest.requireActual<{ disposableDatabaseUrl: () => string }>(
  resolve(__dirname, '../../..', 'scripts/verify-reschedule-endpoint-concurrency.ts'),
);

describe('disposable reschedule endpoint verifier safety', () => {
  const originalUrl = process.env['DATABASE_URL'];
  const originalApproval = process.env['HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY'];

  afterEach(() => {
    if (originalUrl === undefined) {
      delete process.env['DATABASE_URL'];
    } else {
      process.env['DATABASE_URL'] = originalUrl;
    }
    if (originalApproval === undefined) {
      delete process.env['HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY'];
    } else {
      process.env['HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY'] = originalApproval;
    }
  });

  it.each([
    'postgresql://tester@127.0.0.1:55436/hktutor_reschedule_endpoints_test',
    'postgres://tester@localhost:5432/hktutor-reschedule-test',
    'postgresql://tester@[::1]:6543/hktutor_endpoint_test',
  ])('accepts an explicitly approved local test target %s', (url) => {
    process.env['HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY'] = '1';
    process.env['DATABASE_URL'] = url;
    expect(disposableDatabaseUrl()).toBe(url);
  });

  it.each([
    undefined,
    'invalid-url',
    'https://localhost/hktutor_endpoint_test',
    'postgresql://tester@db.example.test/hktutor_endpoint_test',
    'postgresql://tester@localhost/shared',
    'postgresql://tester@localhost/hktutor_production',
    'postgresql://tester@localhost/hktutor_endpoint_test?schema=other',
    'postgresql://tester@localhost/hktutor_endpoint_test?options=-csearch_path%3Dother',
    'postgresql://tester@localhost/hktutor_endpoint_test#other',
  ])('refuses unsafe or omitted target %p before connecting', (url) => {
    process.env['HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY'] = '1';
    if (url === undefined) {
      delete process.env['DATABASE_URL'];
    } else {
      process.env['DATABASE_URL'] = url;
    }
    expect(disposableDatabaseUrl).toThrow();
  });

  it('requires explicit opt-in even for a loopback test database', () => {
    delete process.env['HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY'];
    process.env['DATABASE_URL'] = 'postgresql://tester@localhost/hktutor_endpoint_test';
    expect(disposableDatabaseUrl).toThrow('Explicit opt-in required');
  });
});
