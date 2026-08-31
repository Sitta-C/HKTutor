import { readSeedEnvironment } from '@/database/seed/seed-environment';

const completeEnvironment = {
  SEED_ADMIN_EMAIL: ' Admin@Example.com ',
  SEED_ADMIN_PASSWORD: 'AdminPass',
  SEED_TUTOR_EMAIL: ' Tutor@Example.com ',
  SEED_TUTOR_PASSWORD: 'TutorPass',
};

describe('readSeedEnvironment', () => {
  it('normalizes seed emails while preserving password bytes', () => {
    expect(readSeedEnvironment(completeEnvironment)).toEqual({
      adminEmail: 'admin@example.com',
      adminPassword: 'AdminPass',
      tutorEmail: 'tutor@example.com',
      tutorPassword: 'TutorPass',
    });
  });

  it.each([undefined, '', '   ', '[ADMIN_EMAIL]', '[ADMIN_PASSWORD]'])(
    'rejects incomplete administrator seed value %p',
    (value) => {
      const environment = { ...completeEnvironment };

      if (value === undefined) {
        delete environment.SEED_ADMIN_EMAIL;
      } else if (value === '[ADMIN_PASSWORD]') {
        environment.SEED_ADMIN_PASSWORD = value;
      } else {
        environment.SEED_ADMIN_EMAIL = value;
      }

      expect(() => readSeedEnvironment(environment)).toThrow(
        'Admin seed environment is incomplete',
      );
    },
  );

  it.each([undefined, '', '   ', '[TUTOR_EMAIL]', '[TUTOR_PASSWORD]'])(
    'rejects incomplete tutor seed value %p',
    (value) => {
      const environment = { ...completeEnvironment };

      if (value === undefined) {
        delete environment.SEED_TUTOR_EMAIL;
      } else if (value === '[TUTOR_PASSWORD]') {
        environment.SEED_TUTOR_PASSWORD = value;
      } else {
        environment.SEED_TUTOR_EMAIL = value;
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
});
