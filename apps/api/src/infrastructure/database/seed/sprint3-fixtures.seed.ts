import {
  AccountStatus,
  AttendanceStatus,
  BookingStatus,
  CouponReservationStatus,
  ListingPublicationStatus,
  PaymentAttemptStatus,
  PaymentStatus,
  Role,
  TutorVerificationStatus,
} from '@generated/prisma/client';
import {
  buildSprint3Fixtures,
  SPRINT3_IDS,
  sprint3FixtureId,
} from '@infrastructure/database/seed/sprint3-fixtures';
import { CURRENT_PRIVACY_POLICY_VERSION } from '@modules/auth/auth.constants';
import { refreshLockedTutorReviewRating } from '@modules/reviews/review-ratings';

import type { Prisma } from '@generated/prisma/client';
import type { SeedTransactionClient } from '@infrastructure/database/seed/seed-client';
import type {
  Sprint3ClassFixture,
  Sprint3CouponFixture,
} from '@infrastructure/database/seed/sprint3-fixtures';

const HOUR = 3_600_000;

/** Called inside runSeed's transaction; additive, non-loginable synthetic accounts only. */
export async function seedSprint3Fixtures(client: SeedTransactionClient, now: Date): Promise<void> {
  const fixtures = buildSprint3Fixtures(now);
  const createdAt = new Date(now.getTime() - 400 * 24 * HOUR);
  await client.subject.upsert({
    where: { id: SPRINT3_IDS.subject },
    update: {},
    create: {
      id: SPRINT3_IDS.subject,
      code: 'db04-fixture-subject',
      name: 'Sprint 3 fixture subject',
    },
  });
  await client.gradeLevel.upsert({
    where: { id: SPRINT3_IDS.grade },
    update: {},
    create: {
      id: SPRINT3_IDS.grade,
      code: 'db04-fixture-grade',
      name: 'Sprint 3 fixture grade',
      sortOrder: 99,
    },
  });
  const studentIds = [
    SPRINT3_IDS.student,
    SPRINT3_IDS.otherStudent,
    SPRINT3_IDS.inactiveStudent,
    SPRINT3_IDS.deletedStudent,
    SPRINT3_IDS.raceStudent,
  ];
  const tutorIds = Object.values(SPRINT3_IDS.tutors);
  for (const id of [...studentIds, ...tutorIds]) {
    const email = `${id}@s3db04.hktutor.invalid`;
    const role = tutorIds.some((tutorId) => tutorId === id) ? Role.TUTOR : Role.STUDENT;
    const existing = await client.user.findUnique({
      where: { id },
      select: { email: true, role: true },
    });
    if (existing && (existing.email !== email || existing.role !== role)) {
      throw new Error('Sprint 3 fixture identity collision');
    }
    await client.user.upsert({
      where: { id },
      update: {},
      create: {
        id,
        email,
        role,
        passwordHash: null,
        createdAt,
        updatedAt: createdAt,
        emailVerifiedAt: createdAt,
        consentAcceptedAt: createdAt,
        policyVersion: CURRENT_PRIVACY_POLICY_VERSION,
        accountStatus:
          id === SPRINT3_IDS.inactiveStudent
            ? AccountStatus.SUSPENDED
            : id === SPRINT3_IDS.deletedStudent
              ? AccountStatus.DELETED
              : AccountStatus.ACTIVE,
        deletedAt: id === SPRINT3_IDS.deletedStudent ? createdAt : null,
      },
    });
  }
  for (const [index, [key, userId]] of Object.entries(SPRINT3_IDS.tutors).entries()) {
    await client.tutorProfile.upsert({
      where: { userId },
      update: {},
      create: {
        userId,
        displayName: `DB04 ${key}`,
        bio: 'Synthetic Sprint 3 test fixture.',
        experienceYears: 1,
        verificationStatus: TutorVerificationStatus.VERIFIED,
        createdAt,
        updatedAt: createdAt,
      },
    });
    await client.teachingListing.upsert({
      where: { id: sprint3FixtureId(200 + index) },
      update: {},
      create: {
        id: sprint3FixtureId(200 + index),
        tutorProfileId: userId,
        subjectId: SPRINT3_IDS.subject,
        gradeLevelId: SPRINT3_IDS.grade,
        pricePerHour: '450.00',
        description: `Synthetic DB04 ${key} listing`,
        publicationStatus: ListingPublicationStatus.PUBLISHED,
        publishedAt: createdAt,
        createdAt,
        updatedAt: createdAt,
      },
    });
  }
  for (const coupon of fixtures.coupons) {
    const existing = await client.coupon.findUnique({ where: { id: coupon.id } });
    if (existing && existing.code !== coupon.code) {
      throw new Error('Sprint 3 fixture coupon ID collision');
    }
    await client.coupon.upsert({
      where: { id: coupon.id },
      update: {},
      create: {
        id: coupon.id,
        code: coupon.code,
        percent: coupon.percent,
        maxUses: coupon.maxUses,
        active: coupon.active,
        expiresAt: coupon.expiresAt,
        createdAt,
        updatedAt: createdAt,
      },
    });
  }
  const changedTutors = new Set<string>();
  for (const fixture of fixtures.classes) {
    const existing = await client.booking.findUnique({ where: { id: fixture.id } });
    if (existing) {
      if (
        existing.studentUserId !== fixture.studentId ||
        existing.tutorProfileId !== fixture.tutorId
      ) {
        throw new Error('Sprint 3 fixture booking ID collision');
      }
      // Preserve all live changes, including moved slots, reviews and terminal payment evidence.
      continue;
    }
    const coupon = fixture.couponKey
      ? fixtures.coupons.find((row) => row.key === fixture.couponKey)
      : undefined;
    await seedClass(client, fixture, coupon);
    if (fixture.scores) {
      changedTutors.add(fixture.tutorId);
    }
  }
  for (const tutorId of changedTutors) {
    await client.$queryRaw`SELECT "userId" FROM "TutorProfile" WHERE "userId" = ${tutorId}::uuid FOR UPDATE`;
    // The enclosing seed transaction supplies a full Prisma client at runtime.
    await refreshLockedTutorReviewRating(client as Prisma.TransactionClient, tutorId);
  }
}

async function seedClass(
  client: SeedTransactionClient,
  fixture: Sprint3ClassFixture,
  coupon: Sprint3CouponFixture | undefined,
): Promise<void> {
  const createdAt = new Date(fixture.startAtUtc.getTime() - 2 * 24 * HOUR);
  const paidAt = new Date(createdAt.getTime() + HOUR);
  const tutorIndex = Object.values(SPRINT3_IDS.tutors).findIndex((id) => id === fixture.tutorId);
  const couponSnapshot = coupon
    ? {
        appliedCouponId: coupon.id,
        appliedCouponCode: coupon.code,
        appliedCouponPercent: coupon.percent,
      }
    : {};
  const oldSlotId = sprint3FixtureId(9000);
  if (fixture.key === 'rescheduled') {
    await client.availabilitySlot.create({
      data: {
        id: oldSlotId,
        tutorProfileId: fixture.tutorId,
        startAtUtc: new Date(fixture.startAtUtc.getTime() - 24 * HOUR),
        endAtUtc: new Date(fixture.startAtUtc.getTime() - 23 * HOUR),
        createdAt,
      },
    });
  }
  await client.availabilitySlot.create({
    data: {
      id: fixture.slotId,
      tutorProfileId: fixture.tutorId,
      startAtUtc: fixture.startAtUtc,
      endAtUtc: new Date(fixture.startAtUtc.getTime() + HOUR),
      createdAt,
    },
  });
  await client.booking.create({
    data: {
      id: fixture.id,
      studentUserId: fixture.studentId,
      tutorProfileId: fixture.tutorId,
      listingId: sprint3FixtureId(200 + tutorIndex),
      slotId: fixture.key === 'rescheduled' ? oldSlotId : fixture.slotId,
      status: fixture.status,
      subtotalAmount: fixture.subtotal,
      discountAmount: fixture.discount,
      netAmount: fixture.net,
      ...couponSnapshot,
      currency: 'THB',
      createdAt,
      updatedAt: createdAt,
      ...(fixture.status === BookingStatus.CANCELED
        ? {
            canceledAt: createdAt,
            canceledById: fixture.studentId,
            cancellationReason: 'Synthetic DB04 cancellation',
          }
        : {}),
      ...(fixture.status === BookingStatus.COMPLETED
        ? {
            attendance: AttendanceStatus.ATTENDED,
            attendanceMarkedAt: new Date(fixture.startAtUtc.getTime() + 2 * HOUR),
          }
        : {}),
    },
  });
  if (fixture.attemptStatus) {
    await client.paymentAttempt.create({
      data: {
        id: fixture.attemptId,
        bookingId: fixture.id,
        amount: fixture.net,
        currency: 'THB',
        ...couponSnapshot,
        status: fixture.attemptStatus,
        // Synthetic provider stub evidence, never sent to or returned by live Omise.
        chargeId:
          fixture.attemptStatus === PaymentAttemptStatus.CREATING
            ? null
            : `chrg_test_DB04${fixture.attemptId.slice(-12)}`,
        paidAt: fixture.attemptStatus === PaymentAttemptStatus.SUCCESSFUL ? paidAt : null,
        expiresAt:
          fixture.attemptStatus === PaymentAttemptStatus.EXPIRED
            ? paidAt
            : new Date(createdAt.getTime() + 2 * HOUR),
        failureCode:
          fixture.attemptStatus === PaymentAttemptStatus.CREATING
            ? 'PROVIDER_RESULT_UNKNOWN'
            : null,
        createdAt,
        updatedAt: createdAt,
      },
    });
  }
  if (fixture.reservationStatus) {
    if (!coupon) {
      throw new Error('Reservation fixture requires a coupon');
    }
    await client.couponReservation.create({
      data: {
        id: fixture.reservationId,
        couponId: coupon.id,
        bookingId: fixture.id,
        studentUserId: fixture.studentId,
        paymentAttemptId: fixture.attemptStatus ? fixture.attemptId : null,
        discountAmount: fixture.discount,
        status:
          fixture.net === '0.00'
            ? CouponReservationStatus.CONSUMED
            : CouponReservationStatus.RESERVED,
        consumedAt: fixture.net === '0.00' ? paidAt : null,
        createdAt,
      },
    });
    if (fixture.net !== '0.00' && fixture.reservationStatus !== CouponReservationStatus.RESERVED) {
      await client.couponReservation.update({
        where: { id: fixture.reservationId },
        data: {
          status: fixture.reservationStatus,
          ...(fixture.reservationStatus === CouponReservationStatus.CONSUMED
            ? { consumedAt: paidAt }
            : { releasedAt: paidAt }),
        },
      });
    }
  }
  if (fixture.paid) {
    await client.booking.update({
      where: { id: fixture.id },
      data: {
        paymentStatus: PaymentStatus.PAID,
        paidAt,
        ...(coupon
          ? {
              paymentReference:
                fixture.net === '0.00'
                  ? `coupon:${fixture.reservationId}`
                  : `chrg_test_DB04${fixture.attemptId.slice(-12)}`,
            }
          : { mockReference: `DEMO-DB04-${fixture.id}` }),
      },
    });
  } else if (
    fixture.attemptStatus === PaymentAttemptStatus.PENDING ||
    fixture.attemptStatus === PaymentAttemptStatus.CREATING
  ) {
    await client.booking.update({ where: { id: fixture.id }, data: { paymentPending: true } });
  }
  if (fixture.key === 'rescheduled') {
    await client.notification.create({
      data: {
        id: sprint3FixtureId(9002),
        userId: fixture.studentId,
        bookingId: fixture.id,
        eventType: 'CLASS_REMINDER_1H',
        eventKey: `reminder:${fixture.id}:${oldSlotId}:${new Date(fixture.startAtUtc.getTime() - 24 * HOUR).toISOString()}:1H:CLASS`,
        title: 'Synthetic reminder for the old occurrence',
        body: 'The booking was subsequently rescheduled.',
        createdAt,
      },
    });
    const requestId = sprint3FixtureId(9001);
    await client.rescheduleRequest.create({
      data: {
        id: requestId,
        bookingId: fixture.id,
        requestedById: fixture.studentId,
        fromSlotId: oldSlotId,
        requestedSlotId: fixture.slotId,
        reason: 'Synthetic DB04 reschedule',
        requestedAt: createdAt,
      },
    });
    await client.booking.update({ where: { id: fixture.id }, data: { slotId: fixture.slotId } });
    await client.rescheduleRequest.update({
      where: { id: requestId },
      data: {
        status: 'APPROVED',
        reviewedById: fixture.tutorId,
        decidedAt: paidAt,
      },
    });
  }
  if (fixture.scores) {
    await client.$queryRaw`SELECT "userId" FROM "TutorProfile" WHERE "userId" = ${fixture.tutorId}::uuid FOR UPDATE`;
    const [clarity, punctuality, preparation] = fixture.scores;
    await client.review.create({
      data: {
        id: fixture.reviewId,
        bookingId: fixture.id,
        authorStudentUserId: fixture.studentId,
        tutorProfileId: fixture.tutorId,
        bookingStatus: BookingStatus.COMPLETED,
        clarity,
        punctuality,
        preparation,
        feedback: `Synthetic DB04 feedback: ${fixture.key}`,
        createdAt: new Date(fixture.startAtUtc.getTime() + 3 * HOUR),
      },
    });
  }
}
