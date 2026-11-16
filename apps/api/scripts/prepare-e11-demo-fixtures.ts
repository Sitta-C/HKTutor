import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

import { ConfigService } from '@nestjs/config';

import { Prisma, Role } from '@generated/prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { CURRENT_PRIVACY_POLICY_VERSION } from '@modules/auth/auth.constants';
import { PasswordService } from '@modules/auth/password.service';

function requiredEnvironment(key: string): string {
  const value = process.env[key];
  assert.ok(value, 'Run pnpm test:demo:playwright to load the development environment');
  return value;
}

const databaseUrl = requiredEnvironment('DATABASE_URL');
const configured = parseEnv(readFileSync(resolve(__dirname, '../../../.env'), 'utf8'));
assert.ok(
  databaseUrl && databaseUrl === configured['DATABASE_URL'],
  'Use the development target from the root .env',
);
assert.equal(
  process.env['HKTUTOR_E11_DEMO_TARGET'],
  'development',
  'Run pnpm test:demo:playwright',
);
const runId = requiredEnvironment('HKTUTOR_E11_DEMO_RUN_ID');
const password = requiredEnvironment('HKTUTOR_E11_DEMO_PASSWORD');
const tokenSecret = requiredEnvironment('HKTUTOR_E11_DEMO_TOKEN_SECRET');
assert.ok(
  runId && /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/.test(runId),
  'A unique E11 run ID is required',
);
assert.ok(password && password.length >= 32, 'A generated E11 password is required');
assert.ok(tokenSecret && tokenSecret.length >= 43, 'A generated E11 token secret is required');

function email(label: string): string {
  return `${label}+${runId}@e11-demo.invalid`;
}

const users = [
  { suffix: '1', email: email('student'), role: Role.STUDENT },
  { suffix: '2', email: email('onboarding'), role: Role.STUDENT },
  { suffix: '3', email: email('consent'), role: Role.STUDENT },
  { suffix: '4', email: email('tutor'), role: Role.TUTOR },
  { suffix: '5', email: email('other-tutor'), role: Role.TUTOR },
  { suffix: '6', email: email('expired'), role: Role.STUDENT },
  { suffix: '7', email: email('consumed'), role: Role.STUDENT },
] as const;

function userId(suffix: string): string {
  return `${runId.slice(0, 24)}${suffix.padStart(12, '0')}`;
}

async function cleanup(prisma: PrismaService): Promise<void> {
  const ids = users.map((fixture) => userId(fixture.suffix));
  const expectedEmails = new Map(users.map((fixture) => [userId(fixture.suffix), fixture.email]));
  await prisma.$transaction(
    async (tx) => {
      const existing = await tx.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, email: true },
      });
      assert.ok(
        existing.every((user) => expectedEmails.get(user.id) === user.email),
        'Refusing to clean records outside this E11 run',
      );
      await tx.teachingListing.deleteMany({
        where: { id: { in: [userId('104'), userId('105')] }, tutorProfileId: { in: ids } },
      });
      await tx.studentProfile.deleteMany({ where: { userId: { in: ids } } });
      await tx.tutorProfile.deleteMany({ where: { userId: { in: ids } } });
      await tx.user.deleteMany({
        where: { id: { in: ids }, email: { in: users.map((fixture) => fixture.email) } },
      });
      await tx.subject.deleteMany({ where: { id: userId('201'), code: `E11-${runId}-MATH` } });
      await tx.gradeLevel.deleteMany({ where: { id: userId('202'), code: `E11-${runId}-G10` } });
    },
    { timeout: 30_000 },
  );
  process.stdout.write('Removed only the temporary fixtures from this E11 run.\n');
}

async function main(): Promise<void> {
  const prisma = new PrismaService(new ConfigService({ DATABASE_URL: databaseUrl }));
  try {
    if (process.argv.includes('--cleanup')) {
      await cleanup(prisma);
      return;
    }
    const now = new Date();
    const passwordHash = await new PasswordService().hash(password);
    await prisma.$transaction(
      async (tx) => {
        for (const fixture of users) {
          const data = {
            email: fixture.email,
            role: fixture.role,
            passwordHash,
            emailVerifiedAt: ['2', '6', '7'].includes(fixture.suffix) ? null : now,
            consentAcceptedAt: now,
            policyVersion: fixture.suffix === '3' ? '2020-01-01' : CURRENT_PRIVACY_POLICY_VERSION,
          };
          await tx.user.create({ data: { id: userId(fixture.suffix), ...data } });
          if (fixture.role === Role.TUTOR) {
            const profile = {
              firstName: 'Synthetic',
              lastName: 'Tutor',
              nickname: `Tutor ${fixture.suffix}`,
              displayName: `E11 Tutor ${fixture.suffix}`,
              bio: 'Synthetic project demonstration tutor',
              experienceYears: 1,
            };
            await tx.tutorProfile.create({ data: { userId: userId(fixture.suffix), ...profile } });
          }
        }
        await tx.studentProfile.create({
          data: {
            userId: userId('1'),
            firstName: 'Synthetic',
            lastName: 'Student',
            nickname: 'Demo',
            school: 'E11 Demonstration School',
            gradeLevel: 'Grade 10',
            phone: '0800000000',
          },
        });
        for (const [suffix, label] of [
          ['2', 'onboarding'],
          ['4', 'tutor'],
          ['5', 'other-tutor'],
          ['6', 'expired'],
          ['7', 'consumed'],
        ]) {
          assert.ok(suffix && label);
          await tx.emailVerificationToken.create({
            data: {
              userId: userId(suffix),
              tokenHash: createHash('sha256').update(`${tokenSecret}-${label}`).digest('hex'),
              expiresAt: new Date(now.getTime() + (suffix === '6' ? -60_000 : 60 * 60 * 1000)),
              consumedAt: suffix === '7' ? now : null,
            },
          });
        }
        const subject = await tx.subject.create({
          data: {
            id: userId('201'),
            code: `E11-${runId}-MATH`,
            name: `E11 Mathematics ${runId}`,
            active: false,
          },
        });
        const grade = await tx.gradeLevel.create({
          data: {
            id: userId('202'),
            code: `E11-${runId}-G10`,
            name: `E11 Grade 10 ${runId}`,
            sortOrder: 10,
            active: false,
          },
        });
        for (const suffix of ['4', '5']) {
          const data = {
            tutorProfileId: userId(suffix),
            subjectId: subject.id,
            gradeLevelId: grade.id,
            pricePerHour: new Prisma.Decimal('450.00'),
            description: `E11 owner-only teaching listing ${suffix}`,
          };
          await tx.teachingListing.create({ data: { id: userId(`10${suffix}`), ...data } });
        }
      },
      { timeout: 30_000 },
    );
    process.stdout.write('Prepared temporary E11 fixtures in the development database.\n');
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch(() => {
  process.stderr.write(
    'E11 fixture operation failed; check development database access and schema.\n',
  );
  process.exitCode = 1;
});
