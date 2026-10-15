import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import 'reflect-metadata';

import { ListingPublicationStatus, Role, TutorVerificationStatus } from '@generated/prisma/client';
import { PrismaService } from '@infrastructure/database/prisma.service';
import { TutorDirectoryService } from '@modules/tutors/tutor-directory.service';
import { TutorListingsService } from '@modules/tutors/tutor-listings.service';
import { MAX_TUTOR_SEARCH_PAGE_SIZE } from '@modules/tutors/tutors.dto';

/** Every verificationStatus this gate can block; derived so a future enum value is covered too. */
const BLOCKED_STATUSES = Object.values(TutorVerificationStatus).filter(
  (status) => status !== TutorVerificationStatus.VERIFIED,
);

/**
 * S2-T12: proves the S2-T10 publish gate and the discovery query it shares (`publicTutorWhere`)
 * against real PostgreSQL. The mocked-Prisma suites (`tutors.service.spec.ts`,
 * `public-tutors.service.spec.ts`, `tutor-listing-publish.e2e-spec.ts`) check the `where` clause a
 * call receives; they cannot prove that clause actually excludes a row once it is persisted, or
 * that an excluded row survives unmodified. Only a real database can.
 *
 * There is no admin "revoke verification" endpoint anywhere in this product: a tutor's
 * verificationStatus is derived from `TutorDocument.reviewStatus` rows by
 * `deriveTutorVerificationStatus`, and that derivation is sticky toward VERIFIED (it returns
 * VERIFIED if *any* document was ever approved, regardless of later uploads). A tutor cannot be
 * walked back down to REJECTED by any reachable API call. "Revocation" is therefore simulated by
 * writing `TutorProfile.verificationStatus` directly, exactly as a future admin action would have
 * to -- this script does not exercise the qualification-document upload/review flow itself; that
 * surface has its own disposable-database evidence (`db:verify:qualifications`).
 */

const databaseUrl = process.env['DATABASE_URL'];
assert.ok(databaseUrl, 'DATABASE_URL is required');
assert.equal(
  process.env['HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY'],
  '1',
  'Explicit disposable database opt-in is required',
);
let parsed: URL;
try {
  parsed = new URL(databaseUrl);
} catch {
  throw new Error('DATABASE_URL must be a valid disposable PostgreSQL URL');
}
assert.ok(['postgres:', 'postgresql:'].includes(parsed.protocol), 'PostgreSQL is required');
assert.ok(
  ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(parsed.hostname),
  'Verification refuses remote databases',
);
assert.match(
  decodeURIComponent(parsed.pathname.slice(1)),
  /^hktutor[-_].*[-_]test$/,
  'Use a disposable hktutor_*_test database',
);
assert.equal(parsed.search, '', 'Database URL options/schema overrides are not allowed');
assert.equal(parsed.hash, '', 'Database URL fragments are not allowed');

const prisma = new PrismaService(new ConfigService({ DATABASE_URL: databaseUrl }));
const listings = new TutorListingsService(prisma);
const directory = new TutorDirectoryService(prisma);

const created = {
  users: [] as string[],
  subjects: [] as string[],
  grades: [] as string[],
  listings: [] as string[],
};

let passed = 0;
function pass(label: string): void {
  passed += 1;
  process.stdout.write(`PASS [real PostgreSQL] ${label}\n`);
}

async function setVerification(userId: string, status: TutorVerificationStatus): Promise<void> {
  await prisma.tutorProfile.update({ where: { userId }, data: { verificationStatus: status } });
}

/**
 * Snapshots the row, attempts the blocked publish, then asserts the row is byte-for-byte
 * unchanged. A before/after deep-equal subsumes "stays DRAFT" and "stays untouched after
 * revocation" in one assertion, and it reads the row only after the rejection settles, so a future
 * implementation that mutated before throwing would be caught rather than missed by a read that
 * happened too early.
 */
async function assertBlockedFromPublishing(userId: string, listingId: string): Promise<void> {
  const before = await prisma.teachingListing.findUniqueOrThrow({ where: { id: listingId } });
  await assert.rejects(listings.postPublishListing(userId, listingId), ForbiddenException);
  const after = await prisma.teachingListing.findUniqueOrThrow({ where: { id: listingId } });
  assert.deepEqual(after, before, 'a blocked publish attempt must not change the listing row');
}

/**
 * `pageSize` is set to the documented maximum so this does not depend on the default page size or
 * on how many other published listings a non-empty disposable database happens to already hold.
 */
async function searchEverything() {
  return directory.searchPublicTutors({ pageSize: MAX_TUTOR_SEARCH_PAGE_SIZE });
}

async function assertExcludedFromDiscovery(userId: string, listingId: string): Promise<void> {
  const search = await searchEverything();
  assert.ok(
    search.items.every((item) => item.tutorId !== userId),
    'an ineligible tutor must not appear in search results',
  );
  assert.ok(
    search.items.every((item) => item.listingId !== listingId),
    'a listing owned by an ineligible tutor must not appear in search results',
  );
  await assert.rejects(directory.getPublicTutor(userId), NotFoundException);
}

async function assertVisibleInDiscovery(userId: string, listingId: string): Promise<void> {
  const search = await searchEverything();
  assert.ok(
    search.items.some((item) => item.tutorId === userId && item.listingId === listingId),
    'a verified tutor with a published listing must appear in search results',
  );
  const detail = await directory.getPublicTutor(userId);
  assert.equal(detail.tutor.tutorId, userId);
  assert.equal(detail.tutor.verificationStatus, 'VERIFIED');
  assert.ok(detail.listings.some((item) => item.listingId === listingId));
}

async function createTutor(displayName: string): Promise<{
  userId: string;
  listingId: string;
  subjectId: string;
  gradeLevelId: string;
}> {
  const userId = randomUUID();
  const subjectId = randomUUID();
  const gradeLevelId = randomUUID();
  const listingId = randomUUID();
  created.users.push(userId);
  created.subjects.push(subjectId);
  created.grades.push(gradeLevelId);
  created.listings.push(listingId);

  await prisma.user.create({
    data: {
      id: userId,
      email: `${userId}@s2-t12.invalid`,
      role: Role.TUTOR,
      emailVerifiedAt: new Date(),
    },
  });
  await prisma.tutorProfile.create({
    data: { userId, displayName, bio: 'Synthetic fixture for S2-T12', experienceYears: 3 },
  });
  await prisma.subject.create({ data: { id: subjectId, code: subjectId, name: subjectId } });
  await prisma.gradeLevel.create({
    data: { id: gradeLevelId, code: gradeLevelId, name: gradeLevelId, sortOrder: 1 },
  });
  await prisma.teachingListing.create({
    data: {
      id: listingId,
      tutorProfileId: userId,
      subjectId,
      gradeLevelId,
      pricePerHour: '500.00',
      description: 'Synthetic listing for isolated verification-visibility verification.',
    },
  });

  return { userId, listingId, subjectId, gradeLevelId };
}

async function main(): Promise<void> {
  await prisma.$connect();
  try {
    const target = await prisma.$queryRaw<Array<{ database: string; schema: string }>>`
      SELECT current_database() AS database, current_schema() AS schema
    `;
    assert.deepEqual(target, [
      { database: decodeURIComponent(parsed.pathname.slice(1)), schema: 'public' },
    ]);
    const committedMigrations = (
      await readdir(resolve(__dirname, '../prisma/migrations'), { withFileTypes: true })
    )
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    const migrations = await prisma.$queryRaw<
      Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>
    >`SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations`;
    const applied = new Set(
      migrations
        .filter((row) => row.finished_at && !row.rolled_back_at)
        .map((row) => row.migration_name),
    );
    assert.deepEqual(
      committedMigrations.filter((name) => !applied.has(name)),
      [],
      'Apply all committed migrations before verification',
    );
    assert.equal(
      migrations.some((row) => !row.finished_at && !row.rolled_back_at),
      false,
      'Resolve unfinished migrations before verification',
    );

    // A control tutor stays VERIFIED throughout, to rule out a filter broad enough to hide
    // everyone instead of the one tutor under test.
    const control = await createTutor('Control Tutor');
    await setVerification(control.userId, TutorVerificationStatus.VERIFIED);
    await listings.postPublishListing(control.userId, control.listingId);

    const subject = await createTutor('Subject Tutor');
    // A second listing for the same tutor, so step 4 can prove that re-verification unblocks
    // every listing the tutor owns, not just the one most recently touched. It stays DRAFT until
    // step 4 publishes it for real.
    const secondListingId = randomUUID();
    created.listings.push(secondListingId);
    await prisma.teachingListing.create({
      data: {
        id: secondListingId,
        tutorProfileId: subject.userId,
        subjectId: subject.subjectId,
        gradeLevelId: subject.gradeLevelId,
        pricePerHour: '600.00',
        description: 'Second synthetic listing for the same subject tutor.',
      },
    });
    // Forced directly, bypassing the publish API (which itself requires VERIFIED): without this,
    // steps 1-3 below would test discovery exclusion against a DRAFT listing, which is already
    // excluded by publicationStatus alone and would pass even with the verification filter
    // removed entirely. This reproduces the state a listing is actually in once it has been
    // published and a tutor is later found ineligible -- exactly what step 5 revokes from.
    await prisma.teachingListing.update({
      where: { id: subject.listingId },
      data: { publicationStatus: ListingPublicationStatus.PUBLISHED, publishedAt: new Date() },
    });

    assert.equal(
      (await prisma.tutorProfile.findUniqueOrThrow({ where: { userId: subject.userId } }))
        .verificationStatus,
      TutorVerificationStatus.UNVERIFIED,
    );

    // 1-3. Every non-VERIFIED status blocks publishing identically and leaves the already-
    // published listing exactly as it was; the control tutor must stay visible throughout, to
    // catch a filter broad enough to exclude everyone rather than just the ineligible tutor.
    for (const status of BLOCKED_STATUSES) {
      await setVerification(subject.userId, status);
      await assertBlockedFromPublishing(subject.userId, subject.listingId);
      await assertExcludedFromDiscovery(subject.userId, subject.listingId);
      await assertVisibleInDiscovery(control.userId, control.listingId);
      pass(`a ${status} tutor cannot publish and never appears in search or public profile`);
    }

    // 4. VERIFIED unblocks both listings for this tutor; both become visible.
    await setVerification(subject.userId, TutorVerificationStatus.VERIFIED);
    await listings.postPublishListing(subject.userId, subject.listingId);
    await listings.postPublishListing(subject.userId, secondListingId);
    await assertVisibleInDiscovery(subject.userId, subject.listingId);
    await assertVisibleInDiscovery(subject.userId, secondListingId);
    await assertVisibleInDiscovery(control.userId, control.listingId);
    pass('a VERIFIED tutor publishes and appears in search and public profile');

    // 5. "Revocation": the only transition a future admin feature could apply. The already
    // PUBLISHED listings must disappear from discovery without being deleted, and the same tutor
    // must be re-blocked from publishing anything further -- proving the gate is re-checked live
    // on every request, not cached from step 4's success. The republish attempt is awaited before
    // either row is read back, so a future implementation that mutated before throwing would be
    // caught rather than missed by a read that happened too early.
    await setVerification(subject.userId, TutorVerificationStatus.REJECTED);
    await assertExcludedFromDiscovery(subject.userId, subject.listingId);
    await assert.rejects(
      listings.postPublishListing(subject.userId, subject.listingId),
      ForbiddenException,
    );
    const revokedFirst = await prisma.teachingListing.findUniqueOrThrow({
      where: { id: subject.listingId },
    });
    const revokedSecond = await prisma.teachingListing.findUniqueOrThrow({
      where: { id: secondListingId },
    });
    for (const row of [revokedFirst, revokedSecond]) {
      assert.equal(row.publicationStatus, ListingPublicationStatus.PUBLISHED);
      assert.ok(row.publishedAt);
      assert.equal(row.deletedAt, null);
    }
    await assertVisibleInDiscovery(control.userId, control.listingId);
    pass(
      'after revocation, both published listings vanish from discovery without deletion, ' +
        'and republishing is blocked again; the unrelated verified tutor is unaffected',
    );

    // 6. Re-verification restores visibility, closing the before/after loop the card asks for.
    await setVerification(subject.userId, TutorVerificationStatus.VERIFIED);
    await assertVisibleInDiscovery(subject.userId, subject.listingId);
    await assertVisibleInDiscovery(subject.userId, secondListingId);
    await assertVisibleInDiscovery(control.userId, control.listingId);
    pass('re-verification restores search and public-profile visibility for the same listings');

    new Logger('TutorVerificationVisibility').log(`${passed} checks passed`);
  } finally {
    // Nested so a failure partway through cleanup (for example, a row already removed by a
    // step above) still disconnects rather than leaking an open connection and skipping the
    // remaining deletes.
    try {
      await prisma.teachingListing.deleteMany({ where: { id: { in: created.listings } } });
      await prisma.tutorProfile.deleteMany({ where: { userId: { in: created.users } } });
      await prisma.user.deleteMany({ where: { id: { in: created.users } } });
      await prisma.subject.deleteMany({ where: { id: { in: created.subjects } } });
      await prisma.gradeLevel.deleteMany({ where: { id: { in: created.grades } } });
    } finally {
      await prisma.$disconnect();
    }
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : 'Tutor verification visibility verification failed'}\n`,
  );
  process.exitCode = 1;
});
