import assert from 'node:assert/strict';

import pg from 'pg';

const { Client } = pg;

const databaseUrl = process.env.DATABASE_URL;
const disposableApproval = process.env.HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for the Sprint 1 database verification');
}

if (disposableApproval !== '1') {
  throw new Error(
    'Set HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 only for a disposable local PostgreSQL database',
  );
}

const parsedUrl = new URL(databaseUrl);
const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const databaseName = decodeURIComponent(parsedUrl.pathname.slice(1));

if (!allowedHosts.has(parsedUrl.hostname)) {
  throw new Error('Sprint 1 database verification refuses non-local database hosts');
}

if (!/^hktutor[-_]/.test(databaseName)) {
  throw new Error('Sprint 1 database verification requires a disposable hktutor-* database');
}

const ids = {
  student: '90000000-0000-4000-8000-000000000001',
  emailOwner: '90000000-0000-4000-8000-000000000002',
  emailReplacement: '90000000-0000-4000-8000-000000000003',
  consentTimeOnly: '90000000-0000-4000-8000-000000000004',
  consentPolicyOnly: '90000000-0000-4000-8000-000000000005',
  consentBlankPolicy: '90000000-0000-4000-8000-000000000006',
  baseSlot: '91000000-0000-4000-8000-000000000001',
  adjacentSlot: '91000000-0000-4000-8000-000000000002',
  overlappingSlot: '91000000-0000-4000-8000-000000000003',
  bookingSlot: '91000000-0000-4000-8000-000000000004',
  deletedSlot: '91000000-0000-4000-8000-000000000005',
  firstBooking: '92000000-0000-4000-8000-000000000001',
  secondBooking: '92000000-0000-4000-8000-000000000002',
  concurrencyStudent: '93000000-0000-4000-8000-000000000001',
  concurrencySlot: '93000000-0000-4000-8000-000000000002',
  concurrencyBookingA: '93000000-0000-4000-8000-000000000003',
  concurrencyBookingB: '93000000-0000-4000-8000-000000000004',
};

let savepointSequence = 0;

async function expectViolation(client, label, sql, params, expectedCodes) {
  savepointSequence += 1;
  const savepoint = `contract_probe_${savepointSequence}`;
  await client.query(`SAVEPOINT ${savepoint}`);

  let failure;
  try {
    await client.query(sql, params);
  } catch (error) {
    failure = error;
  }

  await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
  assert.ok(failure, `${label} must be rejected by PostgreSQL`);
  assert.ok(
    expectedCodes.includes(failure.code),
    `${label} returned SQLSTATE ${failure.code ?? 'unknown'} instead of ${expectedCodes.join('/')}`,
  );
  console.info(`PASS ${label}`);
}

async function assertSeedShape(client) {
  const result = await client.query(`
    SELECT
      (SELECT COUNT(*)::int FROM "User") AS users,
      (SELECT COUNT(*)::int FROM "User" WHERE "role" = 'admin') AS admins,
      (SELECT COUNT(*)::int FROM "User" WHERE "role" = 'tutor') AS tutors,
      (SELECT COUNT(*)::int FROM "TutorProfile") AS tutor_profiles,
      (SELECT COUNT(*)::int FROM "Subject") AS subjects,
      (SELECT COUNT(*)::int FROM "GradeLevel") AS grade_levels,
      (SELECT COUNT(*)::int FROM "TeachingListing") AS listings,
      (SELECT COUNT(*)::int FROM "TeachingListing" WHERE "publicationStatus" = 'published')
        AS published_listings,
      (SELECT COUNT(*)::int FROM "TeachingListing" WHERE "publicationStatus" = 'draft')
        AS draft_listings,
      (SELECT COUNT(*)::int FROM "TutorProfile" WHERE "ratingAverage" IS NOT NULL)
        AS rated_profiles
  `);

  assert.deepEqual(result.rows[0], {
    users: 6,
    admins: 1,
    tutors: 5,
    tutor_profiles: 5,
    subjects: 2,
    grade_levels: 2,
    listings: 6,
    published_listings: 5,
    draft_listings: 1,
    rated_profiles: 5,
  });

  const filterMatrix = await client.query(`
    SELECT
      COUNT(*) FILTER (
        WHERE subject."code" = 'mathematics'
          AND grade."code" = 'grade-10'
          AND listing."pricePerHour" <= 500
          AND listing."publicationStatus" = 'published'
          AND profile."verificationStatus" = 'verified'
      )::int AS exact_matches,
      COUNT(*) FILTER (
        WHERE subject."code" = 'mathematics'
          AND grade."code" = 'grade-10'
          AND listing."pricePerHour" < 350
          AND listing."publicationStatus" = 'published'
          AND profile."verificationStatus" = 'verified'
      )::int AS below_boundary_matches
    FROM "TeachingListing" AS listing
    JOIN "Subject" AS subject ON subject."id" = listing."subjectId"
    JOIN "GradeLevel" AS grade ON grade."id" = listing."gradeLevelId"
    JOIN "TutorProfile" AS profile ON profile."userId" = listing."tutorProfileId"
  `);

  assert.deepEqual(filterMatrix.rows[0], {
    exact_matches: 3,
    below_boundary_matches: 0,
  });
  console.info('PASS deterministic seed shape and filter matrix');
}

async function runTransactionalChecks(client) {
  const catalog = await client.query(`
    SELECT
      (SELECT "id" FROM "Subject" WHERE "code" = 'mathematics') AS subject_id,
      (SELECT "id" FROM "GradeLevel" WHERE "code" = 'grade-10') AS grade_id,
      listing."id" AS listing_id,
      listing."tutorProfileId" AS tutor_profile_id
    FROM "TeachingListing" AS listing
    JOIN "Subject" AS subject ON subject."id" = listing."subjectId"
    JOIN "GradeLevel" AS grade ON grade."id" = listing."gradeLevelId"
    WHERE subject."code" = 'mathematics'
      AND grade."code" = 'grade-10'
      AND listing."publicationStatus" = 'published'
    ORDER BY listing."pricePerHour", listing."id"
    LIMIT 1
  `);
  assert.equal(
    catalog.rowCount,
    1,
    'the seed must expose a published Mathematics Grade 10 listing',
  );
  const { subject_id: subjectId, grade_id: gradeId, listing_id: listingId } = catalog.rows[0];
  const tutorProfileId = catalog.rows[0].tutor_profile_id;

  await client.query('BEGIN');
  try {
    await client.query(
      `INSERT INTO "User" (
        "id", "email", "role", "accountStatus",
        "consentAcceptedAt", "policyVersion", "updatedAt"
      ) VALUES ($1, 'contract.student@hktutor.invalid', 'student',
        'active', '2099-01-01T00:00:00Z', 'contract-v1', CURRENT_TIMESTAMP)`,
      [ids.student],
    );

    await expectViolation(
      client,
      'duplicate active email',
      `INSERT INTO "User" ("id", "email", "role", "updatedAt")
       VALUES ($1, 'CONTRACT.STUDENT@hktutor.invalid', 'student', CURRENT_TIMESTAMP)`,
      [ids.consentTimeOnly],
      ['23505'],
    );

    await client.query(
      `INSERT INTO "User" ("id", "email", "role", "accountStatus", "updatedAt")
       VALUES ($1, 'contract.unique@hktutor.invalid', 'tutor',
         'active', CURRENT_TIMESTAMP)`,
      [ids.emailOwner],
    );
    await expectViolation(
      client,
      'non-deleted email remains unique while suspended',
      `INSERT INTO "User" ("id", "email", "role", "accountStatus", "updatedAt")
       VALUES ($1, 'CONTRACT.UNIQUE@hktutor.invalid', 'tutor',
         'suspended', CURRENT_TIMESTAMP)`,
      [ids.emailReplacement],
      ['23505'],
    );
    await client.query(`UPDATE "User" SET "deletedAt" = CURRENT_TIMESTAMP WHERE "id" = $1`, [
      ids.emailOwner,
    ]);
    await client.query(
      `INSERT INTO "User" ("id", "email", "role", "accountStatus", "updatedAt")
       VALUES ($1, 'CONTRACT.UNIQUE@hktutor.invalid', 'tutor',
         'suspended', CURRENT_TIMESTAMP)`,
      [ids.emailReplacement],
    );
    console.info('PASS soft deletion releases email uniqueness');

    await expectViolation(
      client,
      'consent timestamp without policy version',
      `INSERT INTO "User" ("id", "email", "role", "consentAcceptedAt", "updatedAt")
       VALUES ($1, 'consent-time@hktutor.invalid', 'student', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [ids.consentTimeOnly],
      ['23514'],
    );
    await expectViolation(
      client,
      'policy version without consent timestamp',
      `INSERT INTO "User" ("id", "email", "role", "policyVersion", "updatedAt")
       VALUES ($1, 'consent-policy@hktutor.invalid', 'student', 'contract-v1', CURRENT_TIMESTAMP)`,
      [ids.consentPolicyOnly],
      ['23514'],
    );
    await expectViolation(
      client,
      'blank policy version with consent timestamp',
      `INSERT INTO "User" (
        "id", "email", "role", "consentAcceptedAt", "policyVersion", "updatedAt"
       ) VALUES ($1, 'consent-blank@hktutor.invalid', 'student', CURRENT_TIMESTAMP, '   ',
         CURRENT_TIMESTAMP)`,
      [ids.consentBlankPolicy],
      ['23514'],
    );

    await expectViolation(
      client,
      'negative tutor experience',
      `INSERT INTO "TutorProfile" (
        "userId", "displayName", "bio", "experienceYears", "updatedAt"
       ) VALUES ($1, 'Invalid', 'Invalid contract fixture', -1, CURRENT_TIMESTAMP)`,
      [ids.emailReplacement],
      ['23514'],
    );
    await expectViolation(
      client,
      'rating outside one to five',
      `INSERT INTO "TutorProfile" (
        "userId", "displayName", "bio", "experienceYears", "ratingAverage", "updatedAt"
       ) VALUES ($1, 'Invalid', 'Invalid contract fixture', 1, 6, CURRENT_TIMESTAMP)`,
      [ids.emailReplacement],
      ['23514'],
    );
    await expectViolation(
      client,
      'negative tutor review count',
      `INSERT INTO "TutorProfile" (
        "userId", "displayName", "bio", "experienceYears", "reviewCount", "updatedAt"
       ) VALUES ($1, 'Invalid', 'Invalid contract fixture', 1, -1, CURRENT_TIMESTAMP)`,
      [ids.emailReplacement],
      ['23514'],
    );

    await expectViolation(
      client,
      'case-insensitive subject code uniqueness',
      `INSERT INTO "Subject" ("id", "code", "name", "updatedAt")
       VALUES ('94000000-0000-4000-8000-000000000001', 'MATHEMATICS', 'Other name',
         CURRENT_TIMESTAMP)`,
      [],
      ['23505'],
    );
    await expectViolation(
      client,
      'negative grade sort order',
      `INSERT INTO "GradeLevel" ("id", "code", "name", "sortOrder", "updatedAt")
       VALUES ('94000000-0000-4000-8000-000000000002', 'invalid-grade', 'Invalid Grade', -1,
         CURRENT_TIMESTAMP)`,
      [],
      ['23514'],
    );

    await expectViolation(
      client,
      'non-positive listing price',
      `INSERT INTO "TeachingListing" (
        "id", "tutorProfileId", "subjectId", "gradeLevelId", "pricePerHour", "description",
        "updatedAt"
       ) VALUES ('94000000-0000-4000-8000-000000000003', $1, $2, $3, 0,
         'A valid-length description for the contract probe.', CURRENT_TIMESTAMP)`,
      [tutorProfileId, subjectId, gradeId],
      ['23514'],
    );
    await expectViolation(
      client,
      'trimmed listing description length',
      `INSERT INTO "TeachingListing" (
        "id", "tutorProfileId", "subjectId", "gradeLevelId", "pricePerHour", "description",
        "updatedAt"
       ) VALUES ('94000000-0000-4000-8000-000000000004', $1, $2, $3, 100, 'too short',
         CURRENT_TIMESTAMP)`,
      [tutorProfileId, subjectId, gradeId],
      ['23514'],
    );
    await expectViolation(
      client,
      'published listing requires publishedAt',
      `INSERT INTO "TeachingListing" (
        "id", "tutorProfileId", "subjectId", "gradeLevelId", "pricePerHour", "description",
        "publicationStatus", "updatedAt"
       ) VALUES ('94000000-0000-4000-8000-000000000005', $1, $2, $3, 100,
         'A valid-length published listing description.', 'published', CURRENT_TIMESTAMP)`,
      [tutorProfileId, subjectId, gradeId],
      ['23514'],
    );

    await client.query(
      `INSERT INTO "AvailabilitySlot" (
        "id", "tutorProfileId", "startAtUtc", "endAtUtc"
       ) VALUES ($1, $2, '2099-01-01T10:00:00Z', '2099-01-01T11:00:00Z')`,
      [ids.baseSlot, tutorProfileId],
    );
    await client.query(
      `INSERT INTO "AvailabilitySlot" (
        "id", "tutorProfileId", "startAtUtc", "endAtUtc"
       ) VALUES ($1, $2, '2099-01-01T11:00:00Z', '2099-01-01T12:00:00Z')`,
      [ids.adjacentSlot, tutorProfileId],
    );
    console.info('PASS adjacent availability slots');
    await expectViolation(
      client,
      'overlapping availability slots',
      `INSERT INTO "AvailabilitySlot" (
        "id", "tutorProfileId", "startAtUtc", "endAtUtc"
       ) VALUES ($1, $2, '2099-01-01T10:30:00Z', '2099-01-01T11:30:00Z')`,
      [ids.overlappingSlot, tutorProfileId],
      ['23P01'],
    );
    await expectViolation(
      client,
      'inverted availability slot',
      `INSERT INTO "AvailabilitySlot" (
        "id", "tutorProfileId", "startAtUtc", "endAtUtc"
       ) VALUES ($1, $2, '2099-01-02T11:00:00Z', '2099-01-02T10:00:00Z')`,
      [ids.overlappingSlot, tutorProfileId],
      ['23514'],
    );

    await client.query(
      `INSERT INTO "AvailabilitySlot" (
        "id", "tutorProfileId", "startAtUtc", "endAtUtc"
       ) VALUES ($1, $2, '2099-01-03T10:00:00Z', '2099-01-03T11:00:00Z')`,
      [ids.bookingSlot, tutorProfileId],
    );
    await client.query(
      `INSERT INTO "Booking" (
        "id", "studentUserId", "tutorProfileId", "listingId", "slotId", "subtotalAmount",
        "discountAmount", "netAmount", "updatedAt"
       ) VALUES ($1, $2, $3, $4, $5, 500, 50, 450, CURRENT_TIMESTAMP)`,
      [ids.firstBooking, ids.student, tutorProfileId, listingId, ids.bookingSlot],
    );
    await expectViolation(
      client,
      'one active booking per slot',
      `INSERT INTO "Booking" (
        "id", "studentUserId", "tutorProfileId", "listingId", "slotId", "subtotalAmount",
        "discountAmount", "netAmount", "updatedAt"
       ) VALUES ($1, $2, $3, $4, $5, 500, 50, 450, CURRENT_TIMESTAMP)`,
      [ids.secondBooking, ids.student, tutorProfileId, listingId, ids.bookingSlot],
      ['23505'],
    );
    await client.query(`UPDATE "Booking" SET "status" = 'canceled' WHERE "id" = $1`, [
      ids.firstBooking,
    ]);
    await client.query(
      `INSERT INTO "Booking" (
        "id", "studentUserId", "tutorProfileId", "listingId", "slotId", "subtotalAmount",
        "discountAmount", "netAmount", "updatedAt"
       ) VALUES ($1, $2, $3, $4, $5, 500, 50, 450, CURRENT_TIMESTAMP)`,
      [ids.secondBooking, ids.student, tutorProfileId, listingId, ids.bookingSlot],
    );
    console.info('PASS canceled booking releases slot');

    await expectViolation(
      client,
      'booking amount balance',
      `INSERT INTO "Booking" (
        "id", "studentUserId", "tutorProfileId", "listingId", "slotId", "status",
        "subtotalAmount", "discountAmount", "netAmount", "updatedAt"
       ) VALUES ('94000000-0000-4000-8000-000000000006', $1, $2, $3, $4, 'canceled',
         500, 50, 451, CURRENT_TIMESTAMP)`,
      [ids.student, tutorProfileId, listingId, ids.bookingSlot],
      ['23514'],
    );
    await expectViolation(
      client,
      'booking numeric NaN',
      `INSERT INTO "Booking" (
        "id", "studentUserId", "tutorProfileId", "listingId", "slotId", "status",
        "subtotalAmount", "discountAmount", "netAmount", "updatedAt"
       ) VALUES ('94000000-0000-4000-8000-000000000007', $1, $2, $3, $4, 'canceled',
         'NaN'::numeric, 0, 'NaN'::numeric, CURRENT_TIMESTAMP)`,
      [ids.student, tutorProfileId, listingId, ids.bookingSlot],
      ['23514'],
    );
    await expectViolation(
      client,
      'booking currency remains THB',
      `INSERT INTO "Booking" (
        "id", "studentUserId", "tutorProfileId", "listingId", "slotId", "status",
        "subtotalAmount", "discountAmount", "netAmount", "currency", "updatedAt"
       ) VALUES ('94000000-0000-4000-8000-000000000008', $1, $2, $3, $4, 'canceled',
         500, 50, 450, 'USD', CURRENT_TIMESTAMP)`,
      [ids.student, tutorProfileId, listingId, ids.bookingSlot],
      ['23514'],
    );
    await expectViolation(
      client,
      'active-booking slot cannot be soft deleted',
      `UPDATE "AvailabilitySlot" SET "deletedAt" = CURRENT_TIMESTAMP WHERE "id" = $1`,
      [ids.bookingSlot],
      ['23514'],
    );

    await client.query(
      `INSERT INTO "AvailabilitySlot" (
        "id", "tutorProfileId", "startAtUtc", "endAtUtc", "deletedAt"
       ) VALUES ($1, $2, '2099-01-04T10:00:00Z', '2099-01-04T11:00:00Z', CURRENT_TIMESTAMP)`,
      [ids.deletedSlot, tutorProfileId],
    );
    await expectViolation(
      client,
      'active booking requires non-deleted slot',
      `INSERT INTO "Booking" (
        "id", "studentUserId", "tutorProfileId", "listingId", "slotId", "subtotalAmount",
        "discountAmount", "netAmount", "updatedAt"
       ) VALUES ('94000000-0000-4000-8000-000000000009', $1, $2, $3, $4, 500, 50, 450,
         CURRENT_TIMESTAMP)`,
      [ids.student, tutorProfileId, listingId, ids.deletedSlot],
      ['23514'],
    );
    await expectViolation(
      client,
      'restrict deletion preserves referenced catalog history',
      `DELETE FROM "Subject" WHERE "id" = $1`,
      [subjectId],
      ['23503'],
    );
  } finally {
    await client.query('ROLLBACK');
  }
}

async function runConcurrencyCheck(connectionString) {
  const setup = new Client({ connectionString });
  const first = new Client({ connectionString });
  const second = new Client({ connectionString });

  await Promise.all([setup.connect(), first.connect(), second.connect()]);
  try {
    const listingResult = await setup.query(`
      SELECT "id", "tutorProfileId"
      FROM "TeachingListing"
      WHERE "publicationStatus" = 'published'
      ORDER BY "pricePerHour", "id"
      LIMIT 1
    `);
    assert.equal(listingResult.rowCount, 1);
    const listing = listingResult.rows[0];

    await setup.query('BEGIN');
    await setup.query(`DELETE FROM "Booking" WHERE "id" IN ($1, $2)`, [
      ids.concurrencyBookingA,
      ids.concurrencyBookingB,
    ]);
    await setup.query(`DELETE FROM "AvailabilitySlot" WHERE "id" = $1`, [ids.concurrencySlot]);
    await setup.query(`DELETE FROM "User" WHERE "id" = $1`, [ids.concurrencyStudent]);
    await setup.query(
      `INSERT INTO "User" ("id", "email", "role", "updatedAt")
       VALUES ($1, 'concurrency-student@hktutor.invalid', 'student', CURRENT_TIMESTAMP)`,
      [ids.concurrencyStudent],
    );
    await setup.query(
      `INSERT INTO "AvailabilitySlot" (
        "id", "tutorProfileId", "startAtUtc", "endAtUtc"
       ) VALUES ($1, $2, '2099-02-01T10:00:00Z', '2099-02-01T11:00:00Z')`,
      [ids.concurrencySlot, listing.tutorProfileId],
    );
    await setup.query('COMMIT');

    await first.query('BEGIN');
    await second.query('BEGIN');
    await first.query(
      `INSERT INTO "Booking" (
        "id", "studentUserId", "tutorProfileId", "listingId", "slotId", "subtotalAmount",
        "discountAmount", "netAmount", "updatedAt"
       ) VALUES ($1, $2, $3, $4, $5, 500, 50, 450, CURRENT_TIMESTAMP)`,
      [
        ids.concurrencyBookingA,
        ids.concurrencyStudent,
        listing.tutorProfileId,
        listing.id,
        ids.concurrencySlot,
      ],
    );

    const competingInsert = second
      .query(
        `INSERT INTO "Booking" (
          "id", "studentUserId", "tutorProfileId", "listingId", "slotId", "subtotalAmount",
          "discountAmount", "netAmount", "updatedAt"
         ) VALUES ($1, $2, $3, $4, $5, 500, 50, 450, CURRENT_TIMESTAMP)`,
        [
          ids.concurrencyBookingB,
          ids.concurrencyStudent,
          listing.tutorProfileId,
          listing.id,
          ids.concurrencySlot,
        ],
      )
      .then(() => undefined)
      .catch((error) => error);

    await new Promise((resolve) => setTimeout(resolve, 100));
    await first.query('COMMIT');
    const competingFailure = await competingInsert;
    assert.equal(competingFailure?.code, '23505');
    await second.query('ROLLBACK');
    console.info('PASS concurrent booking race has exactly one winner');
  } finally {
    await setup.query('ROLLBACK').catch(() => undefined);
    await first.query('ROLLBACK').catch(() => undefined);
    await second.query('ROLLBACK').catch(() => undefined);
    await setup
      .query(`DELETE FROM "Booking" WHERE "id" IN ($1, $2)`, [
        ids.concurrencyBookingA,
        ids.concurrencyBookingB,
      ])
      .catch(() => undefined);
    await setup
      .query(`DELETE FROM "AvailabilitySlot" WHERE "id" = $1`, [ids.concurrencySlot])
      .catch(() => undefined);
    await setup
      .query(`DELETE FROM "User" WHERE "id" = $1`, [ids.concurrencyStudent])
      .catch(() => undefined);
    await Promise.all([setup.end(), first.end(), second.end()]);
  }
}

const client = new Client({ connectionString: databaseUrl });
await client.connect();
try {
  await assertSeedShape(client);
  await runTransactionalChecks(client);
} finally {
  await client.end();
}

await runConcurrencyCheck(databaseUrl);
console.info('Sprint 1 disposable database verification passed');
