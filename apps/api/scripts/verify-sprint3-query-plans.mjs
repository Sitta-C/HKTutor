import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import pg from 'pg';

import { disposableDatabaseUrl } from './verify-review-database.mjs';

export function summarizePlan(payload) {
  assert.ok(Array.isArray(payload) && payload.length === 1);
  const root = payload[0]?.Plan;
  assert.ok(root && typeof root === 'object');
  assert.ok(Number.isFinite(root['Actual Rows']) && Number.isFinite(payload[0]['Execution Time']));
  const nodes = [];
  const indexes = new Set();
  let removed = 0;
  function visit(plan) {
    assert.equal(typeof plan['Node Type'], 'string');
    nodes.push(plan['Node Type']);
    if (typeof plan['Index Name'] === 'string') {
      indexes.add(plan['Index Name']);
    }
    removed += Number(plan['Rows Removed by Filter'] ?? 0);
    for (const child of plan.Plans ?? []) {
      visit(child);
    }
  }
  visit(root);
  return {
    nodes,
    indexes: [...indexes],
    rows: root['Actual Rows'],
    removed,
    milliseconds: payload[0]['Execution Time'],
  };
}

// Only synthetic data in an opted-in disposable target; never disable sequential scans to force a plan.
async function main() {
  const pool = new pg.Pool({
    connectionString: disposableDatabaseUrl(),
    max: 1,
    connectionTimeoutMillis: 5000,
    statement_timeout: 60_000,
  });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `CREATE TEMP TABLE db05_plan_catalog AS SELECT gen_random_uuid() AS subject_id, gen_random_uuid() AS grade_id`,
    );
    await client.query(
      `CREATE TEMP TABLE db05_plan_tutors AS SELECT n, gen_random_uuid() AS tutor_id, gen_random_uuid() AS listing_id FROM generate_series(1,30) n`,
    );
    await client.query(`CREATE TEMP TABLE db05_plan_rows AS SELECT n,
      gen_random_uuid() AS student_id, gen_random_uuid() AS slot_id, gen_random_uuid() AS booking_id,
      gen_random_uuid() AS coupon_id, gen_random_uuid() AS attempt_id FROM generate_series(1,6000) n`);
    await client.query(
      `INSERT INTO "Subject" (id,code,name,"updatedAt") SELECT subject_id, 'db05-plan-'||subject_id::text, 'Synthetic plan subject', '2030-01-01Z' FROM db05_plan_catalog`,
    );
    await client.query(
      `INSERT INTO "GradeLevel" (id,code,name,"sortOrder","updatedAt") SELECT grade_id, 'db05-plan-'||grade_id::text, 'Synthetic plan grade', 99, '2030-01-01Z' FROM db05_plan_catalog`,
    );
    await client.query(`INSERT INTO "User" (id,email,role,"emailVerifiedAt","updatedAt")
      SELECT tutor_id, tutor_id::text||'@db05-plan.invalid', 'tutor'::"Role", '2030-01-01Z'::timestamptz, '2030-01-01Z'::timestamptz FROM db05_plan_tutors
      UNION ALL SELECT student_id, student_id::text||'@db05-plan.invalid', 'student'::"Role", '2030-01-01Z'::timestamptz, '2030-01-01Z'::timestamptz FROM db05_plan_rows`);
    await client.query(`INSERT INTO "TutorProfile" ("userId","displayName",bio,"experienceYears","verificationStatus","updatedAt")
      SELECT tutor_id, 'Synthetic plan tutor', 'Disposable DB05 data', 0, 'verified', '2030-01-01Z' FROM db05_plan_tutors`);
    await client.query(`INSERT INTO "TeachingListing" (id,"tutorProfileId","subjectId","gradeLevelId","pricePerHour",description,"publicationStatus","publishedAt","updatedAt")
      SELECT listing_id,tutor_id,subject_id,grade_id,450,'Synthetic plan listing','published','2030-01-01Z','2030-01-01Z' FROM db05_plan_tutors CROSS JOIN db05_plan_catalog`);
    await client.query(`INSERT INTO "Coupon" (id,code,percent,"maxUses","expiresAt","createdAt","updatedAt")
      SELECT coupon_id, 'DB05_PLAN_'||left(replace(coupon_id::text,'-',''),22),10,10,'2040-01-01Z',
        '2030-01-01Z'::timestamptz+n*interval '1 second','2030-01-01Z' FROM db05_plan_rows`);
    await client.query(`INSERT INTO "AvailabilitySlot" (id,"tutorProfileId","startAtUtc","endAtUtc")
      SELECT r.slot_id,t.tutor_id,'2030-01-01Z'::timestamptz+r.n*interval '2 hours',
        '2030-01-01Z'::timestamptz+r.n*interval '2 hours'+interval '1 hour'
      FROM db05_plan_rows r JOIN db05_plan_tutors t ON t.n=1+(r.n-1)%30`);
    await client.query(`INSERT INTO "Booking" (id,"studentUserId","tutorProfileId","listingId","slotId",status,
      "subtotalAmount","discountAmount","netAmount","appliedCouponId","appliedCouponCode","appliedCouponPercent","paymentPending","updatedAt")
      SELECT r.booking_id,r.student_id,t.tutor_id,t.listing_id,r.slot_id,
        CASE WHEN r.n<=3000 THEN 'completed'::"BookingStatus" ELSE 'confirmed'::"BookingStatus" END,
        450,45,405,r.coupon_id,c.code::text,10,r.n BETWEEN 3001 AND 5000,'2030-01-01Z'
      FROM db05_plan_rows r JOIN db05_plan_tutors t ON t.n=1+(r.n-1)%30 JOIN "Coupon" c ON c.id=r.coupon_id`);
    await client.query(`INSERT INTO "Review" (id,"bookingId","authorStudentUserId","tutorProfileId",clarity,punctuality,preparation,feedback,"createdAt")
      SELECT gen_random_uuid(),r.booking_id,r.student_id,t.tutor_id,4,4,4,'Synthetic DB05 plan feedback',
        '2030-01-01Z'::timestamptz+r.n*interval '1 second'
      FROM db05_plan_rows r JOIN db05_plan_tutors t ON t.n=1+(r.n-1)%30 WHERE r.n<=3000`);
    await client.query(`INSERT INTO "PaymentAttempt" (id,"bookingId",amount,currency,status,"appliedCouponId","appliedCouponCode","appliedCouponPercent","createdAt","updatedAt")
      SELECT r.attempt_id,r.booking_id,405,'THB','CREATING',r.coupon_id,c.code::text,10,'2030-01-01Z','2030-01-01Z'
      FROM db05_plan_rows r JOIN "Coupon" c ON c.id=r.coupon_id WHERE r.n BETWEEN 3001 AND 5000`);
    await client.query(`INSERT INTO "CouponReservation" (id,"couponId","bookingId","studentUserId","paymentAttemptId","discountAmount","createdAt")
      SELECT gen_random_uuid(),coupon_id,booking_id,student_id,attempt_id,45,'2030-01-01Z' FROM db05_plan_rows WHERE n BETWEEN 3001 AND 5000`);
    await client.query(`UPDATE "PaymentAttempt" a SET status='SUCCESSFUL',"paidAt"='2030-01-01T00:00:01Z',
      "chargeId"='chrg_test_DB05Plan'||replace(a.id::text,'-','') FROM db05_plan_rows r
      WHERE a.id=r.attempt_id AND r.n BETWEEN 4001 AND 5000`);
    await client.query(`UPDATE "CouponReservation" cr SET status='CONSUMED',"consumedAt"='2030-01-01T00:00:01Z'
      FROM db05_plan_rows r WHERE cr."bookingId"=r.booking_id AND r.n BETWEEN 4001 AND 5000`);
    await client.query(`UPDATE "Booking" b SET "paymentStatus"='paid',"paymentPending"=false,
      "paidAt"='2030-01-01T00:00:01Z',"paymentReference"='chrg_test_DB05Plan'||replace(r.attempt_id::text,'-','')
      FROM db05_plan_rows r WHERE b.id=r.booking_id AND r.n BETWEEN 4001 AND 5000`);
    await client.query('COMMIT');
    for (const table of [
      'User',
      'TutorProfile',
      'StudentProfile',
      'Review',
      'Coupon',
      'CouponUse',
      'CouponReservation',
      'PaymentAttempt',
      'Booking',
      'AvailabilitySlot',
    ]) {
      await client.query(`ANALYZE "${table}"`);
    }
    const tutor = (await client.query('SELECT tutor_id FROM db05_plan_tutors WHERE n=1')).rows[0]
      .tutor_id;
    const target = (await client.query('SELECT coupon_id FROM db05_plan_rows WHERE n=4000')).rows[0]
      .coupon_id;
    const code = (await client.query('SELECT code::text FROM "Coupon" WHERE id=$1', [target]))
      .rows[0].code;
    const consumedTarget = (await client.query('SELECT coupon_id FROM db05_plan_rows WHERE n=4500'))
      .rows[0].coupon_id;
    const queries = [
      [
        'public-reviews',
        `SELECT id,clarity,punctuality,preparation,feedback,"createdAt" FROM "Review"
        WHERE "tutorProfileId"=$1 AND ("createdAt"<'2030-01-01T00:33:20Z' OR ("createdAt"='2030-01-01T00:33:20Z' AND id<'ffffffff-ffff-ffff-ffff-ffffffffffff'))
        ORDER BY "createdAt" DESC,id DESC LIMIT 21`,
        [tutor],
        'Review_tutorProfileId_createdAt_id_idx',
      ],
      [
        'coupon-list',
        `SELECT id,code FROM "Coupon" WHERE "createdAt"<'2030-01-01T00:50:00Z'
        OR ("createdAt"='2030-01-01T00:50:00Z' AND id<'ffffffff-ffff-ffff-ffff-ffffffffffff') ORDER BY "createdAt" DESC,id DESC LIMIT 21`,
        [],
        'Coupon_createdAt_id_idx',
      ],
      ['coupon-code', 'SELECT id FROM "Coupon" WHERE code=$1', [code], 'Coupon_code_text_idx'],
      [
        'reservation-capacity',
        `SELECT count(*) FROM "CouponReservation" WHERE "couponId"=$1 AND status='RESERVED'`,
        [target],
        'CouponReservation_couponId_status_idx',
      ],
      [
        'consumed-capacity',
        `SELECT count(*) FROM "CouponUse" WHERE "couponId"=$1`,
        [consumedTarget],
        'CouponUse_couponId_studentUserId_key',
      ],
      [
        'reminder-scan',
        `SELECT b.id,s."startAtUtc" FROM "Booking" b JOIN "AvailabilitySlot" s ON s.id=b."slotId"
        WHERE b.status='confirmed' AND s."startAtUtc">'2031-04-03T08:00:00Z' AND s."startAtUtc"<='2031-04-04T08:00:00Z'
        ORDER BY s."startAtUtc",b.id LIMIT 100`,
        [],
        'AvailabilitySlot_startAtUtc_id_idx',
      ],
    ];
    process.stdout.write(
      'DB05 representative data: 6000 bookings/slots/coupons, 3000 reviews, 1000 RESERVED + 1000 CONSUMED, 1000 canonical uses, 30 tutors; ANALYZE completed.\n',
    );
    for (const [name, sql, values, expectedIndex] of queries) {
      const result = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, values);
      const summary = summarizePlan(result.rows[0]['QUERY PLAN']);
      assert.ok(summary.rows > 0, `${name}: query must exercise data`);
      if (expectedIndex) {
        assert.ok(
          summary.indexes.includes(expectedIndex),
          `${name}: expected natural use of ${expectedIndex}`,
        );
      }
      process.stdout.write(`PLAN ${name} ${JSON.stringify(summary)}\n`);
    }
    process.stdout.write('PASS DB05 representative EXPLAIN checks; no planner settings forced.\n');
  } finally {
    try {
      await client.query('ROLLBACK');
    } finally {
      client.release();
      await pool.end();
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(
      error instanceof assert.AssertionError
        ? `DB05 plan assertion: ${error.message}\n`
        : `DB05 plan verification failed (${error instanceof pg.DatabaseError ? `${error.code}/${error.table ?? 'SQL'}/${error.column ?? error.constraint ?? 'SQL'}` : error instanceof Error ? error.name : 'unknown'}).\n`,
    );
    process.exitCode = 1;
  }
}
