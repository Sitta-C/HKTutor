import { resolve } from 'node:path';

const { disposableDatabaseUrl, readGate } = jest.requireActual<{
  disposableDatabaseUrl: () => string;
  readGate: (id: string) => { arrive: () => Promise<void>; close: () => void };
}>(resolve(__dirname, '../../..', 'scripts/verify-tutor-booking-transitions.ts'));

describe('disposable tutor transition verifier', () => {
  const originalUrl = process.env['DATABASE_URL'];
  const originalApproval = process.env['HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY'];

  afterEach(() => {
    if (originalUrl === undefined) delete process.env['DATABASE_URL'];
    else process.env['DATABASE_URL'] = originalUrl;
    if (originalApproval === undefined) delete process.env['HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY'];
    else process.env['HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY'] = originalApproval;
    jest.useRealTimers();
  });

  it.each([
    'postgresql://postgres@127.0.0.1:55434/hktutor_review_test',
    'postgres://tester@localhost:5432/hktutor-review-test',
    'postgresql://tester@[::1]:6543/hktutor_test',
  ])('accepts explicitly approved loopback URL %s', (url) => {
    process.env['HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY'] = '1';
    process.env['DATABASE_URL'] = url;
    expect(disposableDatabaseUrl()).toBe(url);
  });

  it.each([
    undefined,
    'invalid-url',
    'https://localhost/hktutor_test',
    'postgresql://tester@db.example.test/hktutor_test',
    'postgresql://tester@localhost/shared',
    'postgresql://tester@localhost/hktutor_test?schema=other',
    'postgresql://tester@localhost/hktutor_test?options=-csearch_path%3Dother',
    'postgresql://tester@localhost/hktutor_test#other',
  ])('refuses unsafe or omitted target %p before connecting', (url) => {
    process.env['HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY'] = '1';
    if (url === undefined) delete process.env['DATABASE_URL'];
    else process.env['DATABASE_URL'] = url;
    expect(disposableDatabaseUrl).toThrow();
  });

  it('requires explicit approval even for a loopback target', () => {
    delete process.env['HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY'];
    process.env['DATABASE_URL'] = 'postgresql://tester@localhost/hktutor_test';
    expect(disposableDatabaseUrl).toThrow('Explicit disposable database approval is required');
  });

  it('holds the first read until the second read arrives', async () => {
    jest.useFakeTimers();
    const gate = readGate('booking');
    let released = false;
    const first = gate.arrive().then(() => {
      released = true;
    });
    await Promise.resolve();
    expect(released).toBe(false);
    await gate.arrive();
    await first;
    expect(released).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
    gate.close();
  });

  it('handles timeout before any read arrives and still rejects a late read', async () => {
    jest.useFakeTimers();
    const gate = readGate('booking');
    try {
      // Test synchronization timeout: milliseconds, unrelated to booking eligibility.
      await jest.advanceTimersByTimeAsync(5001);
      await expect(gate.arrive()).rejects.toThrow('Both service reads did not arrive');
    } finally {
      gate.close();
    }
    expect(jest.getTimerCount()).toBe(0);
  });

  it('releases a waiting read during cleanup', async () => {
    jest.useFakeTimers();
    const gate = readGate('booking');
    const first = gate.arrive();
    gate.close();
    await expect(first).resolves.toBeUndefined();
    expect(jest.getTimerCount()).toBe(0);
  });
});
