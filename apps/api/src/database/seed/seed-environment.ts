export interface SeedEnvironment {
  adminEmail: string;
  adminPassword: string;
  tutorEmail: string;
  tutorPassword: string;
  studentEmail: string;
  studentPassword: string;
}

function readRequiredValue(value: string | undefined, errorMessage: string): string {
  const normalized = value?.trim() ?? '';

  if (!normalized || /^\[.*\]$/.test(normalized)) {
    throw new Error(errorMessage);
  }

  return normalized;
}

function readEmail(value: string | undefined, errorMessage: string): string {
  return readRequiredValue(value, errorMessage).toLowerCase();
}

export function readSeedEnvironment(env: NodeJS.ProcessEnv): SeedEnvironment {
  const adminEmail = readEmail(env['SEED_ADMIN_EMAIL'], 'Admin seed environment is incomplete');
  const adminPassword = readRequiredValue(
    env['SEED_ADMIN_PASSWORD'],
    'Admin seed environment is incomplete',
  );
  const tutorEmail = readEmail(env['SEED_TUTOR_EMAIL'], 'Tutor seed environment is incomplete');
  const tutorPassword = readRequiredValue(
    env['SEED_TUTOR_PASSWORD'],
    'Tutor seed environment is incomplete',
  );
  const studentEmail = readEmail(
    env['SEED_STUDENT_EMAIL'],
    'Student seed environment is incomplete',
  );
  const studentPassword = readRequiredValue(
    env['SEED_STUDENT_PASSWORD'],
    'Student seed environment is incomplete',
  );

  if (new Set([adminEmail, tutorEmail, studentEmail]).size !== 3) {
    throw new Error('Admin, tutor, and student seed emails must all be different');
  }

  if (adminPassword.length < 10 || tutorPassword.length < 10 || studentPassword.length < 10) {
    throw new Error('Seed passwords must be at least 10 characters');
  }

  return {
    adminEmail,
    adminPassword,
    tutorEmail,
    tutorPassword,
    studentEmail,
    studentPassword,
  };
}
