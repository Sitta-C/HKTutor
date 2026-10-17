import { resolve } from 'node:path';

const { REJECTED_ATTENDANCE_BODIES, disposableAttendanceDatabaseUrl } = jest.requireActual<{
  REJECTED_ATTENDANCE_BODIES: readonly { label: string; body: unknown }[];
  disposableAttendanceDatabaseUrl: (env: NodeJS.ProcessEnv) => string;
}>(resolve(__dirname, '../../..', 'scripts/verify-attendance-rules.ts'));

describe('attendance verifier target safety (S2-T37)', () => {
  const safe = 'postgresql://tester@127.0.0.1:55441/hktutor_attendance_test';
  const approved = { HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY: '1' };

  it('requires an explicit target and opt-in without reading a fallback .env', () => {
    expect(() => disposableAttendanceDatabaseUrl({ DATABASE_URL: safe })).toThrow();
    expect(() => disposableAttendanceDatabaseUrl(approved)).toThrow();
    expect(() =>
      disposableAttendanceDatabaseUrl({
        HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY: 'true',
        DATABASE_URL: safe,
      }),
    ).toThrow();
  });

  it.each([
    'invalid',
    'https://localhost/hktutor_attendance_test',
    'postgresql://tester@database.example.test/hktutor_attendance_test',
    'postgresql://tester@db.supabase.co/hktutor_attendance_test',
    'postgresql://tester@localhost/postgres',
    'postgresql://tester@localhost/hktutor_demo',
    'postgresql://tester@localhost/hktutor',
    safe + '?schema=shared',
    safe + '?host=database.example.test',
    safe + '#shared',
  ])('refuses unsafe target %s', (value) => {
    expect(() => disposableAttendanceDatabaseUrl({ ...approved, DATABASE_URL: value })).toThrow();
  });

  it.each(['localhost', '127.0.0.1', '[::1]'])(
    'accepts the explicit loopback target %s',
    (host) => {
      const value = `postgresql://tester@${host}:55441/hktutor_attendance_test`;
      expect(disposableAttendanceDatabaseUrl({ ...approved, DATABASE_URL: value })).toBe(value);
    },
  );

  it('covers the story examples and mass-assignment attempts among rejected bodies', () => {
    const bodies = REJECTED_ATTENDANCE_BODIES.map(({ body }) => JSON.stringify(body));
    expect(bodies).toEqual(
      expect.arrayContaining([
        JSON.stringify({ attendance: 'late-ish' }),
        JSON.stringify({ attendance: 'attended' }),
        JSON.stringify({ attendance: 'ATTENDED', status: 'CANCELED' }),
        JSON.stringify({}),
      ]),
    );
    expect(new Set(REJECTED_ATTENDANCE_BODIES.map(({ label }) => label)).size).toBe(
      REJECTED_ATTENDANCE_BODIES.length,
    );
  });
});
