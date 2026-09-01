export interface SeedEnvironment {
  adminClerkUserId: string;
  adminEmail: string;
  tutorClerkUserId: string;
  tutorEmail: string;
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
  const adminClerkUserId = readRequiredValue(
    env['SEED_ADMIN_CLERK_USER_ID'],
    'Admin seed environment is incomplete',
  );
  const adminEmail = readEmail(env['SEED_ADMIN_EMAIL'], 'Admin seed environment is incomplete');
  const tutorClerkUserId = readRequiredValue(
    env['SEED_TUTOR_CLERK_USER_ID'],
    'Tutor seed environment is incomplete',
  );
  const tutorEmail = readEmail(env['SEED_TUTOR_EMAIL'], 'Tutor seed environment is incomplete');

  if (adminEmail === tutorEmail) {
    throw new Error('Admin and tutor seed emails must be different');
  }

  if (adminClerkUserId === tutorClerkUserId) {
    throw new Error('Admin and tutor Clerk user IDs must be different');
  }

  return {
    adminClerkUserId,
    adminEmail,
    tutorClerkUserId,
    tutorEmail,
  };
}
