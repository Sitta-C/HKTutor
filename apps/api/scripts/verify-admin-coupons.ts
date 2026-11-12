import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { configureApplication } from '@app/app.setup';
import { AuthConfigService } from '@config/auth.config';
import {
  BookingStatus,
  CouponReservationStatus,
  PaymentAttemptStatus,
  Role,
} from '@generated/prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { JwtAuthGuard } from '@modules/auth/auth.guard';
import { JwtTokenService } from '@modules/auth/jwt.service';
import { RolesGuard } from '@modules/auth/roles.guard';
import { CouponsController } from '@modules/coupons/coupons.controller';
import { CouponsService } from '@modules/coupons/coupons.service';

import type { INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';

export function disposableAdminCouponDatabaseUrl(env: NodeJS.ProcessEnv): string {
  assert.equal(
    env['HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY'],
    '1',
    'Explicit disposable opt-in required',
  );
  const value = env['DATABASE_URL'];
  assert.ok(value, 'Explicit DATABASE_URL required; this runner never loads .env');
  const url = new URL(value);
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol));
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  assert.match(decodeURIComponent(url.pathname.slice(1)), /^hktutor[_-].*[_-]test$/);
  assert.equal(url.search, '', 'URL options are not accepted');
  assert.equal(url.hash, '', 'URL fragments are not accepted');
  return value;
}

// Retains synthetic append-only evidence. Run only on a NEW disposable database, then discard it.
async function verify(): Promise<void> {
  const databaseUrl = disposableAdminCouponDatabaseUrl(process.env);
  const config = new ConfigService({
    DATABASE_URL: databaseUrl,
    JWT_ACCESS_SECRET: randomBytes(48).toString('hex'),
  });
  const prisma = new PrismaService(config);
  const tokens = new JwtTokenService(new AuthConfigService(config));
  const service = new CouponsService(prisma);
  let app: INestApplication<App> | undefined;
  let passed = 0;
  const pass = (label: string): void => {
    passed += 1;
    process.stdout.write(`PASS [real HTTP + PostgreSQL] ${label}\n`);
  };
  const future = new Date(Date.now() + 30 * 86400000).toISOString();
  const prefix = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
  const actor = randomUUID();
  const URL = '/api/v1/admin/coupons';

  try {
    await prisma.$connect();
    const applied = await prisma.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    for (const entry of await readdir(resolve('prisma/migrations'), { withFileTypes: true })) {
      if (entry.isDirectory()) {
        assert.ok(
          applied.some((row) => row.migration_name === entry.name),
          `Missing migration ${entry.name}`,
        );
      }
    }
    const user = await prisma.user.create({
      data: {
        id: actor,
        email: `coupon-admin-${actor}@example.test`,
        role: Role.ADMIN,
        emailVerifiedAt: new Date(),
      },
    });
    const session = await prisma.authSession.create({
      data: {
        userId: user.id,
        refreshTokenHash: randomBytes(32).toString('hex'),
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    const token = tokens.signAccessToken(actor, session.id, Role.ADMIN);
    const module = await Test.createTestingModule({
      controllers: [CouponsController],
      providers: [
        { provide: CouponsService, useValue: service },
        { provide: PrismaService, useValue: prisma },
        { provide: JwtTokenService, useValue: tokens },
        JwtAuthGuard,
        RolesGuard,
      ],
    }).compile();
    app = module.createNestApplication();
    app.useLogger(false);
    configureApplication(app);
    await app.init();
    const server = app.getHttpServer();
    const body = { code: `${prefix}_RACE`, percent: 10, maxUses: 10, expiresAt: future };
    const responses = await Promise.all([
      request(server).post(URL).auth(token, { type: 'bearer' }).send(body),
      request(server)
        .post(URL)
        .auth(token, { type: 'bearer' })
        .send({ ...body, code: ` ${body.code.toLowerCase()} ` }),
    ]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
    const conflict = responses.find((response) => response.status === 409);
    assert.ok(conflict);
    assert.deepEqual(conflict.body as unknown, {
      statusCode: 409,
      error: 'Conflict',
      code: 'COUPON_CODE_EXISTS',
      message: 'A coupon with this code already exists',
    });
    const coupon = await prisma.coupon.findUniqueOrThrow({ where: { code: body.code } });
    const audits = await prisma.auditLog.findMany({ where: { entityId: coupon.id } });
    assert.equal(audits.length, 1);
    assert.equal(audits[0]?.actorUserId, actor);
    assert.equal(audits[0]?.action, 'coupon.create');
    assert.deepEqual(audits[0]?.afterData, { percent: 10, maxUses: 10, active: true });
    pass('mixed-case concurrent creation: one 201, one 409, one actor-bound safe audit');

    // Force audit insertion failure for this coupon ID, without altering any migration/trigger.
    // A reserved operationKey collides with the trigger after the Coupon INSERT has begun.
    const failedId = randomUUID();
    const failedCode = `${prefix}_ROLLBACK`;
    await prisma.auditLog.create({
      data: {
        action: 'coupon.create',
        entityType: 'Coupon',
        entityId: failedId,
        operationKey: `coupon.create:${failedId}`,
        afterData: { percent: 10, maxUses: 10, active: true },
      },
    });
    await assert.rejects(
      prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('hktutor.audit_actor_user_id', ${actor}, true)`;
        await tx.coupon.create({ data: { id: failedId, ...body, code: failedCode } });
      }),
    );
    assert.equal(await prisma.coupon.count({ where: { id: failedId } }), 0);
    pass('audit trigger failure rolls back the coupon insert');

    // An invalid audit actor causes the actual service transaction to fail its audit FK.
    await assert.rejects(service.create(randomUUID(), { ...body, code: `${prefix}_BAD_ACTOR` }));
    assert.equal(await prisma.coupon.count({ where: { code: `${prefix}_BAD_ACTOR` } }), 0);
    pass('service preserves atomic rollback when actor-bound audit cannot persist');

    const tiedAt = new Date('2026-01-01T00:00:00.000Z');
    const tied = await Promise.all(
      [1, 2, 3].map(async (percent) =>
        prisma.coupon.create({
          data: {
            code: `${prefix}_TIE${percent}`,
            percent,
            maxUses: 1,
            expiresAt: future,
            createdAt: tiedAt,
          },
        }),
      ),
    );
    const expected = [...tied].sort((a, b) => b.id.localeCompare(a.id)).map((row) => row.id);
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let pages = 0; pages < 100; pages += 1) {
      const page = await service.list({ limit: 1, ...(cursor ? { cursor } : {}) });
      for (const item of page.items) {
        if (item.code.startsWith(`${prefix}_TIE`)) seen.push(item.id);
      }
      assert.ok(!page.nextCursor || page.nextCursor !== cursor);
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
      assert.ok(pages < 99, 'Pagination did not end');
    }
    assert.deepEqual(seen, expected);
    pass('equal-time keyset pages preserve descending IDs and reach the end');

    // Build three real claims: one retained RESERVED, one RELEASED and one CONSUMED.
    const tutor = await prisma.user.create({
      data: { email: `${prefix}-tutor@example.test`, role: Role.TUTOR },
    });
    await prisma.tutorProfile.create({
      data: {
        userId: tutor.id,
        displayName: 'Coupon test tutor',
        bio: 'Synthetic test tutor',
        experienceYears: 1,
      },
    });
    const subject = await prisma.subject.create({ data: { code: prefix, name: prefix } });
    const grade = await prisma.gradeLevel.create({
      data: { code: prefix, name: prefix, sortOrder: 1 },
    });
    const listing = await prisma.teachingListing.create({
      data: {
        tutorProfileId: tutor.id,
        subjectId: subject.id,
        gradeLevelId: grade.id,
        pricePerHour: 100,
        description: 'Synthetic coupon API test listing',
      },
    });
    for (let index = 0; index < 3; index += 1) {
      const student = await prisma.user.create({
        data: { email: `${prefix}-s${index}@example.test`, role: Role.STUDENT },
      });
      const start = new Date(Date.now() + (index + 1) * 86400000);
      const slot = await prisma.availabilitySlot.create({
        data: {
          tutorProfileId: tutor.id,
          startAtUtc: start,
          endAtUtc: new Date(start.getTime() + 3600000),
        },
      });
      const booking = await prisma.booking.create({
        data: {
          studentUserId: student.id,
          tutorProfileId: tutor.id,
          listingId: listing.id,
          slotId: slot.id,
          status: BookingStatus.CONFIRMED,
          subtotalAmount: 100,
          discountAmount: 0,
          netAmount: 100,
        },
      });
      const attempt = await prisma.paymentAttempt.create({
        data: {
          bookingId: booking.id,
          amount: 100,
          currency: 'THB',
          status: PaymentAttemptStatus.CREATING,
        },
      });
      const reservation = await prisma.couponReservation.create({
        data: {
          couponId: coupon.id,
          bookingId: booking.id,
          studentUserId: student.id,
          paymentAttemptId: attempt.id,
          discountAmount: 10,
        },
      });
      if (index > 0) {
        const successful = index === 2;
        await prisma.paymentAttempt.update({
          where: { id: attempt.id },
          data: {
            status: successful ? PaymentAttemptStatus.SUCCESSFUL : PaymentAttemptStatus.FAILED,
            chargeId: `chrg_test_${attempt.id.replaceAll('-', '')}`,
            paidAt: successful ? new Date() : null,
          },
        });
        await prisma.couponReservation.update({
          where: { id: reservation.id },
          data: successful
            ? { status: CouponReservationStatus.CONSUMED, consumedAt: new Date() }
            : { status: CouponReservationStatus.RELEASED, releasedAt: new Date() },
        });
      }
      const item = (await service.list({ limit: 50 })).items.find((row) => row.id === coupon.id);
      assert.ok(item);
      assert.deepEqual(
        [item.consumedUses, item.reservedUses, item.availableUses],
        index === 2 ? [1, 1, 8] : [0, 1, 9],
      );
    }
    const page = await service.list({ limit: 50 });
    const response = await request(server)
      .get(URL)
      .query({ limit: 50 })
      .auth(token, { type: 'bearer' })
      .expect(200)
      .expect('Cache-Control', 'no-store');
    assert.deepEqual(response.body as unknown, page);
    assert.ok(!JSON.stringify(response.body as unknown).includes('studentUserId'));
    pass(
      'real reserve/release/consume counts match the safe HTTP response without double-counting',
    );

    const activationUrl = `${URL}/${coupon.id}/activation`;
    const claimsBefore = await prisma.couponReservation.findMany({
      where: { couponId: coupon.id },
      orderBy: { id: 'asc' },
    });
    const usesBefore = await prisma.couponUse.findMany({ where: { couponId: coupon.id } });
    const firstChanges = await Promise.all([
      request(server).patch(activationUrl).auth(token, { type: 'bearer' }).send({ active: false }),
      request(server).patch(activationUrl).auth(token, { type: 'bearer' }).send({ active: false }),
    ]);
    assert.ok(firstChanges.every((item) => item.status === 200));
    assert.equal(
      await prisma.auditLog.count({
        where: { entityId: coupon.id, action: 'coupon.active_change' },
      }),
      1,
    );
    for (const active of [true, true, false]) {
      const result = await request(server)
        .patch(activationUrl)
        .auth(token, { type: 'bearer' })
        .send({ active })
        .expect(200)
        .expect('Cache-Control', 'no-store');
      assert.equal((result.body as { active: boolean }).active, active);
      const data = result.body as {
        consumedUses: number;
        reservedUses: number;
        availableUses: number;
      };
      assert.deepEqual([data.consumedUses, data.reservedUses, data.availableUses], [1, 1, 8]);
    }
    const activationAudits = await prisma.auditLog.findMany({
      where: { entityId: coupon.id, action: 'coupon.active_change' },
      orderBy: { createdAt: 'asc' },
    });
    assert.equal(activationAudits.length, 3);
    assert.ok(
      activationAudits.every(
        (audit) =>
          audit.actorUserId === actor && audit.operationKey === `coupon.active_change:${audit.id}`,
      ),
    );
    assert.deepEqual(
      activationAudits.map((audit) => [audit.beforeData, audit.afterData]),
      [
        [{ active: true }, { active: false }],
        [{ active: false }, { active: true }],
        [{ active: true }, { active: false }],
      ],
    );
    assert.deepEqual(
      await prisma.couponReservation.findMany({
        where: { couponId: coupon.id },
        orderBy: { id: 'asc' },
      }),
      claimsBefore,
    );
    assert.deepEqual(
      await prisma.couponUse.findMany({ where: { couponId: coupon.id } }),
      usesBefore,
    );
    const afterActivation = await prisma.coupon.findUniqueOrThrow({ where: { id: coupon.id } });
    assert.deepEqual(
      [
        afterActivation.code,
        afterActivation.percent,
        afterActivation.maxUses,
        afterActivation.expiresAt,
      ],
      [coupon.code, coupon.percent, coupon.maxUses, coupon.expiresAt],
    );
    pass(
      'activation races/retries write one audit per actual change, preserving pricing, expiry and all usage/reservations',
    );

    await assert.rejects(service.setActivation(randomUUID(), coupon.id, true));
    assert.deepEqual(
      await prisma.coupon.findUniqueOrThrow({ where: { id: coupon.id } }),
      afterActivation,
    );
    assert.equal(
      await prisma.auditLog.count({
        where: { entityId: coupon.id, action: 'coupon.active_change' },
      }),
      3,
    );
    pass('activation audit FK failure rolls back status and timestamp with no partial audit');

    const malformedAuditId = randomUUID();
    await assert.rejects(
      prisma.auditLog.create({
        data: {
          id: malformedAuditId,
          actorUserId: actor,
          action: 'coupon.active_change',
          entityType: 'Coupon',
          entityId: coupon.id,
          operationKey: `coupon.active_change:${malformedAuditId}`,
          beforeData: { active: false },
          afterData: { active: true, secret: 'disallowed' },
        },
      }),
    );
    await assert.rejects(
      prisma.auditLog.update({
        where: { id: activationAudits[0]?.id ?? '' },
        data: { actorUserId: actor },
      }),
    );
    pass('activation audit JSON stays allow-listed and evidence remains append-only');

    await prisma.authSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await request(server).get(URL).auth(token, { type: 'bearer' }).expect(401);
    await request(server)
      .patch(activationUrl)
      .auth(token, { type: 'bearer' })
      .send({ active: true })
      .expect(401);
    pass('revoked persisted session is rejected by the actual JWT guard');
    process.stdout.write(`${passed} admin coupon database checks passed.\n`);
  } finally {
    await app?.close();
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  verify().catch((error: unknown) => {
    if (error instanceof assert.AssertionError) {
      process.stderr.write(`${error.message}\n`);
    }
    process.stderr.write(
      `Admin coupon verification failed (${error instanceof Error ? error.name : 'unknown error'}).\n`,
    );
    process.exitCode = 1;
  });
}
