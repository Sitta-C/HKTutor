import { resolve } from 'node:path';

const { disposableCouponPaymentDatabaseUrl } = jest.requireActual<{
  disposableCouponPaymentDatabaseUrl: (environment: NodeJS.ProcessEnv) => string;
}>(resolve(__dirname, '../../..', 'scripts/verify-coupon-payments.ts'));

describe('coupon payment verifier target safety', () => {
  const target = 'postgresql://tester@127.0.0.1:55456/hktutor_coupon_payment_test';
  const approved = { HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY: '1' };

  it('requires both explicit opt-in and an explicit disposable URL', () => {
    expect(() => disposableCouponPaymentDatabaseUrl({ DATABASE_URL: target })).toThrow();
    expect(() => disposableCouponPaymentDatabaseUrl(approved)).toThrow();
  });

  it.each([
    'invalid',
    'https://localhost/hktutor_coupon_payment_test',
    'postgresql://tester@shared.example.test/hktutor_coupon_payment_test',
    'postgresql://tester@localhost/postgres',
    'postgresql://tester@localhost/hktutor_demo',
    target + '?host=shared.example.test',
    target + '#shared',
  ])('refuses unsafe target %s', (value) => {
    expect(() =>
      disposableCouponPaymentDatabaseUrl({ ...approved, DATABASE_URL: value }),
    ).toThrow();
  });

  it('accepts the approved loopback test database', () => {
    expect(disposableCouponPaymentDatabaseUrl({ ...approved, DATABASE_URL: target })).toBe(target);
  });
});
