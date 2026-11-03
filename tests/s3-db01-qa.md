# S3-DB01 verification

Date: 2026-11-03 (Asia/Bangkok). Scope:
[Trello S3-DB01](https://trello.com/c/4BTNfjDj), plus the Data Model Review row. Existing code takes
precedence for existing fields. No changes were posted to Trello or Google Sheets.

## Implemented contract

- Additive `20261103120000_add_review` migration, Prisma Review model and reciprocal relationships.
- One review per booking, three integer dimensions in `1..5`, trimmed nonempty feedback of at most
  1,000 Unicode code points, and UTC timestamps. No persisted rounded `overallRating`.
- Composite foreign key ties booking ID, private author, tutor and a CHECK-constrained `completed`
  status to the actual Booking tuple. Native referential locks protect both directions, including
  old repeatable-read snapshots. This declarative constraint implements cross-row eligibility;
  no custom cross-row CHECK or constraint trigger is used.
- Restrictive evidence FKs, private RLS/grants, descending tutor/date/ID cursor index, author index,
  and independent booking uniqueness. The additional tuple unique index supports Prisma's 1:1
  composite relationship.
- Clear legacy no-review display caches to null/0/null without generating review history; seeds
  preserve review-backed caches and reviewed demo booking evidence.
- Future HTTP authorization, DTOs, explicit public projections and aggregate writers remain
  S3-T13/T17/T19. The rollback test executes a representative SQL transaction, not a production
  Review service. The rounding probe uses raw dimensions and produces 4.33 for 5/4/5 and 4/4/4.

## Commands and actual results

All commands ran from the repository root with Node 24.19.0 and pnpm 11.19.0.

| Command / check                                                       | Actual result                                                                                                                              |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm db:validate`                                                    | Passed.                                                                                                                                    |
| `pnpm db:generate`                                                    | Passed, Prisma Client 7.10.0. No generated files hand-edited.                                                                              |
| `pnpm verify:workspace`                                               | Passed: 131 tests. Updated the two historical assertions that prohibited a Review model.                                                   |
| `pnpm --filter @hktutor/api test --runInBand test/unit/database/seed` | Passed: 6 suites, 21 tests.                                                                                                                |
| `pnpm check`                                                          | Passed: formatting, all workspace lint, 75 API suites / 1,407 tests, 37 web files / 472 tests, API and web builds, and script typecheck.   |
| `pnpm --filter @hktutor/api test:e2e --runInBand`                     | Passed: 23 suites, 547 tests. These existing suites use their configured mocks; they are separate from the real PostgreSQL evidence below. |
| `git diff --check`                                                    | Passed.                                                                                                                                    |

The first sandboxed `pnpm check` and API E2E attempts failed because Supertest could not listen on
local sockets (`EPERM`). The same commands were rerun successfully with local socket access.
Docker initially was stopped; the installed Homebrew libpq package had client tools but no server.
Docker was started and the already-installed official `postgres:17` image was used.

## Real PostgreSQL evidence

The user explicitly approved creating a new disposable local `hktutor_review_test` database.
Container `hktutor-review-s3-db01` used an ephemeral host port (`127.0.0.1:50214`), independent of
project `.env` database settings. Only synthetic example.test accounts and disposable passwords
were supplied to seed. No shared/project database was migrated or seeded.

1. `DATABASE_URL=<explicit disposable URL> pnpm db:migrate:deploy` applied all 24 committed
   migrations, including the new Review migration, to a fresh PostgreSQL 17 database.
2. `HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 DATABASE_URL=<explicit disposable URL> pnpm db:verify:reviews`
   passed against that database. The runner checks all migrations and access/index preconditions
   before creating random fixtures. It directly proves:
   - Ratings below/above bounds, fractional inputs and nulls fail; 1 and 5 succeed.
   - Empty/whitespace-only feedback, 1,001 ASCII/Thai/emoji code points and every ECMAScript trim
     character at either boundary fail. One character and 1,000 Thai/emoji code points succeed;
     combining marks/interior whitespace/literal markup-looking text remain plain text.
   - Pending, confirmed, canceled and expired bookings fail, as do missing references, another
     student's ID, another tutor's ID and direct invalid Review updates.
   - Direct reverse Booking status/identity changes and referenced evidence deletions fail.
   - Two independent connections contend on a unique booking review; exactly one review persists.
     Review-first status change, booking-first review insertion and participant-change contention
     reject the invalid contender after the owner commits. A repeatable-read contender establishes
     its snapshot before insertion and still cannot invalidate the review.
   - `pg_blocking_pids` confirms actual contention before the writer commits.
   - Review insertion plus cache aggregation rolls back entirely after a forced duplicate failure;
     review count and all original cache fields are restored. Descending cursor ties and isolation
     from another tutor's reviews also pass.
3. The same disposable database was recreated from the 23 unchanged predecessor SQL migrations.
   A synthetic tutor was inserted with legacy `4.80` / `24` cache values and a retained bio and
   experience. Applying the exact new migration reset only the cache to null/0/null, retained the
   profile fields and created zero Review rows. SQL assertions passed.
4. The database was recreated again and all 24 migrations were applied using Prisma. The direct
   verifier passed again. `pnpm db:seed` with explicitly synthetic credentials passed; SQL asserted
   zero reviews and null/0/null caches for every tutor.
5. A synthetic review for the seeded ended class and an associated display cache were inserted
   directly for this check. Re-running the same `pnpm db:seed` passed and SQL comparison proved the
   completed booking, original slot window, review and every cache field remained unchanged.

The temporary PostgreSQL container is removed after verification. The reusable runner remains
available through root/API `db:verify:reviews`; it requires explicit disposable opt-in, a loopback
host, a `hktutor_*_test` or `hktutor-*-test` name, no URL options/fragments and all migrations applied.
It does not migrate or seed, and its `finally` cleanup deletes only its randomly identified fixtures.

## Rollout and remaining work

Apply this migration to a separately confirmed deployment target before enabling Review APIs.
The new Booking composite index scans the existing table, and the cache backfill writes no-review
tutor rows inside the migration transaction. Review normal migration-lock/maintenance expectations
for a populated target. No shared migration was changed.

Public tutor filters/ranking still use the existing display-cache implementation until S3-T19.
S3-T17 must compute from raw dimension sum/count and round HALF_UP only at display time. S3-T13
must obtain the author from the session, validate role/consent/booking ownership inside the write
transaction, omit private author/bookingStatus fields from public responses, and translate database
conflicts to the documented API response. There is no Review UI/browser journey to exercise in
this database-only card; web behavior is covered by the existing unit/build regression checks.

## Follow-up: confirmed dev migration

On 2026-11-03, after the disposable verification above, the user explicitly confirmed that the
configured database is a development environment and authorized applying the migration.

- `pnpm db:migrate:status` found exactly one pending migration: `20261103120000_add_review`.
- `pnpm db:migrate:deploy` applied that migration successfully to the configured Supabase dev
  database (`public` schema).
- A subsequent `pnpm db:migrate:status` confirmed all 24 migrations applied and reported
  `Database schema is up to date!`.

No seed or disposable-database write tests were run against the dev database.
