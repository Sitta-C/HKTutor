export interface SeedEnvironment {
  adminEmail: string;
  adminPassword: string;
  tutorEmail: string;
  tutorPassword: string;
}

function readEmail(value: string | undefined, errorMessage: string): string {
  const email = value?.trim().toLowerCase() ?? '';

  if (!email || /^\[.*\]$/.test(email)) {
    throw new Error(errorMessage);
  }

  return email;
}

function readPassword(value: string | undefined, errorMessage: string): string {
  if (!value || value.trim() === '' || /^\[.*\]$/.test(value.trim())) {
    throw new Error(errorMessage);
  }

  return value;
}

export function readSeedEnvironment(env: NodeJS.ProcessEnv): SeedEnvironment {
  const adminEmail = readEmail(env['SEED_ADMIN_EMAIL'], 'Admin seed environment is incomplete');
  const adminPassword = readPassword(
    env['SEED_ADMIN_PASSWORD'],
    'Admin seed environment is incomplete',
  );
  const tutorEmail = readEmail(env['SEED_TUTOR_EMAIL'], 'Tutor seed environment is incomplete');
  const tutorPassword = readPassword(
    env['SEED_TUTOR_PASSWORD'],
    'Tutor seed environment is incomplete',
  );

  if (adminEmail === tutorEmail) {
    throw new Error('Admin and tutor seed emails must be different');
  }

  return {
    adminEmail,
    adminPassword,
    tutorEmail,
    tutorPassword,
  };
}
