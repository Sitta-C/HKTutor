# S3-DB06 — clean migration/seed, upgrade and persistence rehearsal

Source: [DB06 card](https://trello.com/c/g43DxGWY), Sprint 3 Backlog row 47.
Baseline `3986846`; executed 2026-11-13 (Asia/Bangkok), Node 24.19.0, pnpm 11.19.0,
PostgreSQL 17 Alpine. Dependencies DB04, DB05, T06 and T23 are already merged.

## What runs and what changes

Migration means applying the repository's committed `prisma/migrations/*/migration.sql` to the
selected PostgreSQL database. Seed means inserting synthetic/demo data into those tables.
Verification calls actual behavior and checks persisted results. The migration files are the
team's real schema history; only the databases used for this rehearsal are disposable.
No new migration, runtime API/service, DTO, UI, dependency or fixture input is added by DB06.

| File                                                         | Responsibility                                                                                                                                                                              |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/scripts/verify-sprint3-final.ts`                   | Dedicated target guard, Prisma history/checksum manifest, DB04 input hash, reuse of fixture/admin verifiers, stored event/action coverage and actual AppModule HTTP health                  |
| `apps/api/test/unit/database/sprint3-final-verifier.spec.ts` | 26 cases: target/history rejection, exact versus encoded generic names, allowlisted synthetic environment with cron disabled and safe failure diagnostics; imports never execute the runner |
| `apps/api/scripts/verify-booking-snapshot-upgrade.mjs`       | Existing upgrade harness extended from S2+PromptPay through current migrations; exact historical row comparisons before/after upgrade and existing snapshot/retry/locking checks            |
| Root/API `package.json`                                      | Expose `pnpm db:verify:sprint3-final` through the existing API delegation pattern                                                                                                           |
| Root/API README and this file                                | Entry point, safe runbook, exact evidence and remaining limits                                                                                                                              |

`apps/api/src/config/disposable-database-url.ts` is a pure shared guard for the existing final,
fixture, admin-coupon and DB05 TypeScript wrappers. It does not read process.env or register any
runtime API behavior. The fixture verifier now prints its unchanged input hash in its isolated child.

```text
db:migrate:deploy → Prisma → committed SQL → fresh clean/reminder/DB05 targets
db:verify:sprint3-final → verify-sprint3-final.ts
  migration disk hashes ↔ completed _prisma_migrations
  verify-sprint3-fixtures.ts → combined runSeed / actual services / PostgreSQL
  verify-admin-coupons.ts   → real JWT/HTTP / CouponsService / PostgreSQL
  test-mode AppModule / inactive cron → actual HTTP health → real Prisma SELECT 1
  six evidence-table hashes before/after startup must match

Separate empty targets:
  db:verify:booking-snapshots → existing upgrade SQL harness, now through latest migration
  API db:verify:reminders    → existing job, cron, occurrence/receipt/concurrency verifier
  db:verify:sprint3-concurrency → existing DB05 five-stage review/coupon/payment/plan verifier
```

Separate targets preserve each verifier's preconditions: the fixture/review runners require zero
users, the reminder runner requires zero bookings, and upgrade requires zero public tables.
Nothing silently clears an existing database to make a test pass. The final command covers the
clean path; all four commands below are required for complete DB06 evidence.

## Reproduction

Run from the repository root using an owned **new** container, not a shared/dev database.
The password shown is a throwaway local example. Confirm the port/container name is free.

```bash
nvm use 24.19.0
pnpm install --frozen-lockfile
docker run --detach --name hktutor-s3-db06-test \
  --publish 127.0.0.1:55468:5432 \
  --env POSTGRES_USER=postgres --env POSTGRES_PASSWORD=disposable-local-only \
  --env POSTGRES_DB=hktutor_s3_db06_test postgres:17-alpine
# Wait until PostgreSQL accepts connections.
docker exec hktutor-s3-db06-test pg_isready -U postgres -d hktutor_s3_db06_test
for db06_name in hktutor_db06_upgrade_test hktutor_db06_reminders_test hktutor_s3_db05_test; do
  docker exec hktutor-s3-db06-test createdb -U postgres "$db06_name"
done
DB06_BASE='postgresql://postgres:disposable-local-only@127.0.0.1:55468'
export HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1
export DATABASE_URL="$DB06_BASE/hktutor_s3_db06_test"
pnpm db:validate
pnpm db:generate
for db06_name in hktutor_s3_db06_test hktutor_db06_reminders_test hktutor_s3_db05_test; do
  DATABASE_URL="$DB06_BASE/$db06_name" pnpm db:migrate:deploy
done
pnpm db:verify:sprint3-final
# Do not pre-migrate upgrade: the harness needs zero public tables and applies SQL itself.
DATABASE_URL="$DB06_BASE/hktutor_db06_upgrade_test" pnpm db:verify:booking-snapshots
# Keep NODE_ENV unset here; the reminder verifier checks the real enabled cron outside Jest.
DATABASE_URL="$DB06_BASE/hktutor_db06_reminders_test" pnpm --filter @hktutor/api db:verify:reminders
DATABASE_URL="$DB06_BASE/hktutor_s3_db05_test" pnpm db:verify:sprint3-concurrency
# Retained synthetic evidence is append-only; inspect it, then discard only this owned container.
docker rm --force --volumes hktutor-s3-db06-test
unset DATABASE_URL HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY DB06_BASE db06_name
```

The clean migration path applies **29 committed migrations**, including the old local-auth
destructive migration, to an empty DB. It does not authorize applying that migration to an
existing Clerk database. The clean verifier does not itself migrate or load `.env`; it creates
random demo credentials in its existing seed child and random JWT secrets, without printing them.
Only OS path/temp variables are copied from the shell; the validated DB URL and synthetic settings
are supplied explicitly to children and startup. AppModule/app.setup are loaded after isolation.
The actual providers boot in NODE_ENV=test with the reminder cron verified inactive; this check
cannot write reminders on a minute boundary. The separate reminder verifier proves the live cron.
External fetches are rejected during full-app startup, while the health request
uses the original fetch against the ephemeral loopback listener. Email, Storage and Omise receive
no real credentials or live requests. Runtime providers are not replaced for the health test.

## Applied migration manifest

All files below applied through Prisma on the clean/reminder/DB05 targets and through SQL replay
on upgrade. The final verifier compared each clean-path SHA-256 with `_prisma_migrations`.

```text
20260830000000_enable_required_extensions
20260830120000_add_user_role_foundation
20260831090000_add_tutor_profile_listing_foundation
20260831120000_add_availability_slot_foundation
20260901120000_add_booking_foundation
20260901160000_migrate_user_identity_to_clerk
20260903120000_align_sprint1_database_contract
20260908120000_replace_clerk_with_local_jwt_auth
20260909190000_add_personal_profiles
20260911120000_add_expired_booking_status
20261001120000_add_sprint2_booking_fields
20261003120000_add_tutor_document
20261004120000_add_conversation_message
20261006150000_qualification_document_api
20261006200000_qualification_upload_recovery
20261006201000_protect_qualification_metadata
20261006210000_add_user_avatar
20261012100000_add_unverified_tutor_status
20261012100100_default_tutor_status_unverified
20261014120000_add_reschedule_request
20261016120000_add_password_reset_token
20261016130000_add_notification
20261019120000_add_promptpay_payments
20261103120000_add_review
20261109120000_add_coupon_persistence
20261111120000_add_booking_coupon_snapshots
20261111160000_preserve_coupon_reservation_retries
20261112120000_add_coupon_activation_audit
20261112170000_add_sprint3_query_indexes
```

## Acceptance and observed evidence

| Requirement                         | Actual check and result                                                                                                                                                                                                                   |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clean install and generated client  | `db:validate`, `db:generate`, all 29 migrations via Prisma deploy on three fresh targets; clean verifier compares exact completed names and SHA-256 file checksums                                                                        |
| Seed and repeated seed              | Existing combined `runSeed`, 42 fixture checks; retained reviews, notifications, coupon evidence, original times and unrelated sentinel survive repeats/failures                                                                          |
| Stable fixture input                | Semantic `db040000-…` IDs from DB04; input SHA-256 `ba5fc26aa43839f9c721530824c717ea78ada48e2a6db45f7cc67aa3998dac5a`; no fixture changes                                                                                                 |
| Report/review reconciliation        | Literal persisted 905.00 THB, 12-status ledger/75%, 4.33 with 2 reviews, new tutor null/0, 1.00/5.00; existing service and SQL checks                                                                                                     |
| Free settlement                     | Existing fixture/upgrade/payment checks: one canonical use/receipt, paid net zero, no provider attempt; concurrent submission remains idempotent                                                                                          |
| Uncertain provider state            | CREATING/unknown stays RESERVED and paymentPending; repeat seed/reconciliation never releases it solely because local expiry elapsed                                                                                                      |
| Upgrade preserves history           | S2+PromptPay fixtures include paid legacy/discount/zero bookings, successful/failed/pending/creating attempts, cancellation and reschedule; all original Booking/PaymentAttempt JSON fields unchanged after upgrading through current SQL |
| Later migrations preserve evidence  | Complete Booking/PaymentAttempt/AuditLog snapshots immediately before/after the later activation/index migrations match                                                                                                                   |
| Reminder uniqueness and four types  | DB04 verifies 29 scenarios and repeats; clean runner sees all four persisted types; reminder verifier checks unique (userId,eventKey), occurrence keys, reschedule history, read receipts, restart and simultaneous workers               |
| Real scheduler and reminders        | Existing reminder verifier: 15 grouped checks, actual UTC cron registration/shutdown, 24H/1H/start ±1ms, paid/unpaid recipients, 210-row paging, payment/cancel/reschedule contention, insert-failure rollback and retry                  |
| Admin creation and activation audit | Existing admin verifier: 9 checks, actor-bound creation, one 201/one 409 code race, safe JSON, actual-change activation audit and audit-failure rollback                                                                                  |
| Audit lifecycle/append-only         | Clean runner sees coupon.create/active_change/reserve/consume/release; DB05 raw SQL/payment checks enforce idempotency, append-only rules, terminal transitions and complete audit rollback                                               |
| Review/CouponUse/capacity           | DB05 five stages pass, including real HTTP 201/409 review, final-use race, 15 payment groups / 16 observed lock gates and 6 EXPLAIN queries                                                                                               |
| Startup and health                  | Actual AppModule boots after seeded writes; loopback GET /api/v1/health returns 200 and exactly `{ database: 'connected' }`; external fetch count zero                                                                                    |

The old upgrade harness deliberately replays committed SQL directly; it does not create Prisma's
migration ledger. The separate clean path proves the normal Prisma deployment/history contract.
The upgrade's initial schema is now S2+PromptPay, before Review/Coupon migrations, rather than the
old pre-DB03 starting point. Original indexes/constraints remain checked by the existing harness.

## Verification results

All checks below passed on 2026-11-13 with PostgreSQL **17.11**. The final read-only inspection
found 29 completed migrations, all four reminder types, all five coupon audit actions and zero
idle-in-transaction sessions across the four test databases.

Retained clean-path evidence after the fixture/admin runners: CLASS_REMINDER_1H 23,
CLASS_REMINDER_24H 16, PAYMENT_REMINDER_1H 7, PAYMENT_REMINDER_24H 4; coupon.create 17,
coupon.active_change 3, coupon.reserve 10, coupon.consume 5 and coupon.release 3. These are
post-verification totals, including deliberate service writes, not the initial DB04 seed counts.

| Command                         | Result                                                                              |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| Focused new verifier unit suite | 1 suite / 26 cases passed                                                           |
| API package lint                | Passed                                                                              |
| `db:verify:sprint3-final`       | 29 checksums, fixture 42, admin 9, persisted coverage and actual HTTP health passed |
| `db:verify:booking-snapshots`   | All old checks and S2+PromptPay-to-current history comparisons passed               |
| API `db:verify:reminders`       | 15 grouped checks passed                                                            |
| `db:verify:sprint3-concurrency` | All five stages passed, payment 15 groups / 16 lock gates, six natural plans        |

| Additional gate                                                | Result                                                                                                                                           |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm check`                                                   | Passed Prisma generation, formatting, root/package lint, API 97 suites / 1,750 tests, web 49 files / 767 tests, both builds and script typecheck |
| `pnpm verify:workspace`                                        | 138 tests passed                                                                                                                                 |
| API e2e notifications/payments/coupons/reviews/booking-coupons | 5 suites / 207 tests passed                                                                                                                      |
| `git diff --check`                                             | Passed                                                                                                                                           |

The original guard/history tests initially failed before their implementation. Seven review
regressions were then added; the new environment/diagnostic cases failed before the fix and the
26-case suite passed afterwards. Four Swagger cases initially needed loopback permission; all
78 focused guard/coupon cases passed with that permission, without weakening assertions.
The first implementation's deferred-import syntax and root reminder alias issues were corrected
before the initial successful gates. No migration or fixture input was weakened.

Evidence logs contain migration names/hashes, synthetic IDs/times and pass checkpoints only.
Local logs are `/tmp/hktutor-db06-{final,upgrade,reminders,concurrency}.log`; reproduce with the
commands above rather than depending on those machine-local paths.

Exact non-database gate commands, run from the repository root:

```bash
pnpm --filter @hktutor/api test --runInBand test/unit/database/sprint3-final-verifier.spec.ts
pnpm --filter @hktutor/api typecheck:scripts
pnpm --filter @hktutor/api lint
OMISE_SECRET_KEY='' OMISE_WEBHOOK_SECRET='' pnpm check
pnpm verify:workspace
pnpm --filter @hktutor/api test:e2e --runInBand notifications.e2e-spec.ts payments.e2e-spec.ts coupons.e2e-spec.ts reviews.e2e-spec.ts booking-coupons.e2e-spec.ts
git diff --check
```

## PR #171 review revision

All eight review comments are covered; no new migration, endpoint or dependency is introduced.

| Comment                                       | Change and evidence                                                                                                                                                                                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live cron during startup (4561184689)         | Startup uses test mode, checks the actual CronJob is inactive and compares hashes of Booking, PaymentAttempt, CouponReservation, CouponUse, Notification and AuditLog before/after health                                                         |
| Hidden errors (4561184697)                    | Checkpoint/error type/safe code are printed; trusted child exit/timeout and config-field details survive, arbitrary messages/URLs/assertion payloads do not. Unit cases and a real refused-connection CLI probe cover this                        |
| Additive-column fragility (4561184706)        | Baseline column projection in PostgreSQL; a transaction adds a nullable probe column to all three tables without invalidating evidence, detects a changed original Booking value, then rolls back                                                 |
| Unnamed index/constraint failure (4561184712) | Diagnostics include the index/constraint name and PromptPay-to-snapshot migration range; success text matches that scope                                                                                                                          |
| Ambient provider settings (4561184722)        | Fresh allowlist for child/startup settings; original environment is cleared during execution and restored after. Real clean run starts with ambient dummy OMISE_PUBLIC_KEY/WEB_ORIGIN and NODE_ENV=production; isolated startup remains test mode |
| Early runtime imports (4561184726)            | Parent imports only the pure explicit-input guard; AppModule/app.setup load after isolation, fixture-builder graph loads in the isolated fixture child                                                                                            |
| Repeated URL guards (4561184731)              | Four related TypeScript wrappers reuse one pure guard; existing exports, loopback/opt-in/query/fragment rejection and exact-name strictness remain covered                                                                                        |
| Repeated snapshot/ID queries (4561184735)     | The same evidence helper returns columns + IDs + exact JSONB values; separate ID queries and three copies of coupon-column stripping were removed                                                                                                 |

The revision was rerun on an owned `hktutor-s3-db06-review` container at loopback port 55469,
using the same clean/DB05 names and `hktutor_db06_review_upgrade_test` /
`hktutor_db06_review_reminders_test` as the other targets. All 29 migrations and all four
database verification paths passed again, including the inactive-cron/hash and additive-column
regressions. The DB04 input hash remains unchanged. The latest `pnpm check` passed 1,750 API and
767 web tests, lint and both builds; workspace contracts passed 138 tests, and the focused HTTP
suite passed 207 tests. Final SQL inspection found zero probe columns and idle transactions.
The owned review container/databases were removed after verification. Logs use
`/tmp/hktutor-db06-review-*.log`.

A negative CLI run with the dedicated DB name and closed loopback port 1 intentionally exits 1:

```text
DB06 database preflight: Error (ECONNREFUSED). Inspect this checkpoint; raw error details are omitted.
```

The output contains neither the dummy password nor its connection URL. No live credentials are
needed to reproduce this negative check.

## Recovery and limits

CREATING/provider-result-unknown is intentionally retained capacity, not an orphan to clear.
Restore valid Test Mode provider configuration and use the existing authenticated current-payment
reconciliation described in the API's PromptPay recovery runbook. Never create another charge or
release a reservation based only on elapsed local time. Verified provider success consumes once;
only definitive no-charge rejection/FAILED/EXPIRED releases capacity. Tests exercise these service
paths with a provider stub; no live Omise result or actual callback delivery is certified here.

No shared database/Supabase reset, deployment, browser/UI, public proxy/WebSocket route, live email
or Storage operation was performed. HTTP health proves the API and its database connection, not
external service availability or the complete three-role UI demo owned by S3-T40. No manual SQL
repair or relaxation of immutable evidence is part of this runbook.
