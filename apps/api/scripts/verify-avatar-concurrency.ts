import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';

import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import 'reflect-metadata';
import sharp from 'sharp';

import { StorageConfigService } from '@config/storage.config';
import { Role, StorageObjectPurpose } from '@generated/prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { StorageCleanupService } from '@infrastructure/storage/storage-cleanup.service';
import { StorageService } from '@infrastructure/storage/storage.service';
import { CURRENT_PRIVACY_POLICY_VERSION } from '@modules/auth/auth.constants';
import { AvatarsService } from '@modules/avatars/avatars.service';

import type { AuthenticatedUser } from '@modules/auth/auth.guard';
import type {} from 'multer';

const databaseUrl = process.env['DATABASE_URL'];
assert.ok(databaseUrl, 'DATABASE_URL is required');
assert.equal(
  process.env['HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY'],
  '1',
  'Explicit disposable database opt-in is required',
);
const parsed = new URL(databaseUrl);
assert.ok(
  ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(parsed.hostname),
  'Verification refuses remote databases',
);
assert.match(
  decodeURIComponent(parsed.pathname.slice(1)),
  /^hktutor[-_].*[-_]test$/,
  'Use a disposable hktutor_*_test database',
);

const prisma = new PrismaService(new ConfigService({ DATABASE_URL: databaseUrl }));
const objects = new Set<string>();
let deletionUnavailable = false;
let ambiguousUpload = false;
const config = new StorageConfigService(
  new ConfigService({
    SUPABASE_URL: 'https://storage.example.test',
    SUPABASE_SECRET_KEY: 'sb_secret_test_only',
    SUPABASE_AVATAR_BUCKET: 'test-avatars',
    SUPABASE_DOCUMENT_BUCKET: 'test-documents',
  }),
);
const storage = new StorageService(
  config,
  createClient<Record<string, never>>(config.values.url, config.values.secretKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: {
      fetch: (input, init) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        let body: unknown = { public: false };
        if (init?.method === 'DELETE') {
          if (deletionUnavailable) {
            throw new Error('Simulated Storage outage');
          }
          assert.ok(typeof init.body === 'string');
          const decoded: unknown = JSON.parse(init.body);
          assert.ok(
            decoded &&
              typeof decoded === 'object' &&
              'prefixes' in decoded &&
              Array.isArray(decoded.prefixes),
          );
          for (const path of decoded.prefixes) {
            assert.equal(typeof path, 'string');
            if (typeof path === 'string') {
              objects.delete(path);
            }
          }
          body = [];
        } else if (init?.method === 'POST') {
          const path = new URL(url).pathname.split('/object/test-avatars/')[1];
          assert.ok(path);
          objects.add(path);
          if (ambiguousUpload) {
            throw new Error('Simulated lost upload acknowledgement');
          }
          body = { Key: path, Id: randomUUID() };
        }
        return Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      },
    },
  }),
);
const cleanup = new StorageCleanupService(prisma, storage);
const avatars = new AvatarsService(prisma, storage, cleanup);
const ownerIds: string[] = [];

async function assertCurrentFileOnly(userId: string): Promise<string | null> {
  await cleanup.recoverPending();
  await cleanup.recoverPending();
  const current = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { avatarObjectPath: true },
  });
  assert.deepEqual(
    [...objects].filter((path) => path.startsWith(`${userId}/`)),
    current.avatarObjectPath ? [current.avatarObjectPath] : [],
  );
  return current.avatarObjectPath;
}

async function main(): Promise<void> {
  await prisma.$connect();
  try {
    const buffer = await sharp({
      create: { width: 32, height: 32, channels: 3, background: '#4385aa' },
    })
      .png()
      .toBuffer();
    const file: Express.Multer.File = {
      buffer,
      mimetype: 'image/png',
      fieldname: 'file',
      originalname: 'avatar.png',
      encoding: '7bit',
      size: buffer.length,
      destination: '',
      filename: '',
      path: '',
      stream: Readable.from(buffer),
    };
    for (const role of [Role.STUDENT, Role.TUTOR]) {
      const id = randomUUID();
      ownerIds.push(id);
      await prisma.user.create({
        data: {
          id,
          email: `avatar-${id}@example.test`,
          role,
          consentAcceptedAt: new Date(),
          policyVersion: CURRENT_PRIVACY_POLICY_VERSION,
        },
      });
      const user: AuthenticatedUser = {
        id,
        email: `avatar-${id}@example.test`,
        role,
        sessionId: randomUUID(),
      };
      assert.deepEqual(await avatars.getMine(user), { avatar: null });

      // Concurrent first uploads and replacements serialize on the owner row.
      await Promise.all([avatars.upload(user, file), avatars.upload(user, file)]);
      const initialPath = await assertCurrentFileOnly(id);
      assert.ok(initialPath);
      await Promise.all([avatars.upload(user, file), avatars.remove(user)]);
      await assertCurrentFileOnly(id);
      await avatars.upload(user, file);
      const activePath = await assertCurrentFileOnly(id);
      assert.ok(activePath);

      await assert.rejects(prisma.user.update({ where: { id }, data: { avatarSizeBytes: null } }));
      await assert.rejects(
        prisma.user.update({ where: { id }, data: { avatarMimeType: 'image/jpeg' } }),
      );
      await assert.rejects(
        prisma.user.update({ where: { id }, data: { avatarSizeBytes: 2097153 } }),
      );
      await assert.rejects(
        prisma.user.update({
          where: { id },
          data: { avatarObjectPath: `${randomUUID()}/${randomUUID()}.webp` },
        }),
      );

      // Recovery must preserve a committed reference even if an intent remains.
      await prisma.storageCleanupIntent.create({
        data: {
          purpose: StorageObjectPurpose.AVATAR,
          objectPath: activePath,
          nextAttemptAt: new Date(0),
        },
      });
      await assertCurrentFileOnly(id);

      ambiguousUpload = true;
      await assert.rejects(avatars.upload(user, file), ServiceUnavailableException);
      ambiguousUpload = false;
      assert.equal(
        (await prisma.user.findUniqueOrThrow({ where: { id } })).avatarObjectPath,
        activePath,
      );
      await prisma.storageCleanupIntent.updateMany({
        where: {
          purpose: StorageObjectPurpose.AVATAR,
          objectPath: { startsWith: `${id}/` },
        },
        data: { nextAttemptAt: new Date(0) },
      });
      await assertCurrentFileOnly(id);

      deletionUnavailable = true;
      await avatars.upload(user, file);
      await cleanup.recoverPending();
      assert.ok(
        await prisma.storageCleanupIntent.findUnique({
          where: {
            purpose_objectPath: {
              purpose: StorageObjectPurpose.AVATAR,
              objectPath: activePath,
            },
          },
        }),
      );
      deletionUnavailable = false;
      await prisma.storageCleanupIntent.updateMany({
        where: {
          purpose: StorageObjectPurpose.AVATAR,
          objectPath: { startsWith: `${id}/` },
        },
        data: { nextAttemptAt: new Date(0) },
      });
      await assertCurrentFileOnly(id);
      await Promise.all([avatars.remove(user), avatars.remove(user)]);
      assert.equal(await assertCurrentFileOnly(id), null);
    }
    new Logger('AvatarVerification').log(
      'Passed real PostgreSQL avatar constraints, concurrent replacement/deletion, ambiguous upload, and recovery checks with a simulated Storage transport',
    );
  } finally {
    deletionUnavailable = false;
    ambiguousUpload = false;
    await cleanup.recoverPending();
    await prisma.storageCleanupIntent.deleteMany({
      where: {
        purpose: StorageObjectPurpose.AVATAR,
        OR: ownerIds.map((id) => ({ objectPath: { startsWith: `${id}/` } })),
      },
    });
    await prisma.user.deleteMany({ where: { id: { in: ownerIds } } });
    await prisma.$disconnect();
  }
}

void main().catch(() => {
  new Logger('AvatarVerification').error('Avatar database verification failed; details omitted');
  process.exitCode = 1;
});
