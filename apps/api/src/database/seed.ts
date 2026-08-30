import { argon2id, hash } from 'argon2';

import { AccountStatus, Role } from '@/generated/prisma/client';

interface SeedUserDelegate {
  upsert(args: {
    create: {
      accountStatus: AccountStatus;
      email: string;
      passwordHash: string;
      role: Role;
    };
    select: { role: true };
    update: Record<string, never>;
    where: { email: string };
  }): Promise<{ role: Role }>;
}

export interface SeedDatabaseClient {
  $queryRawUnsafe<T = unknown>(query: string): Promise<T>;
  user: SeedUserDelegate;
}

export async function runSeed(client: SeedDatabaseClient): Promise<void> {
  const email = process.env['SEED_ADMIN_EMAIL']?.trim().toLowerCase() ?? '';
  const password = process.env['SEED_ADMIN_PASSWORD'] ?? '';

  if (
    !email ||
    email === '[admin_email]' ||
    password.trim() === '' ||
    password === '[ADMIN_PASSWORD]'
  ) {
    throw new Error('Admin seed environment is incomplete');
  }

  await client.$queryRawUnsafe('SELECT 1 AS connected');

  const passwordHash = await hash(password, {
    type: argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
  const admin = await client.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      passwordHash,
      role: Role.ADMIN,
      accountStatus: AccountStatus.ACTIVE,
    },
    select: { role: true },
  });

  if (admin.role !== Role.ADMIN) {
    throw new Error('Admin seed email belongs to a non-admin account');
  }
}
