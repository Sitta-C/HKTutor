import { resolve } from 'node:path';

const { disposableAdminCouponDatabaseUrl } = jest.requireActual<{
  disposableAdminCouponDatabaseUrl: (environment: NodeJS.ProcessEnv) => string;
}>(resolve(__dirname, '../../..', 'scripts/verify-admin-coupons.ts'));

describe('admin coupon verifier target safety', () => {
  const target = 'postgresql://tester@127.0.0.1:55451/hktutor_coupon_api_test';
  const approved = { HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY: '1' };

  it('requires both explicit opt-in and an explicit disposable URL', () => {
    expect(() => disposableAdminCouponDatabaseUrl({ DATABASE_URL: target })).toThrow();
    expect(() => disposableAdminCouponDatabaseUrl(approved)).toThrow();
  });

  it.each([
    'invalid',
    'https://localhost/hktutor_coupon_api_test',
    'postgresql://tester@shared.example.test/hktutor_coupon_api_test',
    'postgresql://tester@localhost/postgres',
    'postgresql://tester@localhost/hktutor_demo',
    target + '?host=shared.example.test',
    target + '#shared',
  ])('refuses unsafe target %s', (value) => {
    expect(() => disposableAdminCouponDatabaseUrl({ ...approved, DATABASE_URL: value })).toThrow();
  });

  it('accepts the approved loopback test database', () => {
    expect(disposableAdminCouponDatabaseUrl({ ...approved, DATABASE_URL: target })).toBe(target);
  });
});
