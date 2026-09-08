import { readSeedEnvironment } from '@/database/seed/seed-environment';

const completeEnvironment = {
  SEED_ADMIN_EMAIL: ' Admin@Example.com ',
  SEED_ADMIN_PASSWORD: 'admin-pass-123',
  SEED_TUTOR_EMAIL: ' Tutor@Example.com ',
  SEED_TUTOR_PASSWORD: 'tutor-pass-123',
};

describe('readSeedEnvironment', () => {
  it('normalizes emails and reads local demo credentials', () => {
    expect(readSeedEnvironment(completeEnvironment)).toEqual({
      adminEmail: 'admin@example.com',
      adminPassword: 'admin-pass-123',
      tutorEmail: 'tutor@example.com',
      tutorPassword: 'tutor-pass-123',
    });
  });

  it('rejects placeholder or missing credentials', () => {
    expect(() =>
      readSeedEnvironment({ ...completeEnvironment, SEED_ADMIN_PASSWORD: '[ADMIN_PASSWORD]' }),
    ).toThrow('Admin seed environment is incomplete');
    expect(() =>
      readSeedEnvironment({ ...completeEnvironment, SEED_TUTOR_EMAIL: undefined }),
    ).toThrow('Tutor seed environment is incomplete');
  });

  it('rejects short passwords', () => {
    expect(() =>
      readSeedEnvironment({ ...completeEnvironment, SEED_TUTOR_PASSWORD: 'short' }),
    ).toThrow('Seed passwords must be at least 10 characters');
  });

  it('rejects duplicate emails case-insensitively', () => {
    expect(() =>
      readSeedEnvironment({ ...completeEnvironment, SEED_TUTOR_EMAIL: 'ADMIN@example.com' }),
    ).toThrow('Admin and tutor seed emails must be different');
  });
});
