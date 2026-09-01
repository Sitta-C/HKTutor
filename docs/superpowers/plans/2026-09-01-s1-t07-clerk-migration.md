# S1-T07 Clerk Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a guarded forward-only PostgreSQL migration and read-only preflight command that move the seed-only shared demo database from local email/password users to the merged Clerk-backed data model.

**Architecture:** A pure TypeScript classifier evaluates a redacted aggregate snapshot, while a small Prisma raw-query adapter obtains that snapshot from either the historical or already-migrated schema. The migration repeats the same accepted-state invariants inside one explicit PostgreSQL transaction, purges only the approved demo identity graph, and installs the Clerk columns, indexes, enum, and webhook table. Static contract tests and a disposable PostgreSQL rehearsal verify both successful and fail-closed paths without contacting shared Supabase.

**Tech Stack:** Node.js 24.19.0, TypeScript 5.9, NestJS/Jest 30, Prisma ORM and Client 7.10.0, `@prisma/adapter-pg` 7.10.0, PostgreSQL 18, pnpm 11.19.0.

**Spec:** `docs/superpowers/specs/2026-09-01-s1-t07-clerk-migration-design.md`

## Global Constraints

- Do not edit any existing directory under `apps/api/prisma/migrations`.
- Do not connect to or mutate shared Supabase during development, testing, or review.
- Do not run `prisma migrate reset`, `prisma db push`, or `prisma migrate dev` against the shared project.
- The migration may delete only the approved seed/demo graph after a fail-closed guard succeeds.
- Keep `User.id` and every existing foreign-key definition unchanged.
- Preserve `Subject` and `GradeLevel` rows.
- Never log email addresses, password hashes, Clerk IDs, connection strings, or row payloads.
- Do not add a dependency; use the pinned Prisma/PostgreSQL stack already in `apps/api/package.json`.
- Shared deployment remains a separate post-merge approval checkpoint.

---

## File Map

- `apps/api/src/database/clerk-migration-preflight.ts` — snapshot types, pure classifier, catalog/data reader, and safe result formatting.
- `apps/api/src/database/clerk-migration-preflight.spec.ts` — unit contract for accepted/rejected shapes, query routing, and secret-free output.
- `apps/api/prisma/preflight-s1-t07-clerk.ts` — CLI composition root that loads `.env`, creates Prisma Client, runs preflight, and disconnects.
- `apps/api/package.json` and `package.json` — API and workspace `db:preflight:s1-t07-clerk` commands.
- `tests/clerk-user-migration.test.mjs` — repository-level SQL contract for the new migration and immutable historical boundary.
- `tests/fixtures/clerk-migration/s1-t14.sql` — canonical historical foundation-seed fixture for disposable PostgreSQL.
- `tests/fixtures/clerk-migration/s1-t20.sql` — canonical historical search-seed fixture for disposable PostgreSQL.
- `apps/api/prisma/migrations/20260901160000_migrate_user_identity_to_clerk/migration.sql` — guarded purge and Clerk DDL.
- `README.md` and `apps/api/README.md` — migration-owner runbook, failure handling, and separate shared checkpoint.

## Task 1: Build the Pure Preflight Classifier

**Files:**

- Create: `apps/api/src/database/clerk-migration-preflight.ts`
- Create: `apps/api/src/database/clerk-migration-preflight.spec.ts`

**Interfaces:**

- Consumes: aggregate counts and invariant counters from the historical database.
- Produces: `classifyClerkMigrationSnapshot(snapshot): ClerkMigrationPreflightResult` and `formatClerkMigrationPreflightResult(result): string`.
- Produces result states `empty`, `s1-t14-seed`, `s1-t20-seed`, `already-migrated`, and `rejected`.

- [ ] **Step 1: Write the classifier tests first**

Create the spec with a canonical zero-valued snapshot factory and explicit cases:

```ts
import {
  classifyClerkMigrationSnapshot,
  formatClerkMigrationPreflightResult,
  type ClerkMigrationSnapshot,
} from '@/database/clerk-migration-preflight';

const legacySnapshot = (
  override: Partial<ClerkMigrationSnapshot> = {},
): ClerkMigrationSnapshot => ({
  schemaState: 'legacy',
  userCount: 0,
  adminUserCount: 0,
  tutorUserCount: 0,
  studentUserCount: 0,
  nonActiveUserCount: 0,
  deletedUserCount: 0,
  consentedUserCount: 0,
  knownSyntheticTutorCount: 0,
  invalidSyntheticTutorCount: 0,
  tutorProfileCount: 0,
  invalidTutorProfileCount: 0,
  teachingListingCount: 0,
  knownTeachingListingCount: 0,
  invalidTeachingListingRelationCount: 0,
  availabilitySlotCount: 0,
  bookingCount: 0,
  ...override,
});

it('accepts the empty historical identity state', () => {
  expect(classifyClerkMigrationSnapshot(legacySnapshot())).toEqual({ state: 'empty' });
});

it('accepts the S1-T14 foundation seed state', () => {
  expect(
    classifyClerkMigrationSnapshot(
      legacySnapshot({
        userCount: 2,
        adminUserCount: 1,
        tutorUserCount: 1,
        tutorProfileCount: 1,
      }),
    ),
  ).toEqual({ state: 's1-t14-seed' });
});

it('accepts the S1-T20 search seed state', () => {
  expect(
    classifyClerkMigrationSnapshot(
      legacySnapshot({
        userCount: 6,
        adminUserCount: 1,
        tutorUserCount: 5,
        knownSyntheticTutorCount: 4,
        tutorProfileCount: 5,
        teachingListingCount: 6,
        knownTeachingListingCount: 6,
      }),
    ),
  ).toEqual({ state: 's1-t20-seed' });
});
```

Add table-driven rejections for `studentUserCount`, `nonActiveUserCount`, `deletedUserCount`,
`consentedUserCount`, `bookingCount`, `availabilitySlotCount`, `invalidSyntheticTutorCount`,
`invalidTutorProfileCount`, unknown listing IDs, and invalid listing relationships. Assert stable,
non-sensitive invariant names such as `student-user`, `booking-row`, and `seed-shape`.

Add an `already-migrated` schema case and verify formatting:

```ts
expect(formatClerkMigrationPreflightResult({ state: 'rejected', invariant: 'booking-row' })).toBe(
  'S1-T07 Clerk migration preflight rejected: booking-row',
);
```

- [ ] **Step 2: Run the focused spec and observe the intended RED state**

Run:

```sh
pnpm --filter @hktutor/api test -- --runInBand clerk-migration-preflight.spec.ts
```

Expected: FAIL because `@/database/clerk-migration-preflight` does not exist.

- [ ] **Step 3: Implement the snapshot and result contracts**

Create these exact public shapes:

```ts
export type ClerkMigrationSchemaState = 'legacy' | 'clerk' | 'unexpected';

export interface ClerkMigrationSnapshot {
  schemaState: ClerkMigrationSchemaState;
  userCount: number;
  adminUserCount: number;
  tutorUserCount: number;
  studentUserCount: number;
  nonActiveUserCount: number;
  deletedUserCount: number;
  consentedUserCount: number;
  knownSyntheticTutorCount: number;
  invalidSyntheticTutorCount: number;
  tutorProfileCount: number;
  invalidTutorProfileCount: number;
  teachingListingCount: number;
  knownTeachingListingCount: number;
  invalidTeachingListingRelationCount: number;
  availabilitySlotCount: number;
  bookingCount: number;
}

export type ClerkMigrationPreflightResult =
  | { state: 'empty' | 's1-t14-seed' | 's1-t20-seed' | 'already-migrated' }
  | { state: 'rejected'; invariant: string };
```

Implement deterministic rejection order: unexpected schema, student, non-active/deleted, consent,
Booking, AvailabilitySlot, invalid fixed fixture, invalid profile, invalid listing relationship, then
overall seed shape. Accept `clerk` as `already-migrated`; accept only the three exact legacy shapes
defined in the spec.

- [ ] **Step 4: Run the focused spec and observe GREEN**

Run the focused Jest command from Step 2.

Expected: all classifier and formatter cases PASS with no console output.

- [ ] **Step 5: Commit the classifier slice**

```sh
git add apps/api/src/database/clerk-migration-preflight.ts apps/api/src/database/clerk-migration-preflight.spec.ts
git commit -m "feat(db): classify Clerk migration preflight state"
```

## Task 2: Add the Read-Only Database Preflight Command

**Files:**

- Modify: `apps/api/src/database/clerk-migration-preflight.ts`
- Modify: `apps/api/src/database/clerk-migration-preflight.spec.ts`
- Create: `apps/api/prisma/preflight-s1-t07-clerk.ts`
- Modify: `apps/api/package.json`
- Modify: `package.json`

**Interfaces:**

- Consumes: `ClerkMigrationSnapshot`, `classifyClerkMigrationSnapshot`, existing database URL normalization/validation, `PrismaPg`, and generated `PrismaClient`.
- Produces: `readClerkMigrationSnapshot(client): Promise<ClerkMigrationSnapshot>` and `runClerkMigrationPreflight(client): Promise<ClerkMigrationPreflightResult>`.
- Produces commands `pnpm --filter @hktutor/api db:preflight:s1-t07-clerk` and root `pnpm db:preflight:s1-t07-clerk`.

- [ ] **Step 1: Add failing adapter tests**

Define the minimal query client and test catalog routing with sequential mocks:

```ts
export interface ClerkMigrationQueryClient {
  $queryRawUnsafe<T = unknown>(query: string): Promise<T>;
}
```

Tests must prove:

- catalog columns `email` + `passwordHash` select the legacy aggregate query;
- catalog columns `clerkUserId` + `primaryEmail`, absence of `email` + `passwordHash`, and the
  `ClerkWebhookEvent` table return `already-migrated` without querying legacy columns;
- an unexpected column combination is rejected as `schema-state`;
- aggregate bigint/string driver values are normalized to finite non-negative numbers;
- malformed, negative, or non-integral counts reject as `snapshot-value`;
- the aggregate query may reference legacy identity columns only in static predicates and must not
  project or return raw `email`, `passwordHash`, or Clerk identity values.

- [ ] **Step 2: Run the focused spec and verify RED**

Run:

```sh
pnpm --filter @hktutor/api test -- --runInBand clerk-migration-preflight.spec.ts
```

Expected: FAIL because the reader and runner exports do not exist.

- [ ] **Step 3: Implement catalog detection and the aggregate query**

Use one catalog query to distinguish `legacy`, `clerk`, and `unexpected`. For the legacy path, issue
one static SQL statement made only from checked-in fixture constants. It must return aggregate
counts and boolean mismatch counts; it must not return identity values.

The fixed synthetic tutor tuples are:

```text
20000000-0000-4000-8000-000000000001 | mali@s1t20.hktutor.invalid
20000000-0000-4000-8000-000000000002 | kiet@s1t20.hktutor.invalid
20000000-0000-4000-8000-000000000003 | niran@s1t20.hktutor.invalid
20000000-0000-4000-8000-000000000004 | pim@s1t20.hktutor.invalid
```

The fixed listing IDs are `10000000-0000-4000-8000-000000000001` through
`10000000-0000-4000-8000-000000000006`. Listings 1 and 6 belong to the dynamic foundation tutor;
listings 2 through 5 belong to Mali, Kiet, Niran, and Pim respectively.

Normalize database counts before classification and return only the result union.

- [ ] **Step 4: Add the CLI composition root and scripts**

Follow `apps/api/prisma/seed.ts`: load root/local `.env`, validate and normalize `DATABASE_URL`, create
`PrismaClient` with `PrismaPg`, run the preflight, print only
`formatClerkMigrationPreflightResult(result)`, set exit code 1 for `rejected`, and disconnect in
`finally`.

Add to `apps/api/package.json`:

```json
"db:preflight:s1-t07-clerk": "tsx prisma/preflight-s1-t07-clerk.ts"
```

Add to root `package.json`:

```json
"db:preflight:s1-t07-clerk": "pnpm --filter @hktutor/api db:preflight:s1-t07-clerk"
```

- [ ] **Step 5: Verify the command slice**

Run:

```sh
pnpm --filter @hktutor/api test -- --runInBand clerk-migration-preflight.spec.ts
pnpm db:generate
pnpm --filter @hktutor/api lint
```

Expected: focused tests PASS, Prisma generation succeeds, and API lint reports zero warnings. Do not
run the preflight CLI because the configured URL may target shared Supabase.

- [ ] **Step 6: Commit the read-only preflight command**

```sh
git add package.json apps/api/package.json apps/api/prisma/preflight-s1-t07-clerk.ts apps/api/src/database/clerk-migration-preflight.ts apps/api/src/database/clerk-migration-preflight.spec.ts
git commit -m "feat(db): add Clerk migration preflight"
```

## Task 3: Add the Guarded Forward-Only Migration

**Files:**

- Create: `tests/clerk-user-migration.test.mjs`
- Create: `apps/api/prisma/migrations/20260901160000_migrate_user_identity_to_clerk/migration.sql`
- Read without modification: `apps/api/prisma/migrations/20260830120000_add_user_role_foundation/migration.sql`

**Interfaces:**

- Consumes: the exact accepted seed shapes and fixture constants from Tasks 1-2.
- Produces: the deployed database shape required by `apps/api/prisma/schema.prisma`.
- Produces stable database names `User_clerkUserId_key`, `User_active_primaryEmail_key`,
  `ClerkWebhookStatus`, `ClerkWebhookEvent`, and `ClerkWebhookEvent_clerkUserId_idx`.

- [ ] **Step 1: Write the migration contract test before creating SQL**

The root Node test must locate exactly one directory ending `_migrate_user_identity_to_clerk` and
assert:

```js
assert.match(sql, /^BEGIN;/i);
assert.match(sql, /LOCK TABLE[\s\S]*"Booking"[\s\S]*"User"[\s\S]*ACCESS EXCLUSIVE/i);
assert.ok(sql.indexOf('RAISE EXCEPTION') < sql.indexOf('DELETE FROM "Booking"'));
assert.deepEqual(
  [...sql.matchAll(/DELETE FROM "([^"]+)"/g)].map((match) => match[1]),
  ['Booking', 'AvailabilitySlot', 'TeachingListing', 'TutorProfile', 'User'],
);
assert.doesNotMatch(sql, /TRUNCATE|DROP\s+TABLE/i);
assert.match(sql, /ALTER TABLE "User" RENAME COLUMN "email" TO "primaryEmail"/i);
assert.match(sql, /ALTER COLUMN "primaryEmail" DROP NOT NULL/i);
assert.match(sql, /DROP COLUMN "passwordHash"/i);
assert.match(sql, /ADD COLUMN "clerkUserId" TEXT NOT NULL/i);
assert.match(sql, /CREATE UNIQUE INDEX "User_clerkUserId_key"/i);
assert.match(
  sql,
  /CREATE UNIQUE INDEX "User_active_primaryEmail_key"[\s\S]*WHERE[\s\S]*"primaryEmail" IS NOT NULL[\s\S]*"accountStatus" = 'active'[\s\S]*"deletedAt" IS NULL/i,
);
assert.match(sql, /CREATE TYPE "ClerkWebhookStatus" AS ENUM \('processed', 'failed'\)/i);
assert.match(sql, /CREATE TABLE "ClerkWebhookEvent"/i);
assert.match(sql, /CREATE INDEX "ClerkWebhookEvent_clerkUserId_idx"/i);
assert.match(sql, /COMMIT;\s*$/i);
```

Also assert all fixed synthetic tutor/listing UUIDs occur in the guard, student/Booking/Availability
rejections exist, consent is rejected, and no `INSERT INTO`, real Clerk ID, connection string,
`Subject` deletion, or `GradeLevel` deletion appears. The focused git diff command in Step 4 proves
the historical migration file is unchanged.

- [ ] **Step 2: Run the repository contract and observe RED**

Run:

```sh
node --test tests/clerk-user-migration.test.mjs
```

Expected: FAIL with `Clerk identity migration must exist exactly once`.

- [ ] **Step 3: Write the guarded migration**

Create one migration containing this ordered structure:

```sql
BEGIN;

LOCK TABLE "Booking", "AvailabilitySlot", "TeachingListing", "TutorProfile", "User"
IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
    user_count BIGINT;
    admin_count BIGINT;
    tutor_count BIGINT;
    profile_count BIGINT;
    listing_count BIGINT;
    known_synthetic_tutor_count BIGINT;
    invalid_synthetic_tutor_count BIGINT;
    invalid_profile_count BIGINT;
    known_listing_count BIGINT;
    invalid_listing_relation_count BIGINT;
BEGIN
    IF EXISTS (SELECT 1 FROM "User" WHERE "role" = 'student') THEN
        RAISE EXCEPTION 'S1-T07 Clerk migration rejected: student-user';
    END IF;
    IF EXISTS (
        SELECT 1 FROM "User"
        WHERE "accountStatus" <> 'active' OR "deletedAt" IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'S1-T07 Clerk migration rejected: account-state';
    END IF;
    IF EXISTS (
        SELECT 1 FROM "User"
        WHERE "consentAcceptedAt" IS NOT NULL OR "policyVersion" IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'S1-T07 Clerk migration rejected: consent-data';
    END IF;
    IF EXISTS (SELECT 1 FROM "Booking") THEN
        RAISE EXCEPTION 'S1-T07 Clerk migration rejected: booking-row';
    END IF;
    IF EXISTS (SELECT 1 FROM "AvailabilitySlot") THEN
        RAISE EXCEPTION 'S1-T07 Clerk migration rejected: availability-slot-row';
    END IF;

    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE "role" = 'admin'),
        COUNT(*) FILTER (WHERE "role" = 'tutor')
    INTO user_count, admin_count, tutor_count
    FROM "User";

    SELECT COUNT(*)
    INTO known_synthetic_tutor_count
    FROM "User"
    WHERE "role" = 'tutor'
      AND (
        ("id" = '20000000-0000-4000-8000-000000000001'::uuid AND "email" = 'mali@s1t20.hktutor.invalid') OR
        ("id" = '20000000-0000-4000-8000-000000000002'::uuid AND "email" = 'kiet@s1t20.hktutor.invalid') OR
        ("id" = '20000000-0000-4000-8000-000000000003'::uuid AND "email" = 'niran@s1t20.hktutor.invalid') OR
        ("id" = '20000000-0000-4000-8000-000000000004'::uuid AND "email" = 'pim@s1t20.hktutor.invalid')
      );

    SELECT COUNT(*)
    INTO invalid_synthetic_tutor_count
    FROM "User"
    WHERE (
        "id" IN (
          '20000000-0000-4000-8000-000000000001'::uuid,
          '20000000-0000-4000-8000-000000000002'::uuid,
          '20000000-0000-4000-8000-000000000003'::uuid,
          '20000000-0000-4000-8000-000000000004'::uuid
        )
        OR "email" IN (
          'mali@s1t20.hktutor.invalid',
          'kiet@s1t20.hktutor.invalid',
          'niran@s1t20.hktutor.invalid',
          'pim@s1t20.hktutor.invalid'
        )
      )
      AND NOT (
        "role" = 'tutor'
        AND (
          ("id" = '20000000-0000-4000-8000-000000000001'::uuid AND "email" = 'mali@s1t20.hktutor.invalid') OR
          ("id" = '20000000-0000-4000-8000-000000000002'::uuid AND "email" = 'kiet@s1t20.hktutor.invalid') OR
          ("id" = '20000000-0000-4000-8000-000000000003'::uuid AND "email" = 'niran@s1t20.hktutor.invalid') OR
          ("id" = '20000000-0000-4000-8000-000000000004'::uuid AND "email" = 'pim@s1t20.hktutor.invalid')
        )
      );

    SELECT COUNT(*)
    INTO profile_count
    FROM "TutorProfile";

    SELECT COUNT(*)
    INTO invalid_profile_count
    FROM "TutorProfile" AS profile
    JOIN "User" AS owner ON owner."id" = profile."userId"
    WHERE owner."role" <> 'tutor';

    SELECT COUNT(*)
    INTO listing_count
    FROM "TeachingListing";

    SELECT COUNT(*)
    INTO known_listing_count
    FROM "TeachingListing"
    WHERE "id" IN (
      '10000000-0000-4000-8000-000000000001'::uuid,
      '10000000-0000-4000-8000-000000000002'::uuid,
      '10000000-0000-4000-8000-000000000003'::uuid,
      '10000000-0000-4000-8000-000000000004'::uuid,
      '10000000-0000-4000-8000-000000000005'::uuid,
      '10000000-0000-4000-8000-000000000006'::uuid
    );

    SELECT COUNT(*)
    INTO invalid_listing_relation_count
    FROM "TeachingListing"
    WHERE
      ("id" IN (
        '10000000-0000-4000-8000-000000000001'::uuid,
        '10000000-0000-4000-8000-000000000006'::uuid
      ) AND "tutorProfileId" IN (
        '20000000-0000-4000-8000-000000000001'::uuid,
        '20000000-0000-4000-8000-000000000002'::uuid,
        '20000000-0000-4000-8000-000000000003'::uuid,
        '20000000-0000-4000-8000-000000000004'::uuid
      ))
      OR ("id" = '10000000-0000-4000-8000-000000000002'::uuid AND "tutorProfileId" <> '20000000-0000-4000-8000-000000000001'::uuid)
      OR ("id" = '10000000-0000-4000-8000-000000000003'::uuid AND "tutorProfileId" <> '20000000-0000-4000-8000-000000000002'::uuid)
      OR ("id" = '10000000-0000-4000-8000-000000000004'::uuid AND "tutorProfileId" <> '20000000-0000-4000-8000-000000000003'::uuid)
      OR ("id" = '10000000-0000-4000-8000-000000000005'::uuid AND "tutorProfileId" <> '20000000-0000-4000-8000-000000000004'::uuid);

    IF invalid_synthetic_tutor_count <> 0
       OR invalid_profile_count <> 0
       OR invalid_listing_relation_count <> 0 THEN
        RAISE EXCEPTION 'S1-T07 Clerk migration rejected: seed-shape';
    END IF;

    IF NOT (
      (user_count = 0 AND admin_count = 0 AND tutor_count = 0
        AND profile_count = 0 AND listing_count = 0
        AND known_synthetic_tutor_count = 0 AND known_listing_count = 0)
      OR
      (user_count = 2 AND admin_count = 1 AND tutor_count = 1
        AND profile_count = 1 AND listing_count = 0
        AND known_synthetic_tutor_count = 0 AND known_listing_count = 0)
      OR
      (user_count = 6 AND admin_count = 1 AND tutor_count = 5
        AND profile_count = 5 AND listing_count = 6
        AND known_synthetic_tutor_count = 4 AND known_listing_count = 6)
    ) THEN
        RAISE EXCEPTION 'S1-T07 Clerk migration rejected: seed-shape';
    END IF;
END
$$;

DELETE FROM "Booking";
DELETE FROM "AvailabilitySlot";
DELETE FROM "TeachingListing";
DELETE FROM "TutorProfile";
DELETE FROM "User";

DROP INDEX "User_email_key";
ALTER TABLE "User" RENAME COLUMN "email" TO "primaryEmail";
ALTER TABLE "User" ALTER COLUMN "primaryEmail" DROP NOT NULL;
ALTER TABLE "User" DROP COLUMN "passwordHash";
ALTER TABLE "User" ADD COLUMN "clerkUserId" TEXT NOT NULL;

CREATE UNIQUE INDEX "User_clerkUserId_key" ON "User"("clerkUserId");
CREATE UNIQUE INDEX "User_active_primaryEmail_key" ON "User"("primaryEmail")
WHERE "primaryEmail" IS NOT NULL
  AND "accountStatus" = 'active'
  AND "deletedAt" IS NULL;

CREATE TYPE "ClerkWebhookStatus" AS ENUM ('processed', 'failed');
CREATE TABLE "ClerkWebhookEvent" (
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "clerkUserId" TEXT NOT NULL,
    "status" "ClerkWebhookStatus" NOT NULL,
    "processedAt" TIMESTAMPTZ(3) NOT NULL,
    "payloadHash" TEXT,
    CONSTRAINT "ClerkWebhookEvent_pkey" PRIMARY KEY ("eventId")
);
CREATE INDEX "ClerkWebhookEvent_clerkUserId_idx"
ON "ClerkWebhookEvent"("clerkUserId");

COMMIT;
```

- [ ] **Step 4: Verify the migration contract is GREEN**

Run:

```sh
node --test tests/clerk-user-migration.test.mjs
pnpm db:validate
git diff --exit-code 7e93671 -- apps/api/prisma/migrations/20260830120000_add_user_role_foundation/migration.sql
```

Expected: the new contract passes, Prisma validates, and the historical migration diff is empty.

- [ ] **Step 5: Commit the migration slice**

```sh
git add tests/clerk-user-migration.test.mjs apps/api/prisma/migrations/20260901160000_migrate_user_identity_to_clerk/migration.sql
git commit -m "feat(db): migrate seed users to Clerk schema"
```

## Task 4: Rehearse the Migration on Disposable PostgreSQL

**Files:**

- Create: `tests/fixtures/clerk-migration/s1-t14.sql`
- Create: `tests/fixtures/clerk-migration/s1-t20.sql`
- Modify: `tests/clerk-user-migration.test.mjs`
- Test: `apps/api/prisma/migrations/20260901160000_migrate_user_identity_to_clerk/migration.sql`
- Test: all earlier `apps/api/prisma/migrations/*/migration.sql`
- Test: current `apps/api/prisma/seed.ts`

**Interfaces:**

- Consumes: Docker PostgreSQL 18 and local `psql` 18; both are available in the development host.
- Produces: reviewed historical fixtures and recorded terminal evidence for empty, S1-T14, S1-T20,
  and rejection scenarios.

- [ ] **Step 1: Add failing fixture contracts**

Extend `tests/clerk-user-migration.test.mjs` to read both fixture files. Assert that S1-T14 inserts
exactly two `User` rows and one `TutorProfile`, while S1-T20 inserts six users, five profiles, and six
listings. Assert both fixtures use `passwordHash`, do not mention `clerkUserId`, and contain no
student, Booking, or AvailabilitySlot row.

Run:

```sh
node --test tests/clerk-user-migration.test.mjs
```

Expected: FAIL with `ENOENT` for the first missing fixture.

- [ ] **Step 2: Create the canonical historical fixtures**

Create `s1-t14.sql` with this seed shape:

```sql
INSERT INTO "User" (
  "id", "email", "passwordHash", "role", "accountStatus", "createdAt", "updatedAt"
) VALUES
  ('30000000-0000-4000-8000-000000000001', 'admin@legacy-seed.test', 'legacy-seed-hash', 'admin', 'active', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z'),
  ('30000000-0000-4000-8000-000000000002', 'tutor@legacy-seed.test', 'legacy-seed-hash', 'tutor', 'active', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');

INSERT INTO "TutorProfile" (
  "userId", "displayName", "bio", "experienceYears", "verificationStatus",
  "reviewCount", "createdAt", "updatedAt"
) VALUES (
  '30000000-0000-4000-8000-000000000002', 'Anan',
  'Verified tutor seeded for disposable migration testing.', 5, 'verified', 0,
  '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z'
);

INSERT INTO "Subject" ("id", "code", "name", "active", "createdAt", "updatedAt")
VALUES ('40000000-0000-4000-8000-000000000001', 'mathematics', 'Mathematics', true, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');

INSERT INTO "GradeLevel" ("id", "code", "name", "sortOrder", "active", "createdAt", "updatedAt")
VALUES ('50000000-0000-4000-8000-000000000001', 'grade-10', 'Grade 10', 10, true, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');
```

Create `s1-t20.sql` by including the same two dynamic users, foundation profile, Mathematics subject,
and Grade 10 rows, then add these exact fixture identities:

```sql
INSERT INTO "User" (
  "id", "email", "passwordHash", "role", "accountStatus", "createdAt", "updatedAt"
) VALUES
  ('20000000-0000-4000-8000-000000000001', 'mali@s1t20.hktutor.invalid', 'legacy-seed-hash', 'tutor', 'active', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z'),
  ('20000000-0000-4000-8000-000000000002', 'kiet@s1t20.hktutor.invalid', 'legacy-seed-hash', 'tutor', 'active', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z'),
  ('20000000-0000-4000-8000-000000000003', 'niran@s1t20.hktutor.invalid', 'legacy-seed-hash', 'tutor', 'active', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z'),
  ('20000000-0000-4000-8000-000000000004', 'pim@s1t20.hktutor.invalid', 'legacy-seed-hash', 'tutor', 'active', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');
```

Append the remaining S1-T20 rows:

```sql
INSERT INTO "TutorProfile" (
  "userId", "displayName", "bio", "experienceYears", "verificationStatus",
  "ratingAverage", "reviewCount", "ratingUpdatedAt", "createdAt", "updatedAt"
) VALUES
  ('20000000-0000-4000-8000-000000000001', 'Mali', 'Mathematics tutor fixture for lowest-price search cases.', 4, 'verified', 4.40, 18, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z'),
  ('20000000-0000-4000-8000-000000000002', 'Kiet', 'Mathematics tutor fixture for inclusive budget boundary cases.', 3, 'verified', 4.00, 10, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z'),
  ('20000000-0000-4000-8000-000000000003', 'Niran', 'Physics tutor fixture for subject mismatch search cases.', 6, 'verified', 4.70, 12, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z'),
  ('20000000-0000-4000-8000-000000000004', 'Pim', 'Grade 11 mathematics tutor fixture for grade mismatch cases.', 5, 'verified', 4.60, 15, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');

UPDATE "TutorProfile"
SET "ratingAverage" = 4.80, "reviewCount" = 24, "ratingUpdatedAt" = '2026-09-01T00:00:00Z'
WHERE "userId" = '30000000-0000-4000-8000-000000000002';

INSERT INTO "Subject" ("id", "code", "name", "active", "createdAt", "updatedAt")
VALUES ('40000000-0000-4000-8000-000000000002', 'physics', 'Physics', true, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');

INSERT INTO "GradeLevel" ("id", "code", "name", "sortOrder", "active", "createdAt", "updatedAt")
VALUES ('50000000-0000-4000-8000-000000000002', 'grade-11', 'Grade 11', 11, true, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');

INSERT INTO "TeachingListing" (
  "id", "tutorProfileId", "subjectId", "gradeLevelId", "pricePerHour", "description",
  "publicationStatus", "publishedAt", "createdAt", "updatedAt"
) VALUES
  ('10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 400, 'Published Mathematics Grade 10 listing for exact-match search cases.', 'published', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z'),
  ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 350, 'Published Mathematics Grade 10 listing for lowest-price cases.', 'published', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z'),
  ('10000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 500, 'Published Mathematics Grade 10 listing at the inclusive budget boundary.', 'published', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z'),
  ('10000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000001', 400, 'Published Physics Grade 10 listing for subject mismatch cases.', 'published', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z'),
  ('10000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000004', '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000002', 450, 'Published Mathematics Grade 11 listing for grade mismatch cases.', 'published', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z'),
  ('10000000-0000-4000-8000-000000000006', '30000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 300, 'Draft Mathematics Grade 10 listing that must stay out of public search.', 'draft', NULL, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');
```

Run the fixture contract again. Expected: PASS.

- [ ] **Step 3: Start a disposable PostgreSQL container with a unique explicit name**

Run:

```sh
docker run --rm --detach --name hktutor-s1-t07-clerk-migration-test -e POSTGRES_PASSWORD=hktutor_test_only -p 55432:5432 postgres:18-alpine
docker exec hktutor-s1-t07-clerk-migration-test pg_isready -U postgres
```

Expected: the container reports `accepting connections`. If the image is absent, obtain approval for
the Docker image download. Never substitute the configured `DATABASE_URL`.

- [ ] **Step 4: Rehearse the empty database path**

Set only the disposable URL for each command:

```sh
DATABASE_URL=postgresql://postgres:hktutor_test_only@127.0.0.1:55432/postgres pnpm db:migrate:deploy
DATABASE_URL=postgresql://postgres:hktutor_test_only@127.0.0.1:55432/postgres pnpm db:migrate:status
```

Expected: all migrations apply, status is up to date, `User` has Clerk columns, and no demo rows
exist. Drop and recreate only this disposable container before the next scenario.

- [ ] **Step 5: Rehearse canonical S1-T14 and S1-T20 paths**

For each scenario, create a fresh database inside the disposable container and apply the five
historical migrations in order:

```sh
docker exec hktutor-s1-t07-clerk-migration-test createdb -U postgres hktutor_s1t14
psql postgresql://postgres:hktutor_test_only@127.0.0.1:55432/hktutor_s1t14 -X -v ON_ERROR_STOP=1 -f apps/api/prisma/migrations/20260830000000_enable_required_extensions/migration.sql
psql postgresql://postgres:hktutor_test_only@127.0.0.1:55432/hktutor_s1t14 -X -v ON_ERROR_STOP=1 -f apps/api/prisma/migrations/20260830120000_add_user_role_foundation/migration.sql
psql postgresql://postgres:hktutor_test_only@127.0.0.1:55432/hktutor_s1t14 -X -v ON_ERROR_STOP=1 -f apps/api/prisma/migrations/20260831090000_add_tutor_profile_listing_foundation/migration.sql
psql postgresql://postgres:hktutor_test_only@127.0.0.1:55432/hktutor_s1t14 -X -v ON_ERROR_STOP=1 -f apps/api/prisma/migrations/20260831120000_add_availability_slot_foundation/migration.sql
psql postgresql://postgres:hktutor_test_only@127.0.0.1:55432/hktutor_s1t14 -X -v ON_ERROR_STOP=1 -f apps/api/prisma/migrations/20260901120000_add_booking_foundation/migration.sql
psql postgresql://postgres:hktutor_test_only@127.0.0.1:55432/hktutor_s1t14 -X -v ON_ERROR_STOP=1 -f tests/fixtures/clerk-migration/s1-t14.sql
psql postgresql://postgres:hktutor_test_only@127.0.0.1:55432/hktutor_s1t14 -X -v ON_ERROR_STOP=1 -f apps/api/prisma/migrations/20260901160000_migrate_user_identity_to_clerk/migration.sql
```

Repeat with database name `hktutor_s1t20` and fixture `s1-t20.sql`.

Expected for both: migration commits, identity-related tables are empty, `Subject` and `GradeLevel`
counts are unchanged, and the Clerk columns/indexes/table exist.

- [ ] **Step 6: Prove fail-closed behavior**

From a fresh historical S1-T14 or S1-T20 fixture database, create each rejected state with one of
these exact statements before running the new migration:

```sql
UPDATE "User" SET "role" = 'student' WHERE "id" = '30000000-0000-4000-8000-000000000001';

INSERT INTO "AvailabilitySlot" ("id", "tutorProfileId", "startAtUtc", "endAtUtc", "createdAt")
VALUES ('60000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', '2026-09-02T09:00:00Z', '2026-09-02T10:00:00Z', '2026-09-01T00:00:00Z');

INSERT INTO "Booking" (
  "id", "studentUserId", "tutorProfileId", "listingId", "slotId", "status",
  "subtotalAmount", "discountAmount", "netAmount", "currency", "createdAt", "updatedAt"
) VALUES (
  '70000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001',
  '60000000-0000-4000-8000-000000000001', 'completed', 400, 0, 400, 'THB',
  '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z'
);

INSERT INTO "User" ("id", "email", "passwordHash", "role", "accountStatus", "createdAt", "updatedAt")
VALUES ('30000000-0000-4000-8000-000000000003', 'unknown@legacy-seed.test', 'legacy-seed-hash', 'tutor', 'active', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');

INSERT INTO "TutorProfile" ("userId", "displayName", "bio", "experienceYears", "verificationStatus", "reviewCount", "createdAt", "updatedAt")
VALUES ('30000000-0000-4000-8000-000000000001', 'Unexpected', 'Unexpected administrator-owned tutor profile.', 1, 'verified', 0, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');

UPDATE "TeachingListing"
SET "id" = '10000000-0000-4000-8000-000000000007'
WHERE "id" = '10000000-0000-4000-8000-000000000006';

UPDATE "TeachingListing"
SET "tutorProfileId" = '20000000-0000-4000-8000-000000000002'
WHERE "id" = '10000000-0000-4000-8000-000000000002';
```

Use a fresh database per statement; the Booking case includes the AvailabilitySlot statement first.
Capture the pre-migration `User` count, run the migration with `psql -v ON_ERROR_STOP=1`, and query
the legacy columns afterward.

Expected: every scenario exits non-zero with its stable invariant, retains the original row count,
retains `email` and `passwordHash`, and has no `clerkUserId` column or webhook table.

- [ ] **Step 7: Prove current seed idempotency after migration**

Against a freshly migrated disposable database, provide test-only Clerk mappings and run:

```sh
DATABASE_URL=postgresql://postgres:hktutor_test_only@127.0.0.1:55432/postgres SEED_ADMIN_CLERK_USER_ID=user_disposable_admin SEED_ADMIN_EMAIL=admin@disposable.test SEED_TUTOR_CLERK_USER_ID=user_disposable_tutor SEED_TUTOR_EMAIL=tutor@disposable.test pnpm db:seed
DATABASE_URL=postgresql://postgres:hktutor_test_only@127.0.0.1:55432/postgres SEED_ADMIN_CLERK_USER_ID=user_disposable_admin SEED_ADMIN_EMAIL=admin@disposable.test SEED_TUTOR_CLERK_USER_ID=user_disposable_tutor SEED_TUTOR_EMAIL=tutor@disposable.test pnpm db:seed
```

Expected: both runs succeed and aggregate counts remain stable after the second run.

- [ ] **Step 8: Commit fixture evidence and remove the disposable container**

Run:

```sh
docker stop hktutor-s1-t07-clerk-migration-test
```

Expected: Docker removes the container because it was created with `--rm`. No shared database was
accessed.

Commit the fixture slice:

```sh
git add tests/clerk-user-migration.test.mjs tests/fixtures/clerk-migration/s1-t14.sql tests/fixtures/clerk-migration/s1-t20.sql
git commit -m "test(db): add Clerk migration rehearsal fixtures"
```

## Task 5: Document the Reviewed Deployment Checkpoint

**Files:**

- Modify: `README.md`
- Modify: `apps/api/README.md`
- Test: `tests/clerk-user-migration.test.mjs`

**Interfaces:**

- Consumes: the preflight command and migration from Tasks 2-3.
- Produces: the exact post-merge `status -> preflight -> deploy -> seed -> seed -> status` runbook.

- [ ] **Step 1: Add a failing documentation contract**

Extend the root migration test to require both README files to name:

```text
pnpm db:migrate:status
pnpm db:preflight:s1-t07-clerk
pnpm db:migrate:deploy
pnpm db:seed
pnpm db:seed
pnpm db:migrate:status
```

Require the surrounding text to state that shared deployment needs separate approval, preflight
must accept only a recognized seed state, `Subject`/`GradeLevel` are preserved, identity demo rows
are purged/reseeded, failures stop without reset, and no secret/identity values are printed.

- [ ] **Step 2: Run the documentation contract and verify RED**

Run:

```sh
node --test tests/clerk-user-migration.test.mjs
```

Expected: FAIL because the README files still say the follow-up migration is pending.

- [ ] **Step 3: Update the root and API runbooks**

Replace the schema-only warning with the reviewed migration state while retaining the prohibition on
shared writes before approval. Add the exact six-command block, accepted preflight states, purge
scope, failure recovery, and statement that shared Supabase remains untouched by this PR.

- [ ] **Step 4: Verify documentation and formatting**

Run:

```sh
node --test tests/clerk-user-migration.test.mjs
node_modules/.bin/prettier --check README.md apps/api/README.md tests/clerk-user-migration.test.mjs
```

Expected: migration/documentation tests PASS and all files use Prettier formatting.

- [ ] **Step 5: Commit the runbook**

```sh
git add README.md apps/api/README.md tests/clerk-user-migration.test.mjs
git commit -m "docs: add Clerk migration checkpoint"
```

## Task 6: Final Verification and Review Handoff

**Files:**

- Verify: all files changed from `7e93671` through `HEAD`.
- Do not modify: shared Supabase or local `.env`.

**Interfaces:**

- Consumes: all implementation tasks.
- Produces: review-ready branch with evidence and no uncommitted changes.

- [ ] **Step 1: Run focused safety and history checks**

```sh
node --test tests/clerk-user-migration.test.mjs
pnpm --filter @hktutor/api test -- --runInBand clerk-migration-preflight.spec.ts
pnpm db:validate
git diff --exit-code 7e93671 -- apps/api/prisma/migrations/20260830120000_add_user_role_foundation/migration.sql
```

Expected: all focused checks pass and the historical migration has no diff.

- [ ] **Step 2: Run the complete local gate**

```sh
CI=true pnpm check
```

Expected: workspace contract tests, formatting, lint, API Jest tests, API build, and web build all
pass with zero failures.

- [ ] **Step 3: Audit destructive scope and secrets**

```sh
git diff --stat 7e93671..HEAD
git diff 7e93671..HEAD -- apps/api/prisma/schema.prisma apps/api/prisma/migrations tests apps/api/src/database package.json apps/api/package.json README.md apps/api/README.md
rg -n 'TRUNCATE|DROP\s+TABLE|DELETE\s+FROM\s+"(Subject|GradeLevel)"|postgres(ql)?://|sk_(live|test)|user_[A-Za-z0-9]{20,}' apps/api/prisma/migrations/20260901160000_migrate_user_identity_to_clerk apps/api/src/database/clerk-migration-preflight.ts tests/clerk-user-migration.test.mjs README.md apps/api/README.md -i
git status --short
```

Expected: only approved files changed; destructive scan has no out-of-scope match; any checked-in
fixture Clerk IDs are the short reserved `user_s1t20_*` values; status is clean after final commit.

- [ ] **Step 4: Commit any verification-only corrections**

If verification required a code or documentation correction, repeat its focused RED/GREEN cycle,
then commit only that correction with a message describing the actual change. If no correction was
needed, create no empty commit.

- [ ] **Step 5: Prepare the PR without applying shared state**

Push `feat/s1-t07-clerk-migration` and create a PR against `main` summarizing the guarded purge,
preflight, Clerk DDL, disposable rehearsal, and green verification. State explicitly that no shared
Supabase migration or seed was run and that deployment requires a separate approval after merge.
