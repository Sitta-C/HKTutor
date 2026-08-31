# S1-T17 Availability Slot Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Sprint 1 tutor availability persistence foundation so PostgreSQL stores UTC intervals, rejects invalid or overlapping active slots for one tutor, and accepts adjacent slots without introducing the S1-T18 API or S1-T23 booking model.

**Architecture:** Prisma defines one additive `AvailabilitySlot` model related to the existing S1-T14 `TutorProfile`. A hand-reviewed, forward-only PostgreSQL migration owns the row-order check and a partial GiST exclusion constraint because Prisma cannot represent exclusion constraints. Node contract tests pin both the Prisma surface and exact SQL invariants without requiring live credentials; shared Supabase is a separate post-merge approval checkpoint.

**Tech Stack:** Node.js 24.19.0, pnpm 11.19.0, Prisma 7.10.0, PostgreSQL/Supabase, `btree_gist`, Node test runner, Prettier, ESLint, Jest 30

**Spec:** `docs/superpowers/specs/2026-08-31-s1-t17-availability-slot-design.md`

## Global Constraints

- Work only in `/Users/testmacbook/projects/HKTutor/.worktrees/s1-t17-availability-slot` on branch `feat/s1-t17-availability-slot-schema`; do not alter the unrelated main checkout.
- Create exactly one domain model, `AvailabilitySlot`, plus the inverse `TutorProfile.availabilitySlots` relation.
- Do not add controllers, DTOs, services, guards, Swagger endpoints, Bangkok-time conversion, `Booking`, booking enums, review data, or UI.
- Do not add `updatedAt` or a stored `available`, `reserved`, `status`, or equivalent state field. S1-T18 will model an interval change as soft-delete plus create.
- Use UUID keys and `TIMESTAMPTZ(3)` for every timestamp. The column names `startAtUtc` and `endAtUtc` state the application contract; PostgreSQL stores instants.
- Use exact stable names: `AvailabilitySlot_pkey`, `AvailabilitySlot_time_order_check`, `AvailabilitySlot_no_overlap_excl`, `AvailabilitySlot_tutorProfileId_startAtUtc_idx`, and `AvailabilitySlot_tutorProfileId_fkey`.
- Enforce `startAtUtc < endAtUtc` in PostgreSQL and use a partial half-open `[)` GiST exclusion constraint for non-deleted rows.
- Schema-qualify the UUID operator class as `extensions.gist_uuid_ops`; the S1-T04 migration already installs `btree_gist` in `extensions`.
- Use `ON DELETE RESTRICT ON UPDATE CASCADE` from `AvailabilitySlot.tutorProfileId` to `TutorProfile.userId`.
- Defer “new slots must be future” to S1-T18 because a `now()` row check is not a stable invariant.
- Defer “booked slots cannot be deleted” to S1-T18/S1-T23 because `Booking` does not exist yet.
- Do not add or run a seed for S1-T17.
- Never log `DATABASE_URL`, seed credentials, user emails, or generated UUID values during shared verification.
- Never run `prisma migrate reset`, `prisma db push`, or destructive migration recovery against shared Supabase.
- Do not deploy to shared Supabase until the pull request is reviewed, merged, and the user explicitly approves the deploy checkpoint.
- Follow RED-GREEN-REFACTOR and keep every local check independent of live database credentials.

---

## Execution prerequisites

- The isolated worktree and branch already exist from updated `origin/main` commit `7df135b`.
- The approved design is committed as `1ca998f docs: define S1-T17 availability slot design`.
- Baseline `pnpm install --frozen-lockfile` and `pnpm check` already passed before this plan was written.
- At execution time, first run `git status --short --branch`; stop if the worktree is not clean or the expected branch is not checked out.
- This branch owner is the only migration author for S1-T17. Do not regenerate or rename older migration directories.

### Task 1: Pin and implement the Prisma schema contract

**Files:**

- Create: `tests/availability-slot-foundation.test.mjs`
- Modify: `apps/api/prisma/schema.prisma`

**Interfaces:**

- Consumes: existing `TutorProfile.userId` from S1-T14.
- Produces: `AvailabilitySlot` and `TutorProfile.availabilitySlots` in the generated Prisma client.
- Does not produce: `Booking`, slot state, update semantics, or HTTP behavior.

- [ ] **Step 1: Write model-block helpers and the failing schema contract**

  Create `tests/availability-slot-foundation.test.mjs` with imports, constants, and a helper that limits assertions to a single Prisma model:

  ```js
  import assert from 'node:assert/strict';
  import fs from 'node:fs/promises';
  import path from 'node:path';
  import test from 'node:test';

  const schemaPath = 'apps/api/prisma/schema.prisma';
  const migrationsRoot = 'apps/api/prisma/migrations';
  const migrationSuffix = '_add_availability_slot_foundation';

  function readModel(schema, modelName) {
    const match = schema.match(new RegExp(`model ${modelName}\\s*{([\\s\\S]*?)\\n}`));
    assert.ok(match, `${modelName} model must exist`);
    return match[1];
  }

  test('defines the S1-T17 availability slot schema boundary', async () => {
    const schema = await fs.readFile(schemaPath, 'utf8');
    const tutorProfile = readModel(schema, 'TutorProfile');
    const slot = readModel(schema, 'AvailabilitySlot');

    assert.match(tutorProfile, /availabilitySlots\s+AvailabilitySlot\[\]/);
    assert.match(slot, /id\s+String\s+@id\s+@default\(uuid\(\)\)\s+@db\.Uuid/);
    assert.match(slot, /tutorProfileId\s+String\s+@db\.Uuid/);
    assert.match(slot, /startAtUtc\s+DateTime\s+@db\.Timestamptz\(3\)/);
    assert.match(slot, /endAtUtc\s+DateTime\s+@db\.Timestamptz\(3\)/);
    assert.match(slot, /createdAt\s+DateTime\s+@default\(now\(\)\)\s+@db\.Timestamptz\(3\)/);
    assert.match(slot, /deletedAt\s+DateTime\?\s+@db\.Timestamptz\(3\)/);
    assert.match(
      slot,
      /tutorProfile\s+TutorProfile\s+@relation\(fields:\s*\[tutorProfileId\],\s*references:\s*\[userId\],\s*onDelete:\s*Restrict,\s*onUpdate:\s*Cascade\)/,
    );
    assert.match(
      slot,
      /@@index\(\[tutorProfileId,\s*startAtUtc\],\s*map:\s*"AvailabilitySlot_tutorProfileId_startAtUtc_idx"\)/,
    );
    assert.doesNotMatch(slot, /\bupdatedAt\b/);
    assert.doesNotMatch(slot, /\b(status|state|available|reserved)\b/i);
    assert.doesNotMatch(schema, /model Booking\s*{/);
  });
  ```

- [ ] **Step 2: Run the focused contract and verify RED**

  ```sh
  node --test tests/availability-slot-foundation.test.mjs
  ```

  Expected: one failing test with `AvailabilitySlot model must exist`. A syntax error or missing-file error is not the intended RED and must be fixed before production edits.

- [ ] **Step 3: Add the minimal Prisma model and inverse relation**

  Add `availabilitySlots AvailabilitySlot[]` to `TutorProfile`, then append this exact model:

  ```prisma
  model AvailabilitySlot {
    id             String       @id @default(uuid()) @db.Uuid
    tutorProfileId String       @db.Uuid
    startAtUtc     DateTime     @db.Timestamptz(3)
    endAtUtc       DateTime     @db.Timestamptz(3)
    createdAt      DateTime     @default(now()) @db.Timestamptz(3)
    deletedAt      DateTime?    @db.Timestamptz(3)
    tutorProfile   TutorProfile @relation(fields: [tutorProfileId], references: [userId], onDelete: Restrict, onUpdate: Cascade)

    @@index([tutorProfileId, startAtUtc], map: "AvailabilitySlot_tutorProfileId_startAtUtc_idx")
  }
  ```

  Do not add a Prisma-only relation name, mapped table name, default slot state, `updatedAt`, or `Booking` relation.

- [ ] **Step 4: Generate, validate, and verify GREEN**

  ```sh
  pnpm db:generate
  pnpm db:validate
  node --test tests/availability-slot-foundation.test.mjs
  ```

  Expected: Prisma generation and validation exit 0; the focused Node suite reports one passing test.

- [ ] **Step 5: Commit the schema contract**

  ```sh
  git add apps/api/prisma/schema.prisma tests/availability-slot-foundation.test.mjs
  git commit -m "feat: define availability slot schema"
  ```

### Task 2: Pin and implement the forward-only database migration

**Files:**

- Modify: `tests/availability-slot-foundation.test.mjs`
- Create: `apps/api/prisma/migrations/20260831120000_add_availability_slot_foundation/migration.sql`

**Interfaces:**

- Consumes: existing `public.TutorProfile`, `extensions.btree_gist`, and `extensions.gist_uuid_ops`.
- Produces: one `AvailabilitySlot` table, one B-tree lookup index, one check constraint, one partial GiST exclusion constraint, and one foreign key.

- [ ] **Step 1: Add a migration loader and failing SQL contract**

  Add this helper below `readModel`:

  ```js
  async function readAvailabilitySlotMigration() {
    const entries = await fs.readdir(migrationsRoot, { withFileTypes: true });
    const migrations = entries
      .filter((entry) => entry.isDirectory() && entry.name.endsWith(migrationSuffix))
      .map((entry) => entry.name);

    assert.equal(migrations.length, 1, 'S1-T17 migration must exist exactly once');

    return fs.readFile(path.join(migrationsRoot, migrations[0], 'migration.sql'), 'utf8');
  }
  ```

  Add the migration contract:

  ```js
  test('adds the forward-only S1-T17 database invariants', async () => {
    const sql = await readAvailabilitySlotMigration();

    assert.equal(
      [...sql.matchAll(/CREATE TABLE/gi)].length,
      1,
      'S1-T17 migration must create exactly one table',
    );
    assert.match(sql, /CREATE TABLE "AvailabilitySlot"/i);
    assert.match(sql, /CONSTRAINT "AvailabilitySlot_pkey" PRIMARY KEY \("id"\)/i);
    assert.match(sql, /"startAtUtc"\s+TIMESTAMPTZ\(3\)\s+NOT NULL/i);
    assert.match(sql, /"endAtUtc"\s+TIMESTAMPTZ\(3\)\s+NOT NULL/i);
    assert.match(sql, /"createdAt"\s+TIMESTAMPTZ\(3\)\s+NOT NULL\s+DEFAULT CURRENT_TIMESTAMP/i);
    assert.match(sql, /"deletedAt"\s+TIMESTAMPTZ\(3\)/i);
    assert.match(
      sql,
      /CONSTRAINT "AvailabilitySlot_time_order_check"\s+CHECK\s*\(\s*"startAtUtc"\s*<\s*"endAtUtc"\s*\)/i,
    );
    assert.match(
      sql,
      /CONSTRAINT "AvailabilitySlot_no_overlap_excl"\s+EXCLUDE USING GIST\s*\(\s*"tutorProfileId"\s+extensions\.gist_uuid_ops\s+WITH\s+=,\s*tstzrange\(\s*"startAtUtc",\s*"endAtUtc",\s*'\[\)'\s*\)\s+WITH\s+&&\s*\)\s*WHERE\s*\(\s*"deletedAt"\s+IS\s+NULL\s*\)/i,
    );
    assert.match(
      sql,
      /CREATE INDEX "AvailabilitySlot_tutorProfileId_startAtUtc_idx"\s+ON "AvailabilitySlot"\s*\(\s*"tutorProfileId",\s*"startAtUtc"\s*\)/i,
    );
    assert.match(
      sql,
      /ADD CONSTRAINT "AvailabilitySlot_tutorProfileId_fkey"[\s\S]*FOREIGN KEY \("tutorProfileId"\)[\s\S]*REFERENCES "TutorProfile"\("userId"\)[\s\S]*ON DELETE RESTRICT ON UPDATE CASCADE/i,
    );
    assert.doesNotMatch(sql, /DROP\s+(TABLE|TYPE|COLUMN|CONSTRAINT|INDEX)/i);
    assert.doesNotMatch(sql, /CREATE\s+(TABLE|TYPE)\s+"?Booking/i);
    assert.doesNotMatch(sql, /\bINSERT\s+INTO\b/i);
    assert.doesNotMatch(sql, /\b(status|state|available|reserved)\b/i);
  });
  ```

- [ ] **Step 2: Run the focused contract and verify RED**

  ```sh
  node --test tests/availability-slot-foundation.test.mjs
  ```

  Expected: the schema test passes and the migration test fails with `S1-T17 migration must exist exactly once`.

- [ ] **Step 3: Add the hand-authored forward-only SQL migration**

  Create `apps/api/prisma/migrations/20260831120000_add_availability_slot_foundation/migration.sql` with this exact logical contract:

  ```sql
  CREATE TABLE "AvailabilitySlot" (
      "id" UUID NOT NULL,
      "tutorProfileId" UUID NOT NULL,
      "startAtUtc" TIMESTAMPTZ(3) NOT NULL,
      "endAtUtc" TIMESTAMPTZ(3) NOT NULL,
      "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "deletedAt" TIMESTAMPTZ(3),

      CONSTRAINT "AvailabilitySlot_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "AvailabilitySlot_time_order_check" CHECK ("startAtUtc" < "endAtUtc"),
      CONSTRAINT "AvailabilitySlot_no_overlap_excl" EXCLUDE USING GIST (
          "tutorProfileId" extensions.gist_uuid_ops WITH =,
          tstzrange("startAtUtc", "endAtUtc", '[)') WITH &&
      ) WHERE ("deletedAt" IS NULL)
  );

  CREATE INDEX "AvailabilitySlot_tutorProfileId_startAtUtc_idx"
  ON "AvailabilitySlot"("tutorProfileId", "startAtUtc");

  ALTER TABLE "AvailabilitySlot"
  ADD CONSTRAINT "AvailabilitySlot_tutorProfileId_fkey"
  FOREIGN KEY ("tutorProfileId") REFERENCES "TutorProfile"("userId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
  ```

  Do not run `prisma migrate dev`: this repository commits hand-reviewed SQL and the shared database is not a migration-generation target.

- [ ] **Step 4: Verify migration/schema alignment and GREEN**

  ```sh
  node --test tests/availability-slot-foundation.test.mjs
  pnpm db:generate
  pnpm db:validate
  ```

  Expected: two focused tests pass; Prisma generation and validation exit 0. This proves the static contract but does not claim the shared database has been changed.

- [ ] **Step 5: Commit the migration contract**

  ```sh
  git add apps/api/prisma/migrations/20260831120000_add_availability_slot_foundation/migration.sql tests/availability-slot-foundation.test.mjs
  git commit -m "feat: add availability slot migration"
  ```

### Task 3: Document ownership boundaries and the operator runbook

**Files:**

- Modify: `README.md`
- Modify: `apps/api/README.md`

**Interfaces:**

- Produces: a human-readable S1-T17 scope and exact review/deploy sequence.
- Records: no seed, no API, future-only deferred, booked-delete deferred, and regenerate-client requirement.

- [ ] **Step 1: Add the root S1-T17 section**

  Insert `## Availability slot foundation (S1-T17)` after the S1-T14 section and cover all of these facts explicitly:

  - slots belong to `TutorProfile` and store `startAtUtc`/`endAtUtc` as `TIMESTAMPTZ(3)`;
  - `startAtUtc < endAtUtc` is a database check;
  - the partial GiST exclusion rejects overlap only for rows whose `deletedAt` is null;
  - `[)` permits adjacent slots such as `18:00-19:00` and `19:00-20:00`;
  - the future-only rule belongs to S1-T18, while booked-slot deletion protection is completed with S1-T23;
  - S1-T17 has no seed and no stored availability state;
  - after pulling/merging, run `pnpm db:generate` so the generated client matches the schema;
  - shared deployment is only `status -> deploy -> status` after explicit approval.

  Include this exact command block:

  ```sh
  pnpm db:migrate:status
  pnpm db:migrate:deploy
  pnpm db:migrate:status
  ```

- [ ] **Step 2: Add the concise API-local note**

  Extend `apps/api/README.md` with the same ownership boundary and state that `pnpm db:seed` is intentionally absent from the S1-T17 checkpoint.

- [ ] **Step 3: Format and inspect only the documentation diff**

  ```sh
  pnpm exec prettier --write README.md apps/api/README.md
  git diff --check
  git diff -- README.md apps/api/README.md
  ```

  Expected: Prettier exits 0; no whitespace errors; the diff contains no credentials, seed changes, API claims, or instruction to reset the database.

- [ ] **Step 4: Commit the runbook**

  ```sh
  git add README.md apps/api/README.md
  git commit -m "docs: add availability slot migration runbook"
  ```

### Task 4: Verify the branch and prepare the review checkpoint

**Files:**

- Verify: all branch changes since `origin/main`
- Do not modify: `.env`, generated secrets, seed files, shared Supabase

- [ ] **Step 1: Run the focused quality gate**

  ```sh
  pnpm db:generate
  pnpm db:validate
  node --test tests/availability-slot-foundation.test.mjs
  ```

  Expected: generation and validation exit 0; exactly two S1-T17 contract tests pass.

- [ ] **Step 2: Run the full repository gate**

  ```sh
  pnpm check
  git diff --check origin/main...HEAD
  ```

  Expected: workspace contract tests, formatting, lint, Jest suites, and both builds pass; Git reports no whitespace errors.

- [ ] **Step 3: Perform the scope and secret review**

  ```sh
  git diff --name-status origin/main...HEAD
  git diff --stat origin/main...HEAD
  git status --short --branch
  git log --oneline origin/main..HEAD
  ```

  Expected changed paths are limited to the approved spec/plan, Prisma schema, one S1-T17 migration, one contract test, and the two README files. The worktree is clean. Inspect the diff and confirm:

  - no `.env` or credential-bearing file is tracked;
  - no seed file changed;
  - no `Booking`, controller, DTO, service, UI, or stored state was added;
  - no prior migration changed;
  - no destructive SQL exists;
  - all exact names from the spec are present once.

- [ ] **Step 4: Request code review before integration**

  Use `superpowers:requesting-code-review` against `origin/main...HEAD`. Resolve any valid finding with a new RED-GREEN cycle, rerun the focused and full gates, and commit the correction separately. Do not deploy the shared database during review.

- [ ] **Step 5: Stop at the push/PR approval gate**

  Report the branch name, commits, changed paths, and fresh verification evidence. Wait for the user's explicit instruction before `git push` or `gh pr create`.

### Task 5: Push and open the pull request after explicit approval

**Files:**

- No new production files expected.

- [ ] **Step 1: Reconfirm branch state**

  ```sh
  git status --short --branch
  git log --oneline origin/main..HEAD
  ```

  Expected: clean `feat/s1-t17-availability-slot-schema` with only reviewed S1-T17 commits.

- [ ] **Step 2: Push the feature branch**

  ```sh
  git push -u origin feat/s1-t17-availability-slot-schema
  ```

- [ ] **Step 3: Create the pull request against `main`**

  Use title `feat: add S1-T17 availability slot foundation`. The body must summarize the Prisma model, time-order check, partial half-open GiST exclusion, restrictive relation, contract tests, and operator docs. It must explicitly state: “Shared Supabase has not been changed. S1-T17 has no seed step.” Include the focused and full verification commands and their fresh results.

- [ ] **Step 4: Stop at the merge/deploy approval gate**

  Return the PR link and CI state. Do not merge the PR and do not run migration commands against shared Supabase unless the user separately confirms merge and explicitly approves deployment.

### Task 6: Deploy and verify shared Supabase after merge and explicit approval

**Files:**

- Create temporarily, then remove: `apps/api/prisma/verify-s1-t17.tmp.ts`
- Do not modify: tracked repository files or seed data

- [ ] **Step 1: Run migration preflight from updated `main`**

  Confirm the merged commit is present, regenerate the Prisma client, and run:

  ```sh
  pnpm db:generate
  pnpm db:migrate:status
  ```

  Expected: the history is consistent and only `20260831120000_add_availability_slot_foundation` is pending. Stop without deploying if Prisma reports drift, a reset request, an unexpected pending migration, a connection mismatch, or an unknown applied migration.

- [ ] **Step 2: Deploy only the reviewed migration**

  ```sh
  pnpm db:migrate:deploy
  pnpm db:migrate:status
  ```

  Expected: deploy exits 0 and final status reports the database schema is up to date. Do not run `pnpm db:seed`.

- [ ] **Step 3: Create a rollback-only verification probe**

  Create untracked `apps/api/prisma/verify-s1-t17.tmp.ts` with this exact rollback-only probe:

  ```ts
  import assert from 'node:assert/strict';
  import { randomUUID } from 'node:crypto';

  import { config as loadEnvironment } from 'dotenv';
  import { Client } from 'pg';

  import { normalizeDatabaseUrlForPg } from '../src/config/database-url';
  import { validateDatabaseEnvironment } from '../src/config/database.config';

  loadEnvironment({ path: '../../.env', quiet: true });
  loadEnvironment({ quiet: true });

  function databaseCode(error: unknown): string | undefined {
    return typeof error === 'object' && error !== null && 'code' in error
      ? String(error.code)
      : undefined;
  }

  async function requireDatabaseError(
    client: Client,
    savepoint: string,
    expectedCode: string,
    query: string,
    values: unknown[],
  ): Promise<void> {
    await client.query(`SAVEPOINT ${savepoint}`);

    try {
      await client.query(query, values);
      throw new Error(`Expected PostgreSQL error ${expectedCode}`);
    } catch (error) {
      if (databaseCode(error) !== expectedCode) {
        throw error;
      }
      await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    }
  }

  async function main(): Promise<void> {
    const environment = validateDatabaseEnvironment(process.env);
    const connectionString = normalizeDatabaseUrlForPg(environment['DATABASE_URL'] as string);
    const client = new Client({ connectionString });
    let transactionStarted = false;
    const probeIds = Array.from({ length: 5 }, () => randomUUID());
    const [baseId, adjacentId, overlapId, invertedId, replacementId] = probeIds;

    await client.connect();

    try {
      const constraints = await client.query<{ conname: string }>(`
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = '"AvailabilitySlot"'::regclass
        ORDER BY conname
      `);
      const indexes = await client.query<{ indexname: string }>(`
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = current_schema()
          AND tablename = 'AvailabilitySlot'
      `);
      const catalogNames = new Set([
        ...constraints.rows.map(({ conname }) => conname),
        ...indexes.rows.map(({ indexname }) => indexname),
      ]);
      const requiredNames = [
        'AvailabilitySlot_pkey',
        'AvailabilitySlot_time_order_check',
        'AvailabilitySlot_no_overlap_excl',
        'AvailabilitySlot_tutorProfileId_startAtUtc_idx',
        'AvailabilitySlot_tutorProfileId_fkey',
      ];
      assert.ok(requiredNames.every((name) => catalogNames.has(name)));
      console.info('catalog names: pass');

      const tutor = await client.query<{ userId: string }>(
        'SELECT "userId" FROM "TutorProfile" ORDER BY "createdAt" LIMIT 1',
      );
      assert.equal(tutor.rowCount, 1, 'S1-T14 tutor profile prerequisite is missing');
      const tutorProfileId = tutor.rows[0].userId;

      await client.query('BEGIN');
      transactionStarted = true;

      await client.query(
        `INSERT INTO "AvailabilitySlot"
          ("id", "tutorProfileId", "startAtUtc", "endAtUtc")
         VALUES ($1, $2, $3, $4)`,
        [baseId, tutorProfileId, '2099-01-01T11:00:00.000Z', '2099-01-01T12:00:00.000Z'],
      );
      await client.query(
        `INSERT INTO "AvailabilitySlot"
          ("id", "tutorProfileId", "startAtUtc", "endAtUtc")
         VALUES ($1, $2, $3, $4)`,
        [adjacentId, tutorProfileId, '2099-01-01T12:00:00.000Z', '2099-01-01T13:00:00.000Z'],
      );
      console.info('adjacent: pass');

      await requireDatabaseError(
        client,
        'overlap_probe',
        '23P01',
        `INSERT INTO "AvailabilitySlot"
          ("id", "tutorProfileId", "startAtUtc", "endAtUtc")
         VALUES ($1, $2, $3, $4)`,
        [overlapId, tutorProfileId, '2099-01-01T11:30:00.000Z', '2099-01-01T12:30:00.000Z'],
      );
      console.info('overlap: 23P01');

      await requireDatabaseError(
        client,
        'time_order_probe',
        '23514',
        `INSERT INTO "AvailabilitySlot"
          ("id", "tutorProfileId", "startAtUtc", "endAtUtc")
         VALUES ($1, $2, $3, $4)`,
        [invertedId, tutorProfileId, '2099-01-02T12:00:00.000Z', '2099-01-02T11:00:00.000Z'],
      );
      console.info('time order: 23514');

      await client.query(
        'UPDATE "AvailabilitySlot" SET "deletedAt" = CURRENT_TIMESTAMP WHERE "id" = $1',
        [baseId],
      );
      await client.query(
        `INSERT INTO "AvailabilitySlot"
          ("id", "tutorProfileId", "startAtUtc", "endAtUtc")
         VALUES ($1, $2, $3, $4)`,
        [replacementId, tutorProfileId, '2099-01-01T11:00:00.000Z', '2099-01-01T12:00:00.000Z'],
      );
      console.info('soft-delete replacement: pass');
    } finally {
      if (transactionStarted) {
        await client.query('ROLLBACK');
        const retained = await client.query<{ count: string }>(
          'SELECT count(*) FROM "AvailabilitySlot" WHERE "id" = ANY($1::uuid[])',
          [probeIds],
        );
        assert.equal(retained.rows[0].count, '0');
        console.info('rollback: pass');
      }
      await client.end();
    }
  }

  void main().catch(() => {
    console.error('availability verification: failed');
    process.exitCode = 1;
  });
  ```

  This probe uses the same environment loading, validation, and URL normalization as `apps/api/prisma/seed.ts`. It must:

  1. Read `pg_constraint` and `pg_indexes` and require the five exact S1-T17 names.
  2. Select one existing `TutorProfile.userId` without printing it.
  3. Begin a transaction and insert a base interval in year 2099.
  4. Insert an adjacent interval and require success.
  5. Use a savepoint, attempt an overlapping active interval, and require PostgreSQL code `23P01`; roll back to the savepoint.
  6. Use another savepoint, attempt an inverted interval, and require PostgreSQL code `23514`; roll back to the savepoint.
  7. Soft-delete the base interval and require a replacement overlapping that deleted interval to succeed.
  8. Always issue `ROLLBACK` in `finally`, disconnect, and print only invariant labels such as `catalog names: pass`, `adjacent: pass`, `overlap: 23P01`, `time order: 23514`, `soft-delete replacement: pass`, and `rollback: pass`.

  Generate probe UUIDs with `node:crypto.randomUUID()` and parameterize all values. Never print the connection string, tutor ID, email, or UUIDs. If no tutor profile exists, stop and report the missing S1-T14 prerequisite rather than inserting one.

- [ ] **Step 4: Run the probe from the API package context and remove it**

  ```sh
  pnpm --filter @hktutor/api exec tsx prisma/verify-s1-t17.tmp.ts
  ```

  Expected redacted evidence:

  ```text
  catalog names: pass
  adjacent: pass
  overlap: 23P01
  time order: 23514
  soft-delete replacement: pass
  rollback: pass
  ```

  Remove only `apps/api/prisma/verify-s1-t17.tmp.ts` after the rollback result is confirmed, then check `git status --short` to prove no verification artifact remains. Do not remove or rewrite tracked repository files.

- [ ] **Step 5: Perform final completion review**

  Confirm the merged PR and CI are green, migration status is up to date, catalog definitions match the exact names, the rollback probe left no rows, and no seed was run. Only then report S1-T17 as technically ready for `Done`; updating the workbook/task tracker remains a separate explicit user action.

## Acceptance-to-evidence map

| Requirement                            | Owner                     | Local evidence                                                | Shared evidence                         |
| -------------------------------------- | ------------------------- | ------------------------------------------------------------- | --------------------------------------- |
| UTC instant columns                    | Prisma + migration        | Schema and SQL contract; `db:validate`                        | Catalog column definitions after deploy |
| `startAtUtc < endAtUtc`                | PostgreSQL check          | Exact SQL assertion                                           | Rollback probe receives `23514`         |
| Same-tutor active overlap rejected     | Partial GiST exclusion    | Exact SQL assertion using `extensions.gist_uuid_ops` and `&&` | Rollback probe receives `23P01`         |
| Adjacent slots accepted                | Half-open `[)` range      | Exact SQL assertion                                           | Adjacent rollback insert succeeds       |
| Soft-deleted interval stops blocking   | `WHERE deletedAt IS NULL` | Exact SQL assertion                                           | Replacement rollback insert succeeds    |
| Tutor relation is restrictive          | Prisma + foreign key      | Schema/SQL contract                                           | Exact catalog name and definition       |
| No stored state, Booking, API, or seed | Scope boundary            | Negative contract assertions and diff review                  | No seed command at deploy checkpoint    |

## Approval gates

1. **Implementation:** approval authorizes Tasks 1-4 only in the isolated branch.
2. **Push/PR:** a separate explicit instruction authorizes Task 5.
3. **Shared deploy:** after merge, a separate explicit approval authorizes Task 6. S1-T17 never has a seed checkpoint.
