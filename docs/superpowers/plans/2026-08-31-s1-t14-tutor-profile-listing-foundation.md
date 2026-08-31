# S1-T14 Tutor Profile and Listing Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Sprint 1 tutor profile, canonical subject/grade catalog, and teaching listing database foundation, then seed one active verified tutor without taking over S1-T20 search fixtures.

**Architecture:** Prisma remains the schema contract and the migration owner commits one hand-reviewed, forward-only PostgreSQL migration. `TutorProfile` is a one-to-one extension of `User`; `TeachingListing` references canonical `Subject` and `GradeLevel` rows and carries rating-independent search fields. The seed runner is split into environment parsing, administrator seeding, and tutor-foundation seeding inside one transaction so S1-T20 can add listing/rating fixtures without duplicating credential or catalog logic.

**Tech Stack:** Node.js 24.19.0, pnpm 11.19.0, TypeScript 5.7, Prisma 7.10.0, PostgreSQL/Supabase, Argon2id, Jest 30, Node test runner

**Spec:** `HKTutor_overview.xlsx` — `Sprint 1 Backlog!E15:L15`, `Data Model!A5:H8`, `Data Model!A41:H44`, and `Product Backlog!A70:M70`

## Global Constraints

- S1-T14 depends on the merged S1-T07 `User` model even though the backlog lists only S1-T04.
- Create exactly `TutorProfile`, `Subject`, `GradeLevel`, and `TeachingListing`; do not create `AuthSession`, `AvailabilitySlot`, `Booking`, or `Review` in this task.
- Include `ratingAverage`, `reviewCount`, and `ratingUpdatedAt` on `TutorProfile`, but leave rating fixture values to S1-T20.
- Seed canonical Mathematics/Grade 10 catalog rows and one active verified tutor; do not seed a published listing or search/no-match fixtures in S1-T14.
- Preserve existing seeded user credentials on repeat runs and refuse to change an existing non-tutor account into a tutor.
- Use UUID keys, `TIMESTAMPTZ(3)` timestamps, `extensions.CITEXT` for case-insensitive catalog keys/names, and forward-only SQL.
- Enforce row-local invariants in PostgreSQL checks; defer “only a verified tutor may publish” to the transactional S1-T15 API because it crosses rows.
- Never log seed emails, plaintext passwords, password hashes, or `DATABASE_URL`.
- Never run `prisma migrate reset` against the shared Supabase project.
- Do not deploy the migration or run the new seed on shared Supabase until the PR is reviewed, merged, and the user explicitly approves that checkpoint.
- Follow RED-GREEN-REFACTOR for production behavior and keep `pnpm check` green without live database credentials.

---

## Execution prerequisites

- Create an isolated feature branch/worktree from updated `main` using `superpowers:using-git-worktrees`; proposed branch: `feat/s1-t14-tutor-profile-listing-schema`.
- Carry this approved plan file into that worktree and include it in the first feature commit; do not commit it on `main`.
- Confirm `git status --short`, `pnpm db:migrate:status`, and `pnpm check` before editing. Stop for migration drift, an unexpected history, or unrelated overlapping changes.
- Nominate this branch owner as the only migration author for the task.

### Task 1: Prisma tutor, catalog, and listing contract

**Files:**

- Create: `tests/tutor-profile-listing-foundation.test.mjs`
- Modify: `apps/api/prisma/schema.prisma`

**Interfaces:**

- Consumes: `User.id`, `Role.TUTOR`, `AccountStatus.ACTIVE`, PostgreSQL `citext`, and Prisma's generated client workflow.
- Produces: `TutorVerificationStatus`, `ListingPublicationStatus`, `TutorProfile`, `Subject`, `GradeLevel`, `TeachingListing`, and `User.tutorProfile`.

- [ ] **Step 1: Write the failing Prisma schema contract test**

  Create a Node test that reads `apps/api/prisma/schema.prisma` and asserts the exact model boundary:

  ```js
  test('defines the S1-T14 tutor profile and listing foundation', async () => {
    const schema = await fs.readFile('apps/api/prisma/schema.prisma', 'utf8');

    assert.match(
      schema,
      /enum TutorVerificationStatus\s*{[\s\S]*PENDING[\s\S]*VERIFIED[\s\S]*REJECTED/,
    );
    assert.match(
      schema,
      /enum ListingPublicationStatus\s*{[\s\S]*DRAFT[\s\S]*PUBLISHED[\s\S]*ARCHIVED/,
    );
    assert.match(schema, /model TutorProfile\s*{[\s\S]*userId\s+String\s+@id\s+@db\.Uuid/);
    assert.match(schema, /ratingAverage\s+Decimal\?\s+@db\.Decimal\(3,\s*2\)/);
    assert.match(schema, /model Subject\s*{[\s\S]*code\s+String\s+@unique\s+@db\.Citext/);
    assert.match(schema, /model GradeLevel\s*{[\s\S]*sortOrder\s+Int/);
    assert.match(
      schema,
      /model TeachingListing\s*{[\s\S]*pricePerHour\s+Decimal\s+@db\.Decimal\(10,\s*2\)/,
    );
    assert.doesNotMatch(schema, /model (AvailabilitySlot|Booking|Review)\s*{/);
  });
  ```

- [ ] **Step 2: Run the contract test and verify RED**

  Run:

  ```sh
  node --test tests/tutor-profile-listing-foundation.test.mjs
  ```

  Expected: fail because none of the S1-T14 enums/models exist.

- [ ] **Step 3: Add the minimal Prisma schema**

  Extend `User` with `tutorProfile TutorProfile?` and add the following schema contract:

  ```prisma
  enum TutorVerificationStatus {
    PENDING  @map("pending")
    VERIFIED @map("verified")
    REJECTED @map("rejected")
  }

  enum ListingPublicationStatus {
    DRAFT     @map("draft")
    PUBLISHED @map("published")
    ARCHIVED  @map("archived")
  }

  model TutorProfile {
    userId             String                  @id @db.Uuid
    displayName        String
    bio                String
    experienceYears    Int
    verificationStatus TutorVerificationStatus @default(PENDING)
    ratingAverage      Decimal?                @db.Decimal(3, 2)
    reviewCount        Int                     @default(0)
    ratingUpdatedAt    DateTime?               @db.Timestamptz(3)
    createdAt          DateTime                @default(now()) @db.Timestamptz(3)
    updatedAt          DateTime                @updatedAt @db.Timestamptz(3)
    user                User                    @relation(fields: [userId], references: [id], onDelete: Restrict, onUpdate: Cascade)
    listings            TeachingListing[]
  }

  model Subject {
    id        String            @id @default(uuid()) @db.Uuid
    code      String            @unique @db.Citext
    name      String            @unique @db.Citext
    active    Boolean           @default(true)
    createdAt DateTime          @default(now()) @db.Timestamptz(3)
    updatedAt DateTime          @updatedAt @db.Timestamptz(3)
    listings  TeachingListing[]
  }

  model GradeLevel {
    id        String            @id @default(uuid()) @db.Uuid
    code      String            @unique @db.Citext
    name      String            @unique @db.Citext
    sortOrder Int
    active    Boolean           @default(true)
    createdAt DateTime          @default(now()) @db.Timestamptz(3)
    updatedAt DateTime          @updatedAt @db.Timestamptz(3)
    listings  TeachingListing[]
  }

  model TeachingListing {
    id                String                   @id @default(uuid()) @db.Uuid
    tutorProfileId    String                   @db.Uuid
    subjectId         String                   @db.Uuid
    gradeLevelId      String                   @db.Uuid
    pricePerHour      Decimal                  @db.Decimal(10, 2)
    description       String
    publicationStatus ListingPublicationStatus @default(DRAFT)
    publishedAt       DateTime?                @db.Timestamptz(3)
    createdAt         DateTime                 @default(now()) @db.Timestamptz(3)
    updatedAt         DateTime                 @updatedAt @db.Timestamptz(3)
    deletedAt         DateTime?                @db.Timestamptz(3)
    tutorProfile      TutorProfile             @relation(fields: [tutorProfileId], references: [userId], onDelete: Restrict, onUpdate: Cascade)
    subject            Subject                  @relation(fields: [subjectId], references: [id], onDelete: Restrict, onUpdate: Cascade)
    gradeLevel         GradeLevel               @relation(fields: [gradeLevelId], references: [id], onDelete: Restrict, onUpdate: Cascade)

    @@index([tutorProfileId], map: "TeachingListing_tutorProfileId_idx")
    @@index([publicationStatus, subjectId, gradeLevelId, pricePerHour], map: "TeachingListing_search_idx")
  }
  ```

- [ ] **Step 4: Generate, validate, and verify GREEN**

  Run:

  ```sh
  pnpm db:generate
  pnpm db:validate
  node --test tests/tutor-profile-listing-foundation.test.mjs
  ```

  Expected: every command exits 0.

- [ ] **Step 5: Commit the schema contract**

  ```sh
  git add docs/superpowers/plans/2026-08-31-s1-t14-tutor-profile-listing-foundation.md apps/api/prisma/schema.prisma tests/tutor-profile-listing-foundation.test.mjs
  git commit -m "feat: define tutor profile listing schema"
  ```

### Task 2: Forward-only S1-T14 migration and database constraints

**Files:**

- Modify: `tests/tutor-profile-listing-foundation.test.mjs`
- Create: `apps/api/prisma/migrations/20260831090000_add_tutor_profile_listing_foundation/migration.sql`

**Interfaces:**

- Consumes: `public.User`, `extensions.CITEXT`, and existing migration history.
- Produces: the four S1-T14 tables, two enums, foreign keys, case-insensitive unique catalog indexes, search indexes, and row-local check constraints.

- [ ] **Step 1: Add failing migration-contract assertions**

  Extend the Node test to locate exactly one migration ending `_add_tutor_profile_listing_foundation`, read its SQL, and assert:

  ```js
  assert.match(sql, /CREATE TABLE "TutorProfile"/i);
  assert.match(sql, /CREATE TABLE "Subject"/i);
  assert.match(sql, /CREATE TABLE "GradeLevel"/i);
  assert.match(sql, /CREATE TABLE "TeachingListing"/i);
  assert.match(sql, /"code"\s+extensions\.CITEXT\s+NOT NULL/i);
  assert.match(sql, /TutorProfile_ratingAverage_check/i);
  assert.match(sql, /TeachingListing_description_length_check/i);
  assert.match(sql, /TeachingListing_search_idx/i);
  assert.doesNotMatch(sql, /DROP\s+(TABLE|TYPE|COLUMN)/i);
  ```

- [ ] **Step 2: Run the migration contract and verify RED**

  ```sh
  node --test tests/tutor-profile-listing-foundation.test.mjs
  ```

  Expected: fail because the S1-T14 migration is missing.

- [ ] **Step 3: Add the hand-authored forward-only SQL migration**

  The migration must execute in this order: enum types, catalog/profile tables, listing table, indexes, then foreign keys. Use these exact checks and indexes:

  ```sql
  CONSTRAINT "TutorProfile_experienceYears_check" CHECK ("experienceYears" >= 0),
  CONSTRAINT "TutorProfile_ratingAverage_check" CHECK ("ratingAverage" IS NULL OR ("ratingAverage" >= 1 AND "ratingAverage" <= 5)),
  CONSTRAINT "TutorProfile_reviewCount_check" CHECK ("reviewCount" >= 0),
  CONSTRAINT "GradeLevel_sortOrder_check" CHECK ("sortOrder" >= 0),
  CONSTRAINT "TeachingListing_pricePerHour_check" CHECK ("pricePerHour" > 0),
  CONSTRAINT "TeachingListing_description_length_check" CHECK (char_length(btrim("description")) BETWEEN 20 AND 1000),
  CONSTRAINT "TeachingListing_publishedAt_check" CHECK ("publicationStatus" <> 'published' OR "publishedAt" IS NOT NULL)
  ```

  Use `extensions.CITEXT` for both `code` and `name` on `Subject` and `GradeLevel`, `DECIMAL(3,2)` for `ratingAverage`, `DECIMAL(10,2)` for `pricePerHour`, and `TIMESTAMPTZ(3)` for every timestamp. Add:

  ```sql
  CREATE UNIQUE INDEX "Subject_code_key" ON "Subject"("code");
  CREATE UNIQUE INDEX "Subject_name_key" ON "Subject"("name");
  CREATE UNIQUE INDEX "GradeLevel_code_key" ON "GradeLevel"("code");
  CREATE UNIQUE INDEX "GradeLevel_name_key" ON "GradeLevel"("name");
  CREATE INDEX "TeachingListing_tutorProfileId_idx" ON "TeachingListing"("tutorProfileId");
  CREATE INDEX "TeachingListing_search_idx" ON "TeachingListing"("publicationStatus", "subjectId", "gradeLevelId", "pricePerHour");
  ```

  Add `ON DELETE RESTRICT ON UPDATE CASCADE` foreign keys from `TutorProfile.userId` to `User.id`, and from listing foreign keys to their referenced profile/catalog keys. Do not add triggers, destructive statements, `AvailabilitySlot`, `Booking`, or `Review`.

- [ ] **Step 4: Verify migration/schema alignment**

  ```sh
  node --test tests/tutor-profile-listing-foundation.test.mjs
  pnpm db:generate
  pnpm db:validate
  ```

  Expected: every command exits 0 and the migration contract finds exactly one S1-T14 migration.

- [ ] **Step 5: Commit the migration**

  ```sh
  git add apps/api/prisma/migrations/20260831090000_add_tutor_profile_listing_foundation/migration.sql tests/tutor-profile-listing-foundation.test.mjs
  git commit -m "feat: add tutor profile listing migration"
  ```

### Task 3: Seed environment and atomic orchestration

**Files:**

- Create: `apps/api/src/database/seed/seed-environment.ts`
- Create: `apps/api/src/database/seed/seed-environment.spec.ts`
- Create: `apps/api/src/database/seed/seed-client.ts`
- Create: `apps/api/src/database/seed/admin.seed.ts`
- Modify: `apps/api/src/database/seed.ts`
- Modify: `apps/api/src/database/seed.spec.ts`

**Interfaces:**

- Consumes: `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_TUTOR_EMAIL`, and `SEED_TUTOR_PASSWORD`.
- Produces: `readSeedEnvironment(env): SeedEnvironment`, `SeedTransactionClient`, `SeedDatabaseClient`, `seedAdministrator(client, email, passwordHash): Promise<void>`, and transactional `runSeed(client): Promise<void>`.

- [ ] **Step 1: Write failing environment tests**

  Cover lowercasing/trim of both emails, preservation of password bytes, rejection of missing/blank/bracketed values, and rejection when admin and tutor emails are equal case-insensitively:

  ```ts
  expect(() =>
    readSeedEnvironment({
      SEED_ADMIN_EMAIL: 'ADMIN@example.com',
      SEED_ADMIN_PASSWORD: 'AdminPass',
      SEED_TUTOR_EMAIL: 'admin@EXAMPLE.com',
      SEED_TUTOR_PASSWORD: 'TutorPass',
    }),
  ).toThrow('Admin and tutor seed emails must be different');
  ```

- [ ] **Step 2: Run environment tests and verify RED**

  ```sh
  pnpm --filter @hktutor/api test -- seed-environment.spec.ts --runInBand
  ```

  Expected: fail because `seed-environment.ts` does not exist.

- [ ] **Step 3: Implement the exact seed configuration contract**

  ```ts
  export interface SeedEnvironment {
    adminEmail: string;
    adminPassword: string;
    tutorEmail: string;
    tutorPassword: string;
  }

  export function readSeedEnvironment(env: NodeJS.ProcessEnv): SeedEnvironment;
  ```

  `readSeedEnvironment` must normalize only emails, reject `[...]` placeholders without logging their values, preserve passwords unchanged for hashing, and use the two exact safe errors `Admin seed environment is incomplete` and `Tutor seed environment is incomplete`.

  Define the database boundary in `seed-client.ts` with these operations:

  ```ts
  import type { Prisma } from '@/generated/prisma/client';

  export type SeedTransactionClient = Pick<
    Prisma.TransactionClient,
    'user' | 'subject' | 'gradeLevel' | 'tutorProfile'
  >;

  export interface SeedDatabaseClient {
    $queryRawUnsafe<T = unknown>(query: string): Promise<T>;
    $transaction<T>(operation: (client: SeedTransactionClient) => Promise<T>): Promise<T>;
  }
  ```

- [ ] **Step 4: Refactor administrator seeding behind a transaction client**

  Move the existing administrator upsert behavior into:

  ```ts
  export async function seedAdministrator(
    client: SeedTransactionClient,
    email: string,
    passwordHash: string,
  ): Promise<void>;
  ```

  Keep `where: { email }`, `update: {}`, role `ADMIN`, status `ACTIVE`, and the existing non-admin refusal. The `SeedTransactionClient` type contains only the `user`, `subject`, `gradeLevel`, and `tutorProfile` delegates needed by S1-T14.

- [ ] **Step 5: Make `runSeed` validate and use one transaction**

  Preserve the connectivity probe, hash both passwords with Argon2id parameters `memoryCost: 19_456`, `timeCost: 2`, and `parallelism: 1`, then execute seed writers inside:

  ```ts
  await client.$transaction(async (transaction) => {
    await seedAdministrator(transaction, config.adminEmail, adminPasswordHash);
    await seedTutorFoundation(transaction, config.tutorEmail, tutorPasswordHash);
  });
  ```

  Update the existing Jest mocks to prove `$queryRawUnsafe` runs once, `$transaction` runs once, existing admin credentials remain unchanged, and a pre-transaction configuration error performs no query or write.

- [ ] **Step 6: Run focused tests and verify GREEN**

  ```sh
  pnpm --filter @hktutor/api test -- seed-environment.spec.ts seed.spec.ts --runInBand
  ```

  Expected: environment and administrator/orchestration tests pass.

- [ ] **Step 7: Commit the seed foundation refactor**

  ```sh
  git add apps/api/src/database/seed apps/api/src/database/seed.ts apps/api/src/database/seed.spec.ts
  git commit -m "refactor: prepare transactional domain seeds"
  ```

### Task 4: Canonical catalog and verified tutor seed

**Files:**

- Create: `apps/api/src/database/seed/tutor-foundation.seed.ts`
- Create: `apps/api/src/database/seed/tutor-foundation.seed.spec.ts`
- Modify: `apps/api/src/database/seed.ts`

**Interfaces:**

- Consumes: normalized tutor email, Argon2id hash, and the S1-T14 Prisma delegates.
- Produces: `seedTutorFoundation(client, email, passwordHash): Promise<void>` and stable `mathematics`, `grade-10`, and verified-tutor records.

- [ ] **Step 1: Write failing tutor-foundation seed tests**

  Assert these exact behaviors:

  ```ts
  expect(subjectUpsert).toHaveBeenCalledWith({
    where: { code: 'mathematics' },
    update: { name: 'Mathematics', active: true },
    create: { code: 'mathematics', name: 'Mathematics', active: true },
  });

  expect(gradeLevelUpsert).toHaveBeenCalledWith({
    where: { code: 'grade-10' },
    update: { name: 'Grade 10', sortOrder: 10, active: true },
    create: { code: 'grade-10', name: 'Grade 10', sortOrder: 10, active: true },
  });
  ```

  Also assert the user create branch uses role `TUTOR`, status `ACTIVE`, and the Argon2id hash; the update branch is empty; a returned `STUDENT` or `ADMIN` role throws `Tutor seed email belongs to a non-tutor account`; and the profile is created/updated as verified without any `TeachingListing` write.

- [ ] **Step 2: Run the focused seed test and verify RED**

  ```sh
  pnpm --filter @hktutor/api test -- tutor-foundation.seed.spec.ts --runInBand
  ```

  Expected: fail because `seedTutorFoundation` does not exist.

- [ ] **Step 3: Implement stable catalog and tutor seed data**

  Use these non-secret deterministic profile values:

  ```ts
  const SEEDED_TUTOR_PROFILE = {
    displayName: 'Anan',
    bio: 'Verified tutor seeded for Sprint 1 demonstrations.',
    experienceYears: 5,
    verificationStatus: TutorVerificationStatus.VERIFIED,
  } as const;
  ```

  Upsert the tutor `User` by normalized email with `update: {}`. After confirming the returned role is `TUTOR`, upsert `TutorProfile` by `userId`; create the profile with `ratingAverage: null`, `reviewCount: 0`, and `ratingUpdatedAt: null`, while the repeat-run update changes only `verificationStatus` to `VERIFIED`. Do not create or update a listing in this function.

- [ ] **Step 4: Verify seed behavior and orchestration GREEN**

  ```sh
  pnpm --filter @hktutor/api test -- tutor-foundation.seed.spec.ts seed.spec.ts --runInBand
  ```

  Expected: both focused suites pass, including repeat-run and wrong-role cases.

- [ ] **Step 5: Commit the S1-T14 seed behavior**

  ```sh
  git add apps/api/src/database/seed/tutor-foundation.seed.ts apps/api/src/database/seed/tutor-foundation.seed.spec.ts apps/api/src/database/seed.ts
  git commit -m "feat: seed verified tutor foundation"
  ```

### Task 5: Environment template and operator documentation

**Files:**

- Modify: `.env.example`
- Modify: `tests/environment-template.test.mjs`
- Modify: `README.md`
- Modify: `apps/api/README.md`

**Interfaces:**

- Consumes: the ignored root `.env` and existing migration-owner workflow.
- Produces: safe tutor placeholders and an S1-T14 review/deploy/seed runbook that keeps T20 fixtures deferred.

- [ ] **Step 1: Write failing environment-template assertions**

  Extend `tests/environment-template.test.mjs` to require exactly these safe keys and to reject real-looking tutor credentials:

  ```dotenv
  SEED_TUTOR_EMAIL="[TUTOR_EMAIL]"
  SEED_TUTOR_PASSWORD="[TUTOR_PASSWORD]"
  ```

- [ ] **Step 2: Run the template test and verify RED**

  ```sh
  node --test tests/environment-template.test.mjs
  ```

  Expected: fail because the tutor placeholders are missing.

- [ ] **Step 3: Update the template and runbooks**

  Document the four S1-T14 tables, PostgreSQL-enforced checks, the cross-row publish rule deferred to S1-T15, required ignored tutor seed credentials, idempotent catalog/tutor behavior, and the deliberate absence of T20 listing/rating fixtures. Preserve this reviewed shared-database sequence:

  ```sh
  pnpm db:migrate:status
  pnpm db:migrate:deploy
  pnpm db:seed
  pnpm db:seed
  pnpm db:migrate:status
  ```

- [ ] **Step 4: Run documentation/template checks and verify GREEN**

  ```sh
  node --test tests/environment-template.test.mjs tests/tutor-profile-listing-foundation.test.mjs
  pnpm format:check
  ```

  Expected: all commands exit 0.

- [ ] **Step 5: Commit operator documentation**

  ```sh
  git add .env.example tests/environment-template.test.mjs README.md apps/api/README.md
  git commit -m "docs: add S1-T14 database runbook"
  ```

### Task 6: Local verification, PR checkpoint, and shared Supabase verification

**Files:**

- Modify only files required by failures attributable to S1-T14.

**Interfaces:**

- Consumes: the completed S1-T14 branch, ignored local `.env`, and shared Supabase migration history.
- Produces: reviewable PR evidence first, then—only after separate approval—one applied migration and one verified tutor/catalog seed set.

- [ ] **Step 1: Run the full local gate**

  ```sh
  pnpm db:generate
  pnpm db:validate
  pnpm check
  git diff --check
  git status --short
  ```

  Expected: generation, validation, workspace tests, API tests, format, lint, and both builds exit 0; only intentional S1-T14 files appear in status.

- [ ] **Step 2: Perform the requirements and secret review**

  Compare implementation line by line with the workbook ranges named in the plan header. Confirm `git diff` contains no `.env`, password, hash, connection URL, `AvailabilitySlot`, `Booking`, `Review`, listing fixture, or rating fixture. Confirm the SQL has no destructive statement.

- [ ] **Step 3: Push and open a PR without touching shared Supabase**

  Push `feat/s1-t14-tutor-profile-listing-schema`, open a PR against `main`, and include schema/constraint/seed scope, focused test evidence, full `pnpm check` evidence, and the explicit note `Shared Supabase migration and seed not applied`.

- [ ] **Step 4: Stop at the migration checkpoint**

  Wait for migration review and PR merge. Require real `SEED_TUTOR_EMAIL` and `SEED_TUTOR_PASSWORD` in the ignored root `.env`. Obtain explicit user approval before any shared-database write.

- [ ] **Step 5: Preflight and deploy the reviewed migration**

  From updated `main`, run:

  ```sh
  pnpm db:migrate:status
  pnpm db:migrate:deploy
  ```

  Expected preflight: only `20260831090000_add_tutor_profile_listing_foundation` is pending. Stop instead of deploying if Prisma reports drift, reset, or any unexpected pending migration.

- [ ] **Step 6: Prove seed idempotency without exposing secrets**

  ```sh
  pnpm db:seed
  pnpm db:seed
  pnpm db:migrate:status
  ```

  Run a read-only verification that returns only counts/statuses: exactly one user matching the configured tutor email, role `TUTOR`, account status `ACTIVE`, Argon2id hash format true, one profile for that user with status `VERIFIED`, one active `mathematics` subject, and one active `grade-10` grade level. Do not print the email, password, hash, or database URL.

- [ ] **Step 7: Record completion evidence**

  Report the merged PR, migration name, up-to-date migration status, two successful seed runs, redacted tutor/catalog verification, full local gate result, and whether a formal reviewer approval exists. Only then recommend changing S1-T14 from `To do` to `Done`.

## Approval decisions captured by this plan

- Recommended approach: separate S1-T14 schema/catalog/minimal tutor seed from S1-T20 search fixtures.
- Alternative rejected: seed published listings and rating values in S1-T14; this duplicates S1-T20 ownership and increases migration/seed coupling.
- Alternative rejected: add only TutorProfile/TeachingListing; this cannot satisfy canonical case-insensitive subject/grade filtering required by the Data Model.
- Alternative rejected: enforce verified-tutor publishing with a database trigger; the rule crosses tables and belongs in the S1-T15 transaction/authorization layer.
