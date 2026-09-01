# S1-T07 Clerk Migration Design

## Goal

Bring the shared development/demo PostgreSQL schema from the historical email/password `User`
table to the Clerk-backed Prisma data model already merged in S1-T07. The change must preserve the
migration history, fail closed when the database contains anything other than recognized seed data,
and stop before any shared Supabase write until a separate post-merge approval.

## Context

The current Prisma schema makes the local UUID the domain identity, uses a unique `clerkUserId` as
the external identity, treats nullable CITEXT `primaryEmail` as a synchronized Clerk cache, and does
not store passwords or refresh tokens. It also defines `ClerkWebhookEvent` for retry-safe webhook
processing.

The historical `20260830120000_add_user_role_foundation` migration still creates a required unique
`email` and required `passwordHash`. That migration is immutable. A new forward-only migration must
move the deployed database to the current schema.

The shared project contains seed/demo data only. The team explicitly approved deleting that data and
re-seeding it. No real user account or user-owned record may be deleted by this migration.

## Scope

This change includes:

- one new forward-only migration after the existing S1-T23 migration;
- an explicit transaction containing a data-shape guard, ordered demo-data deletion, and Clerk DDL;
- a read-only preflight command that runs the same safety classification before deployment;
- contract and unit tests for the migration and preflight;
- a disposable-PostgreSQL rehearsal for successful and rejected data shapes;
- deployment and recovery guidance.

This change excludes:

- applying any migration or seed to shared Supabase;
- editing or replacing a historical migration;
- creating Clerk users, sessions, webhook handlers, onboarding APIs, or authorization middleware;
- changing the current seed behavior beyond wiring the preflight command;
- deleting `Subject` or `GradeLevel` catalog data;
- using `prisma migrate reset`, `prisma db push`, or `prisma migrate dev` against the shared project.

## Chosen Approach

Use a guarded purge followed by a forward-only schema migration. This is preferred over assigning
legacy placeholder Clerk identities or staging a nullable identity backfill because the database has
no real users. It produces the final schema in one reviewed migration, keeps real Clerk IDs out of
version control, and leaves the existing idempotent seed responsible for recreating demo identities.

## Accepted Pre-Migration States

The preflight and in-migration guard accept only these states:

1. **Empty identity state**: `User`, `TutorProfile`, `TeachingListing`, `AvailabilitySlot`, and
   `Booking` all contain zero rows.
2. **S1-T14 foundation seed state**: exactly one active administrator, exactly one active tutor,
   exactly one tutor profile owned by that tutor, no teaching listings, and no availability or
   booking rows.
3. **S1-T20 search seed state**: exactly one active administrator and five active tutors; four tutor
   users have the fixed S1-T20 UUID/email pairs; exactly five tutor profiles exist; exactly six
   teaching listings use the fixed S1-T20 listing UUIDs; and no availability or booking rows exist.

For every accepted non-empty state:

- no user may have role `student`;
- every user must have `accountStatus = 'active'` and `deletedAt IS NULL`;
- no additional user, tutor profile, teaching listing, availability slot, or booking may exist;
- the dynamic administrator and foundation tutor may use environment-specific email addresses and
  UUIDs, but their roles and relationships must match the canonical seed shape;
- synthetic tutors and listings must match the stable UUIDs and reserved `hktutor.invalid` emails in
  `search-fixtures.seed.ts`;
- consent fields must remain unset because no onboarding persistence exists in the approved seed
  flows.

Any other state is unknown and must be rejected before a destructive statement runs. The check must
report only a state name and aggregate reason; it must never print email addresses, password hashes,
Clerk IDs, connection strings, or row payloads.

## Preflight Command

Add `db:preflight:s1-t07-clerk` at the API and workspace roots. The command connects through the
existing direct `DATABASE_URL`, performs read-only aggregate/catalog queries against the historical
schema, classifies the database as one of the accepted states, and exits non-zero for anything else.

The classifier must be independently unit-testable without a database. Database access should be a
small adapter that returns counts and boolean invariants rather than raw identity data. The command
prints one safe result such as `empty`, `s1-t14-seed`, `s1-t20-seed`, `already-migrated`, or
`rejected`; a rejected result includes a non-sensitive invariant name.

The preflight is an operator aid, not the sole safety boundary. The migration repeats the equivalent
guard so that a state change between preflight and deployment cannot bypass protection.

## Migration Transaction

The new SQL migration must execute the following work inside an explicit PostgreSQL transaction:

1. Lock the identity-related tables strongly enough to prevent concurrent writes while the guard,
   purge, and DDL execute.
2. Repeat the accepted-state guard using SQL and raise an exception for unknown data.
3. Delete demo rows in foreign-key order:
   `Booking`, `AvailabilitySlot`, `TeachingListing`, `TutorProfile`, then `User`.
4. Preserve `Subject` and `GradeLevel` rows so catalog identity and references outside the purged
   graph remain stable.
5. Drop the historical `User_email_key` index.
6. Rename `User.email` to `primaryEmail`, remove its `NOT NULL` constraint, and drop
   `User.passwordHash`.
7. Add required text `User.clerkUserId` and create `User_clerkUserId_key` as a unique index.
8. Create `User_active_primaryEmail_key` as a unique partial index over `primaryEmail` where the
   email is non-null, `accountStatus = 'active'`, and `deletedAt IS NULL`.
9. Create the PostgreSQL enum `ClerkWebhookStatus` with `processed` and `failed` values.
10. Create `ClerkWebhookEvent` with required `eventId`, `type`, `clerkUserId`, `status`, and
    `processedAt`, nullable `payloadHash`, and `ClerkWebhookEvent_clerkUserId_idx`.

The migration must not drop a table, rewrite UUID primary keys, weaken existing foreign keys, insert
seed rows, embed a real Clerk identity, or modify unrelated domain tables.

## Deployment Flow

Development and review stop after generating, testing, committing, and merging the migration. A
separate shared-Supabase approval is required before the following checkpoint:

1. Run migration status and require exactly the reviewed Clerk migration to be pending.
2. Run `db:preflight:s1-t07-clerk` and require an accepted seed state.
3. Run migration deploy.
4. Run the existing seed twice with approved administrator and tutor Clerk mappings.
5. Run migration status again and require the schema to be up to date.
6. Verify aggregate demo counts and the Clerk indexes/table without printing identity values.

The deploy and two seed runs form a maintenance checkpoint for the shared demo environment. The
application may have no demo identity rows between the migration transaction commit and the first
successful seed.

## Error Handling and Recovery

- A preflight rejection stops before migration deploy.
- A guard rejection rolls back the migration transaction. Operators stop and inspect the data shape;
  they do not reset the database or automatically resolve the migration.
- A migration failure requires inspection of Prisma migration status before any use of
  `migrate resolve`.
- If the migration commits but seed fails, fix the seed environment and rerun the idempotent seed.
  Do not roll back the Clerk schema.
- If a destructive statement or unexpected migration appears during review or preflight, stop the
  checkpoint and require a new review.

## Testing Strategy

Repository tests must prove:

- the new migration exists exactly once and historical migrations remain unchanged;
- the SQL transaction and guard precede every destructive statement;
- the accepted empty, S1-T14, and S1-T20 shapes are represented in the preflight classifier;
- student, Booking, AvailabilitySlot, unknown user, unknown tutor profile, and unknown listing
  shapes are rejected;
- deletion order follows the foreign-key graph and no `TRUNCATE` or `DROP TABLE` is present;
- the final `User` columns, uniqueness rules, partial email predicate, Clerk enum, webhook table, and
  webhook index match the Prisma model;
- preflight output contains no identity or secret values.

Disposable PostgreSQL rehearsal must apply the historical migrations, load SQL fixtures for each
scenario, and show:

- an empty database migrates successfully;
- canonical S1-T14 and S1-T20 seed states migrate successfully and purge only the approved graph;
- each rejected state fails with no data or schema mutation;
- the migrated schema accepts two consecutive current seed runs.

The final local gate is `CI=true pnpm check` plus `pnpm db:validate`. No test or rehearsal may use the
configured shared Supabase connection.

## Acceptance Criteria

- The design, implementation plan, migration, preflight, tests, and runbook are reviewed and merged.
- Full local verification is green.
- No historical migration changed.
- No shared Supabase mutation occurred during development or review.
- Shared deployment remains pending until the user gives a separate explicit approval.
