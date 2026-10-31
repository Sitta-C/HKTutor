import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { ConfigService } from '@nestjs/config';

import { Role, TutorVerificationStatus } from '@generated/prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { CURRENT_PRIVACY_POLICY_VERSION } from '@modules/auth/auth.constants';
import { PasswordService } from '@modules/auth/password.service';

const databaseUrl = process.env['DATABASE_URL'];
assert.ok(databaseUrl, 'DATABASE_URL is required');
assert.equal(
  process.env['HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY'],
  '1',
  'Disposable DB opt-in required',
);
const database = new URL(databaseUrl);
assert.ok(['postgres:', 'postgresql:'].includes(database.protocol));
assert.ok(
  ['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname),
  'Local database required',
);
assert.match(database.pathname, /^\/hktutor[-_].*[-_]test$/, 'Disposable hktutor_*_test required');
assert.equal(database.search, '');
assert.equal(database.hash, '');

const users = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Browser Student',
    role: Role.STUDENT,
    email: 'student@s3-chat.invalid',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Browser Tutor',
    role: Role.TUTOR,
    email: 'tutor@s3-chat.invalid',
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Second Tutor',
    role: Role.TUTOR,
    email: 'second@s3-chat.invalid',
  },
  {
    id: '44444444-4444-4444-8444-444444444444',
    name: 'Other Student',
    role: Role.STUDENT,
    email: 'other@s3-chat.invalid',
  },
] as const;
const pairs = [
  {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    studentUserId: users[0].id,
    tutorUserId: users[1].id,
  },
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    studentUserId: users[0].id,
    tutorUserId: users[2].id,
  },
  {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    studentUserId: users[3].id,
    tutorUserId: users[1].id,
  },
];

async function main(): Promise<void> {
  const prisma = new PrismaService(new ConfigService({ DATABASE_URL: databaseUrl }));
  try {
    const passwordHash = await new PasswordService().hash('Chat-fixture-Only-2026!');
    for (const fixture of users) {
      await prisma.user.upsert({
        where: { id: fixture.id },
        create: {
          id: fixture.id,
          email: fixture.email,
          role: fixture.role,
          passwordHash,
          emailVerifiedAt: new Date(),
          consentAcceptedAt: new Date(),
          policyVersion: CURRENT_PRIVACY_POLICY_VERSION,
        },
        update: {
          passwordHash,
          emailVerifiedAt: new Date(),
          consentAcceptedAt: new Date(),
          policyVersion: CURRENT_PRIVACY_POLICY_VERSION,
        },
      });
      if (fixture.role === Role.STUDENT) {
        await prisma.studentProfile.upsert({
          where: { userId: fixture.id },
          create: {
            userId: fixture.id,
            firstName: 'Synthetic',
            lastName: 'Fixture',
            nickname: fixture.name,
            school: 'Test school',
            gradeLevel: '10',
            phone: '0000000000',
          },
          update: {},
        });
      } else {
        await prisma.tutorProfile.upsert({
          where: { userId: fixture.id },
          create: {
            userId: fixture.id,
            firstName: 'Synthetic',
            lastName: 'Fixture',
            nickname: fixture.name,
            displayName: fixture.name,
            bio: 'Synthetic browser fixture',
            experienceYears: 1,
            verificationStatus: TutorVerificationStatus.VERIFIED,
          },
          update: {},
        });
      }
    }
    await prisma.authSession.deleteMany({
      where: { userId: { in: users.map((user) => user.id) } },
    });
    await prisma.message.deleteMany({
      where: { conversationId: { in: pairs.map((pair) => pair.id) } },
    });
    for (const pair of pairs) {
      await prisma.conversation.upsert({ where: { id: pair.id }, create: pair, update: {} });
      await prisma.message.create({
        data: {
          conversationId: pair.id,
          senderUserId: pair.tutorUserId,
          clientMessageId: randomUUID(),
          text: 'Browser fixture ready',
          sentAt: new Date(Date.now() - 60_000),
        },
      });
    }
    process.stdout.write('Prepared synthetic chat fixtures in the disposable database.\n');
  } finally {
    await prisma.$disconnect();
  }
}

void main();
