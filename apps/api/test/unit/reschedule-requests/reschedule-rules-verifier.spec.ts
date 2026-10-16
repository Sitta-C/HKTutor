import { resolve } from 'node:path';

interface ControlledClock {
  freeze: (at: number) => void;
  release: () => void;
  uninstall: () => void;
}

const { disposableDatabaseUrl, installControlledClock } = jest.requireActual<{
  disposableDatabaseUrl: () => string;
  installControlledClock: () => ControlledClock;
}>(resolve(__dirname, '../../..', 'scripts/verify-reschedule-rules.ts'));

const FROZEN = Date.UTC(2026, 9, 16, 3, 0, 0);

describe('reschedule rules verifier database guard', () => {
  const originalUrl = process.env['DATABASE_URL'];
  const originalApproval = process.env['HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY'];

  afterEach(() => {
    if (originalUrl === undefined) delete process.env['DATABASE_URL'];
    else process.env['DATABASE_URL'] = originalUrl;
    if (originalApproval === undefined) delete process.env['HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY'];
    else process.env['HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY'] = originalApproval;
  });

  it('accepts an approved loopback hktutor database', () => {
    process.env['HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY'] = '1';
    process.env['DATABASE_URL'] =
      'postgresql://postgres:postgres@127.0.0.1:55432/hktutor_s2t27_test';

    expect(disposableDatabaseUrl()).toBe(process.env['DATABASE_URL']);
  });

  it.each([
    ['a shared remote host', 'postgresql://user:secret@db.example.com:5432/hktutor_s2t27_test'],
    ['a database without the hktutor prefix', 'postgresql://postgres@127.0.0.1:5432/postgres'],
    ['a schema override', 'postgresql://postgres@127.0.0.1:5432/hktutor_s2t27_test?schema=other'],
  ])('rejects %s', (_label, url) => {
    process.env['HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY'] = '1';
    process.env['DATABASE_URL'] = url;

    expect(() => disposableDatabaseUrl()).toThrow();
  });

  it('requires explicit approval even for a loopback target', () => {
    delete process.env['HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY'];
    process.env['DATABASE_URL'] = 'postgresql://postgres@127.0.0.1:55432/hktutor_s2t27_test';

    expect(() => disposableDatabaseUrl()).toThrow('Explicit disposable database approval');
  });
});

describe('reschedule rules verifier clock', () => {
  let clock: ControlledClock;

  beforeEach(() => {
    clock = installControlledClock();
  });

  afterEach(() => {
    clock.uninstall();
  });

  it('freezes new Date() and Date.now() while frozen', () => {
    clock.freeze(FROZEN);

    expect(new Date().getTime()).toBe(FROZEN);
    expect(Date.now()).toBe(FROZEN);
  });

  it('leaves explicit dates and static helpers working', () => {
    clock.freeze(FROZEN);

    expect(new Date('2026-01-01T00:00:00.000Z').toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(new Date(0).getTime()).toBe(0);
    expect(Date.UTC(2026, 0, 1)).toBe(Date.parse('2026-01-01T00:00:00.000Z'));
    expect(new Date()).toBeInstanceOf(Date);
  });

  it('follows the real clock again after release', () => {
    clock.freeze(FROZEN);
    clock.release();

    expect(Math.abs(Date.now() - performance.timeOrigin - performance.now())).toBeLessThan(1000);
  });

  it('restores the native Date on uninstall', () => {
    const replaced = Date;

    clock.uninstall();

    expect(Date).not.toBe(replaced);
    expect(new Date().getTime()).not.toBe(FROZEN);
  });
});
