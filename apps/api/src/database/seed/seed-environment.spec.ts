import { readSeedEnvironment } from '@/database/seed/seed-environment';

const completeEnvironment = {
  SEED_ADMIN_CLERK_USER_ID: ' user_admin ',
  SEED_ADMIN_EMAIL: ' Admin@Example.com ',
  SEED_TUTOR_CLERK_USER_ID: '\tuser_tutor\n',
  SEED_TUTOR_EMAIL: ' Tutor@Example.com ',
};

describe('readSeedEnvironment', () => {
  it('normalizes Clerk user IDs and cached primary emails', () => {
    expect(readSeedEnvironment(completeEnvironment)).toEqual({
      adminClerkUserId: 'user_admin',
      adminEmail: 'admin@example.com',
      tutorClerkUserId: 'user_tutor',
      tutorEmail: 'tutor@example.com',
    });
  });

  it.each([undefined, '', '   ', '[ADMIN_EMAIL]', '[ADMIN_CLERK_USER_ID]'])(
    'rejects incomplete administrator seed value %p',
    (value) => {
      const environment = { ...completeEnvironment };

      if (value === undefined) {
        delete environment.SEED_ADMIN_CLERK_USER_ID;
      } else if (value === '[ADMIN_EMAIL]') {
        environment.SEED_ADMIN_EMAIL = value;
      } else {
        environment.SEED_ADMIN_CLERK_USER_ID = value;
      }

      expect(() => readSeedEnvironment(environment)).toThrow(
        'Admin seed environment is incomplete',
      );
    },
  );

  it.each([undefined, '', '   ', '[TUTOR_EMAIL]', '[TUTOR_CLERK_USER_ID]'])(
    'rejects incomplete tutor seed value %p',
    (value) => {
      const environment = { ...completeEnvironment };

      if (value === undefined) {
        delete environment.SEED_TUTOR_CLERK_USER_ID;
      } else if (value === '[TUTOR_EMAIL]') {
        environment.SEED_TUTOR_EMAIL = value;
      } else {
        environment.SEED_TUTOR_CLERK_USER_ID = value;
      }

      expect(() => readSeedEnvironment(environment)).toThrow(
        'Tutor seed environment is incomplete',
      );
    },
  );

  it('rejects the same administrator and tutor email case-insensitively', () => {
    expect(() =>
      readSeedEnvironment({
        ...completeEnvironment,
        SEED_ADMIN_EMAIL: 'ADMIN@example.com',
        SEED_TUTOR_EMAIL: 'admin@EXAMPLE.com',
      }),
    ).toThrow('Admin and tutor seed emails must be different');
  });

  it('rejects the same Clerk identity for administrator and tutor fixtures', () => {
    expect(() =>
      readSeedEnvironment({
        ...completeEnvironment,
        SEED_ADMIN_CLERK_USER_ID: 'user_shared',
        SEED_TUTOR_CLERK_USER_ID: ' user_shared ',
      }),
    ).toThrow('Admin and tutor Clerk user IDs must be different');
  });
});
