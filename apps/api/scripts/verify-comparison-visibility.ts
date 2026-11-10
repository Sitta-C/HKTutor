import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  AccountStatus,
  BookingStatus,
  ListingPublicationStatus,
  Role,
  TutorVerificationStatus,
} from '@generated/prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { TutorAvailabilityService } from '@modules/tutors/tutor-availability.service';
import { TutorDirectoryService } from '@modules/tutors/tutor-directory.service';
import { MAX_TUTOR_SEARCH_PAGE_SIZE } from '@modules/tutors/tutors.dto';

/**
 * S3-T32: the tutor comparison (S3-T30/T31) reads only GET /tutors/:id and
 * GET /tutors/:id/availability. This proves on real PostgreSQL what those two public reads return
 * for the card's fixtures: allow-listed public fields only, the selected listing's own price and
 * subject, real null/0/no-slot values, and 404 or a missing listing once a selected tutor or
 * listing stops being public. Search parity is checked against the same rows.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DETAIL_TUTOR_KEYS = [
  'avatarUpdatedAt',
  'bio',
  'displayName',
  'experienceYears',
  'ratingAverage',
  'reviewCount',
  'tutorId',
  'verificationStatus',
];
const DETAIL_LISTING_KEYS = ['description', 'grade', 'listingId', 'pricePerHour', 'subject'];
const SLOT_KEYS = ['endAtUtc', 'id', 'startAtUtc'];

export function disposableComparisonVisibilityDatabaseUrl(env: NodeJS.ProcessEnv): string {
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

interface ListingOptions {
  subject: string;
  price: string;
}

interface Fixture {
  tutorId: string;
  listingIds: string[];
  privateMarker: string;
}

async function verify(): Promise<void> {
  const databaseUrl = disposableComparisonVisibilityDatabaseUrl(process.env);
  const prisma = new PrismaService(new ConfigService({ DATABASE_URL: databaseUrl }));
  const directory = new TutorDirectoryService(prisma);
  const availability = new TutorAvailabilityService(prisma);
  const now = Date.now();
  const grades = { g10: randomUUID(), g11: randomUUID() };
  const studentId = randomUUID();
  const subjects: { id: string; name: string }[] = [];
  const tutors: string[] = [];
  let passed = 0;
  const pass = (label: string): void => {
    passed += 1;
    process.stdout.write(`PASS [real services + PostgreSQL] ${label}\n`);
  };

  async function subject(): Promise<string> {
    const row = { id: randomUUID(), name: `s3-t32-${randomUUID()}` };
    await prisma.subject.create({ data: { ...row, code: row.id } });
    subjects.push(row);
    return row.name;
  }

  async function tutor(
    listings: readonly ListingOptions[],
    options: { experienceYears?: number; gradeId?: string } = {},
  ): Promise<Fixture> {
    const tutorId = randomUUID();
    const privateMarker = `private-${randomUUID()}`;
    tutors.push(tutorId);
    await prisma.user.create({
      data: {
        id: tutorId,
        email: `${privateMarker}@s3-t32.invalid`,
        role: Role.TUTOR,
        emailVerifiedAt: new Date(),
      },
    });
    await prisma.tutorProfile.create({
      data: {
        userId: tutorId,
        firstName: `${privateMarker}-first`,
        lastName: `${privateMarker}-last`,
        displayName: 'Synthetic comparison tutor',
        bio: 'S3-T32 public bio',
        experienceYears: options.experienceYears ?? 3,
        verificationStatus: TutorVerificationStatus.VERIFIED,
      },
    });
    const listingIds: string[] = [];
    for (const [index, listing] of listings.entries()) {
      const subjectId = subjects.find(({ name }) => name === listing.subject)?.id;
      assert.ok(subjectId);
      const created = await prisma.teachingListing.create({
        data: {
          tutorProfileId: tutorId,
          subjectId,
          gradeLevelId: index === 0 ? (options.gradeId ?? grades.g10) : grades.g11,
          pricePerHour: listing.price,
          description: `Synthetic S3-T32 comparison listing ${index + 1}.`,
          publicationStatus: ListingPublicationStatus.PUBLISHED,
          publishedAt: new Date(now - (index + 1) * DAY_MS),
        },
      });
      listingIds.push(created.id);
    }
    return { tutorId, listingIds, privateMarker };
  }

  async function slot(fixture: Fixture, offsetMs: number, deleted = false): Promise<string> {
    const startAtUtc = new Date(now + offsetMs);
    const created = await prisma.availabilitySlot.create({
      data: {
        tutorProfileId: fixture.tutorId,
        startAtUtc,
        endAtUtc: new Date(startAtUtc.getTime() + HOUR_MS),
        deletedAt: deleted ? new Date() : null,
      },
    });
    return created.id;
  }

  async function booking(fixture: Fixture, slotId: string, status: BookingStatus) {
    const canceled = status === BookingStatus.CANCELED;
    await prisma.booking.create({
      data: {
        studentUserId: studentId,
        tutorProfileId: fixture.tutorId,
        listingId: fixture.listingIds[0] ?? '',
        slotId,
        status,
        subtotalAmount: '400.00',
        netAmount: '400.00',
        canceledById: canceled ? studentId : null,
        cancellationReason: canceled ? 'Synthetic S3-T32 cancellation' : null,
        canceledAt: canceled ? new Date() : null,
      },
    });
  }

  const detail = (fixture: Fixture) => directory.getPublicTutor(fixture.tutorId);
  const slots = (fixture: Fixture) =>
    availability.getAvailabilityPublic(fixture.tutorId, { from: new Date(now) });
  async function hidden(fixture: Fixture): Promise<void> {
    for (const read of [() => detail(fixture), () => slots(fixture)]) {
      await assert.rejects(
        read(),
        (error: unknown) => error instanceof NotFoundException && error.getStatus() === 404,
      );
    }
  }
  async function searchIds(subjectName: string): Promise<string[]> {
    const result = await directory.searchPublicTutors({
      pageSize: MAX_TUTOR_SEARCH_PAGE_SIZE,
      subject: subjectName,
    });
    return result.items.map(({ listingId }) => listingId);
  }

  try {
    await prisma.$connect();
    const target = await prisma.$queryRaw<{ database: string; schema: string }[]>`
      SELECT current_database() AS database, current_schema() AS schema
    `;
    assert.deepEqual(target, [
      { database: decodeURIComponent(new URL(databaseUrl).pathname.slice(1)), schema: 'public' },
    ]);
    const committed = (
      await readdir(resolve(__dirname, '../prisma/migrations'), { withFileTypes: true })
    )
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    const applied = await prisma.$queryRaw<
      { migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]
    >`SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations`;
    assert.equal(
      applied.some((row) => !row.finished_at && !row.rolled_back_at),
      false,
    );
    const finished = new Set(
      applied
        .filter((row) => row.finished_at && !row.rolled_back_at)
        .map((row) => row.migration_name),
    );
    assert.deepEqual(
      committed.filter((name) => !finished.has(name)),
      [],
      'Apply all migrations first',
    );

    for (const [key, id] of Object.entries(grades)) {
      await prisma.gradeLevel.create({
        data: { id, code: id, name: `s3-t32-${key}-${id}`, sortOrder: key === 'g10' ? 1 : 2 },
      });
    }
    await prisma.user.create({
      data: {
        id: studentId,
        email: `${studentId}@s3-t32.invalid`,
        role: Role.STUDENT,
        emailVerifiedAt: new Date(),
      },
    });

    // 1. Public fields only, and each selected listing keeps its own price and subject.
    const maths = await subject();
    const physics = await subject();
    const twoCourses = await tutor([
      { subject: maths, price: '450.00' },
      { subject: physics, price: '300.50' },
    ]);
    const shown = await detail(twoCourses);
    assert.deepEqual(Object.keys(shown).sort(), ['listings', 'tutor']);
    assert.deepEqual(Object.keys(shown.tutor).sort(), DETAIL_TUTOR_KEYS);
    for (const listing of shown.listings) {
      assert.deepEqual(Object.keys(listing).sort(), DETAIL_LISTING_KEYS);
    }
    assert.equal(JSON.stringify(shown).includes(twoCourses.privateMarker), false);
    const [mathsId, physicsId] = twoCourses.listingIds;
    assert.deepEqual(
      shown.listings.map(({ listingId, pricePerHour, subject: name }) => [
        listingId,
        pricePerHour,
        name,
      ]),
      [
        [mathsId, 450, maths],
        [physicsId, 300.5, physics],
      ],
    );
    for (const name of [maths, physics]) {
      const row = (
        await directory.searchPublicTutors({ pageSize: MAX_TUTOR_SEARCH_PAGE_SIZE, subject: name })
      ).items.find(({ tutorId }) => tutorId === twoCourses.tutorId);
      const listing = shown.listings.find(({ listingId }) => listingId === row?.listingId);
      assert.ok(row && listing, 'Every searchable course must exist on the public detail');
      assert.deepEqual(
        [row.pricePerHour, row.subject, row.grade],
        [listing.pricePerHour, listing.subject, listing.grade],
      );
    }
    pass(
      'detail exposes only allow-listed public fields (no email or legal names); each of two ' +
        'listings keeps its own price, subject and grade, matching its search row',
    );

    // 2. Availability is future, free and minimal.
    const free = await slot(twoCourses, 2 * DAY_MS);
    const pending = await slot(twoCourses, 3 * DAY_MS);
    const freedByCancel = await slot(twoCourses, 4 * DAY_MS);
    await slot(twoCourses, -2 * DAY_MS);
    await slot(twoCourses, 5 * DAY_MS, true);
    await booking(twoCourses, pending, BookingStatus.PENDING);
    await booking(twoCourses, freedByCancel, BookingStatus.CANCELED);
    const open = await slots(twoCourses);
    assert.deepEqual(
      open.map(({ id }) => id),
      [free, freedByCancel],
    );
    for (const item of open) {
      assert.deepEqual(Object.keys(item).sort(), SLOT_KEYS);
    }
    pass(
      'availability returns only future free slots as {id, startAtUtc, endAtUtc}: a pending ' +
        'booking, a past slot and a deleted slot are hidden; a canceled booking frees its slot',
    );

    // 3. Missing values stay real: New tutor, zero experience, no slot, no listing.
    const newcomer = await tutor([{ subject: maths, price: '200.00' }], { experienceYears: 0 });
    const noCourses = await tutor([]);
    const newView = await detail(newcomer);
    assert.deepEqual(
      [newView.tutor.ratingAverage, newView.tutor.reviewCount, newView.tutor.experienceYears],
      [null, 0, 0],
    );
    assert.deepEqual(await slots(newcomer), []);
    assert.deepEqual((await detail(noCourses)).listings, []);
    pass(
      'a new tutor reads as rating null with 0 reviews and 0 years, no future slot is [] and a ' +
        'tutor without published listings has an empty list; nothing is invented',
    );

    // 4. A selected tutor that stops being public answers 404 on both comparison reads.
    const revocations: {
      label: string;
      hide: (fixture: Fixture) => Promise<unknown>;
    }[] = [
      ...[
        TutorVerificationStatus.UNVERIFIED,
        TutorVerificationStatus.PENDING,
        TutorVerificationStatus.REJECTED,
      ].map((verificationStatus) => ({
        label: verificationStatus,
        hide: (fixture: Fixture) =>
          prisma.tutorProfile.update({
            data: { verificationStatus },
            where: { userId: fixture.tutorId },
          }),
      })),
      {
        label: AccountStatus.SUSPENDED,
        hide: (fixture: Fixture) =>
          prisma.user.update({
            data: { accountStatus: AccountStatus.SUSPENDED },
            where: { id: fixture.tutorId },
          }),
      },
      {
        label: AccountStatus.DELETED,
        hide: (fixture: Fixture) =>
          prisma.user.update({
            data: { accountStatus: AccountStatus.DELETED, deletedAt: new Date() },
            where: { id: fixture.tutorId },
          }),
      },
    ];
    const hiddenSubject = await subject();
    for (const { hide } of revocations) {
      const selected = await tutor([{ subject: hiddenSubject, price: '350.00' }]);
      await slot(selected, DAY_MS);
      assert.equal((await detail(selected)).listings.length, 1);
      assert.equal((await slots(selected)).length, 1);
      await hide(selected);
      await hidden(selected);
      assert.equal((await searchIds(hiddenSubject)).includes(selected.listingIds[0] ?? ''), false);
    }
    pass(
      `after selection, ${revocations.map(({ label }) => label).join(', ')} tutors answer 404 ` +
        'on both detail and availability and leave search',
    );

    // 5. A selected listing removed after selection disappears without a substitute.
    const removalSubject = await subject();
    for (const removal of ['archived', 'deleted'] as const) {
      const selected = await tutor([
        { subject: removalSubject, price: '410.00' },
        { subject: maths, price: '275.00' },
      ]);
      const [chosen, other] = selected.listingIds;
      assert.ok(chosen && other);
      const before = (await detail(selected)).listings.find(({ listingId }) => listingId === other);
      await prisma.teachingListing.update({
        data:
          removal === 'archived'
            ? { publicationStatus: ListingPublicationStatus.ARCHIVED }
            : { deletedAt: new Date() },
        where: { id: chosen },
      });
      const after = await detail(selected);
      assert.deepEqual(
        after.listings.map(({ listingId }) => listingId),
        [other],
      );
      assert.deepEqual(after.listings[0], before);
      assert.equal((await searchIds(removalSubject)).includes(chosen), false);
      // The tutor is still public, so availability answers rather than 404.
      assert.deepEqual(await slots(selected), []);
    }
    pass(
      'an archived or deleted selected listing drops out of detail and search while the tutor ' +
        'stays public; the tutor’s other listing is returned unchanged, never as a substitute',
    );

    process.stdout.write(`Passed ${passed} comparison visibility database checks.\n`);
  } finally {
    try {
      await prisma.booking.deleteMany({ where: { tutorProfileId: { in: tutors } } });
      await prisma.availabilitySlot.deleteMany({ where: { tutorProfileId: { in: tutors } } });
      await prisma.teachingListing.deleteMany({ where: { tutorProfileId: { in: tutors } } });
      await prisma.tutorProfile.deleteMany({ where: { userId: { in: tutors } } });
      await prisma.user.deleteMany({ where: { id: { in: [...tutors, studentId] } } });
      await prisma.subject.deleteMany({ where: { id: { in: subjects.map(({ id }) => id) } } });
      await prisma.gradeLevel.deleteMany({ where: { id: { in: Object.values(grades) } } });
    } finally {
      await prisma.$disconnect();
    }
  }
}

if (require.main === module) {
  void verify().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : 'Comparison visibility verification failed'}\n` +
        'Discard the disposable database.\n',
    );
    process.exitCode = 1;
  });
}
