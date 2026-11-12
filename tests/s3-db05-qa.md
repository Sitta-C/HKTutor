# S3-DB05 — concurrency, atomicity and query-plan verification

Scope: [S3-DB05](https://trello.com/c/2zoBcsga), based on `main` `f3631ce`.
Only disposable PostgreSQL and synthetic identities/provider responses are used.
This changes verification and two query indexes; no runtime service, controller, DTO, UI or
payment-provider contract is changed.

## Files and calls

| File (repository-relative)                                                          | Purpose and dependencies                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`                                                                      | Delegates `db:verify:sprint3-concurrency` to the API package                                                                                                                                                           |
| `apps/api/package.json`                                                             | Runs `ts-node -r tsconfig-paths/register scripts/verify-sprint3-concurrency.ts`                                                                                                                                        |
| `apps/api/scripts/verify-sprint3-concurrency.ts`                                    | Validates opt-in, dedicated local DB, applied migrations and empty users; runs five existing/new verifier processes in order; stops on first failure                                                                   |
| `apps/api/scripts/verify-review-submissions.ts`                                     | Existing real JWT/HTTP review verifier; additionally accepts the exact dedicated DB05 database and validates the connected target. Calls review controllers/`ReviewsService`, JWT/ownership guards and real PostgreSQL |
| `apps/api/scripts/verify-coupon-database.mjs`                                       | Existing raw SQL constraint/lock verifier, using `disposableDatabaseUrl` from `verify-review-database.mjs`; adds both consume-versus-release directions and exact terminal audit/capacity assertions                   |
| `apps/api/scripts/verify-coupon-payments.ts`                                        | Existing T26 verifier; adds observed PostgreSQL lock gates, T25 service integration, losing-side/full rollback snapshots and actual PostgreSQL error injection for retry limits                                        |
| `apps/api/scripts/verify-sprint3-query-plans.mjs`                                   | Reuses the existing disposable guard; creates representative SQL fixtures, runs ANALYZE and six EXPLAIN queries; exports a sanitized plan summarizer                                                                   |
| `apps/api/test/unit/database/sprint3-concurrency-verifier.spec.ts`                  | Imports only the DB05 target validator; rejects missing opt-in, wrong DB, remote/redirected/non-PostgreSQL targets; never connects to a DB                                                                             |
| `tests/s3-db05-query-plans.test.mjs`                                                | Imports the plan summarizer; verifies nested index extraction, redaction and rejection of absent ANALYZE evidence                                                                                                      |
| `apps/api/prisma/migrations/20261112170000_add_sprint3_query_indexes/migration.sql` | Adds only the two measured missing indexes in one transaction; preserves all existing unique/partial indexes and data                                                                                                  |
| `apps/api/prisma/schema.prisma`                                                     | Records the slot index and documents the migration-managed coupon expression index                                                                                                                                     |
| `README.md`, `apps/api/README.md`, this file                                        | Entry point, prerequisites, precise evidence and limits                                                                                                                                                                |

The existing `verify-review-database.mjs` is called unchanged: it already proves raw unique,
identity/status races and rollback behavior. There is no new copy of the business logic.

```text
pnpm db:verify:sprint3-concurrency
  API package → verify-sprint3-concurrency.ts
    1. verify-review-submissions.ts       real HTTP / JWT / ReviewsService / PostgreSQL
    2. verify-review-database.mjs         SQL unique constraints, identity/status races
    3. verify-coupon-database.mjs         SQL claims, terminal states, capacity, audit
    4. verify-coupon-payments.ts
         BookingCouponsService.applyCoupon/removeCoupon    (T25)
         PaymentsService.create/getStatus/webhook           (T26)
         BookingsService.cancelBooking
         PaymentsController / OmiseWebhookController / API setup and filters
         OmiseService → in-process fetch stub, never live Omise
         pg.Pool → held row locks and pg_blocking_pids observations
    5. verify-sprint3-query-plans.mjs     representative fixtures / ANALYZE / EXPLAIN
```

These runners use their existing isolated test generators rather than calling the operational
`pnpm db:seed`. The review HTTP verifier requires an initially empty user table, and mutable race
fixtures must not inherit DB04's already-consumed coupons or provider-stub history. DB04's seed
entry point and fixtures remain unchanged.

## Cases and expected persisted results

| Layer / case                                                      | Expected evidence                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Review HTTP, two concurrent submissions for one completed booking | Both POSTs observed waiting on the booking lock; statuses **201 / 409 REVIEW_ALREADY_EXISTS**; one stored row; tutor reviewCount increases once; raw dimensions give **4.33**; private read returns the winner                                                                                        |
| Review direct SQL                                                 | Unique `bookingId` rejects the second insert with **23505**; completed-booking/author/tutor relations and status races hold; failed transaction leaves no review/cache partial state                                                                                                                  |
| Coupon final use, two students/bookings                           | Both wait on a held coupon lock; exactly one successful claim and one **409**; exactly one provider POST; loser retains unpaid **405.00**, no pending flag, attempt, reservation or use                                                                                                               |
| Same student / booking reuse                                      | Raw student/booking claims reject **23505**; service rejects consumed coupon reuse before provider HTTP; repeated successful requests never add a use/audit                                                                                                                                           |
| Consume versus release, both winner orders                        | The contender is blocked in PostgreSQL; one terminal transition commits, opposite transition rejects **23514**; exactly one matching terminal audit and one reserve audit; only RELEASED permits another claim                                                                                        |
| Webhook / webhook / current status                                | All three wait on a held booking lock; all complete, one SUCCESSFUL attempt, one paid booking, one use and one consume audit; late failure cannot downgrade success                                                                                                                                   |
| Uncertain provider                                                | Lost POST response, 503 and no metadata match keep CREATING/paymentPending/RESERVED; recovery does not POST another charge                                                                                                                                                                            |
| Confirmed failure/expiry                                          | RELEASED, unpaid and not pending; no use; a new attempt may retry. Elapsed time or coupon deactivation alone never releases an uncertain claim                                                                                                                                                        |
| Zero-net duplicate submission                                     | Both wait on the booking lock; return the same paid coupon receipt; one use/audit; no PaymentAttempt/provider configuration/charge; paid cancellation rejected                                                                                                                                        |
| Payment/cancellation races (four)                                 | Both wait on the booking lock; exactly one operation succeeds; canceled/no claim or confirmed/pending/one claim, never contradictory persisted states                                                                                                                                                 |
| T25 apply/remove/replace versus T26 QR create (nine)              | Both wait on the booking lock. Calls the real T25 services rather than direct price writes; resulting Booking/PaymentAttempt price, coupon and reservation align with the single stub charge                                                                                                          |
| Positive and zero-payment injected failure                        | Compare complete Booking, attempts, reservations, uses and audit snapshots before/after failure: no partial change. After removing the probe, retry settles exactly once                                                                                                                              |
| Retryable transaction faults                                      | Inject actual PostgreSQL SQLSTATE **40001** and **40P01** at the claim write; both map to Prisma **P2034**. Initial attempt plus two whole-transaction retries: success after two faults makes one provider call; three faults propagate P2034 with identical before/after state and no provider call |
| Existing provider/auth boundaries                                 | Real adapter validates test provider results; JWT/session/current-consent, empty bodies, no-store and signed/invalid HMAC continue to be exercised by the reused verifier                                                                                                                             |

Every held-lock helper waits for the actual PostgreSQL blocker chain, including indirect waiters,
before releasing the gate. It has a bounded deadline and releases the control connection even on
failure. Promise.all alone is not reported as proof of overlap. There are **16 payment lock-gate
scenarios**, in addition to the raw SQL and review HTTP gates.

The payment runner's `evidence()` reconciles money, paid/pending state, matching attempts,
reservation status/discount, canonical use count and operation audit. Fault snapshots include all
audit rows so a detached/orphan audit cannot escape a booking-only comparison. Direct DB02 tests
exercise legal low-level legacy rows and their constraints; they do not substitute for the full
payment-service settlement assertions.

The 40P01 retry test injects the PostgreSQL deadlock SQLSTATE; it does not claim an independently
engineered deadlock cycle. Actual row contention and the raw 40001 stale-snapshot race are tested
separately. Exhausted P2034 is currently propagated by the service; the API exception filter maps
unexpected failures to generic **500 INTERNAL_ERROR**, not a fabricated 409. Domain capacity/reuse
conflicts are 409; raw constraint codes are not exposed to clients.

## Query plans and the two indexes

The plan runner adds **6,000 bookings/slots/coupons**, **3,000 reviews**, **30 tutors**,
**1,000 RESERVED +1,000 CONSUMED reservations** and **1,000 canonical uses**. Consumed uses and
their audit rows are created through the existing triggers, with matching paid Booking and
successful synthetic attempt evidence. It ANALYZEs the affected tables, then runs
`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` without disabling sequential scans or forcing indexes.

| Query                          | Source behavior represented                                                      | Natural index checked                                                                 |
| ------------------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Public reviews and tied cursor | `ReviewsService.listForTutor` in `modules/reviews/reviews.service.ts`            | `Review_tutorProfileId_createdAt_id_idx`                                              |
| Coupon list and cursor         | `CouponsService.list` in `modules/coupons/coupons.service.ts`                    | `Coupon_createdAt_id_idx`                                                             |
| Normalized code equality       | `BookingCouponsService` in `modules/bookings/booking-coupons.service.ts`         | **new `Coupon_code_text_idx`**                                                        |
| RESERVED capacity              | Counts used by coupon/payment eligibility                                        | `CouponReservation_couponId_status_idx`                                               |
| Consumed capacity              | Canonical `CouponUse` count                                                      | `CouponUse_couponId_studentUserId_key`                                                |
| Global reminder window         | `ReminderJobService.scanPage` in `modules/notifications/reminder-job.service.ts` | **new `AvailabilitySlot_startAtUtc_id_idx`**, plus existing `Booking_active_slot_key` |

These are focused SQL representations of the predicates/order used by those methods, not a
claim to replay every Prisma-generated relation join. Prisma's actual emitted coupon lookup SQL
was inspected to confirm the unqualified `code = $1` predicate. The application already normalizes
codes to uppercase. With CITEXT installed in `extensions` outside the default search_path, that
predicate resolves text equality; the existing CITEXT unique index alone did not serve this lookup.
The additional non-unique `(code::text)` index supports it without altering normalization/uniqueness.
No search_path or role grants are changed. The existing tutor-first slot index cannot bound a
reminder window across all tutors; the new start-first index can.

Measured on the same initial representative data, without changing planner settings:

| Query         | Before                                                 | After                                                                                     |
| ------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Coupon code   | Seq Scan, **6,046** rows removed, 1 returned           | `Coupon_code_text_idx`, **0** removed, 1 returned                                         |
| Reminder scan | Seq Scan of slots, **6,047** rows removed, 12 returned | New slot Index Only Scan + existing Booking active-slot index, **0** removed, 12 returned |

Timings are recorded only as observations, not hardware-independent test thresholds. The final
rerun also checks consumed capacity on a representative use table. Cursor queries can still filter
earlier index entries; this work adds only the two measured missing indexes. Plan summaries retain
node/index names, row work and timing, never predicates, identities, credentials or provider bodies.

## Run and cleanup

Use Node **24.19.0** and pnpm **11.19.0**, from the repository root. No shared/dev database is used.
The database name is intentionally exact so the existing review HTTP verifier keeps its dedicated
target restriction. Its original `hktutor_s3_t15_test` command remains accepted unchanged.

```bash
docker run --detach --name hktutor-s3-db05-test \
  --publish 127.0.0.1:55465:5432 \
  --env POSTGRES_USER=postgres --env POSTGRES_PASSWORD=disposable-local-only \
  --env POSTGRES_DB=hktutor_s3_db05_test postgres:17-alpine
docker exec hktutor-s3-db05-test pg_isready -U postgres -d hktutor_s3_db05_test
export DATABASE_URL='postgresql://postgres:disposable-local-only@127.0.0.1:55465/hktutor_s3_db05_test'
pnpm db:migrate:deploy
HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 pnpm db:verify:sprint3-concurrency
# Append-only synthetic evidence is retained; inspect it, then discard this owned container.
docker rm --force --volumes hktutor-s3-db05-test
unset DATABASE_URL
```

The verifier never loads `.env`, migrates, seeds a shared database, resets retained data or calls
live Omise. Each child has a bounded process timeout and a nonzero exit stops the overall command.
Start with a fresh database for each complete run. The throwaway password above is not a project
credential; real test JWT/HMAC secrets are generated in memory and never logged.

The forward migration adds indexes only, preserving existing data and constraints. Normal
CREATE INDEX can briefly block writes during a deployment; use the team's normal migration
workflow. Reverting code does not remove append-only synthetic records: discard the disposable DB.

## Results

Verified **2026-11-12 (Asia/Bangkok)** with Node **24.19.0**, pnpm **11.19.0** and PostgreSQL 17
Alpine. The final combined run applied **all 29 migrations** to a new container at loopback
port 55467, then completed **all five verifier stages**. The focused payment verifier was rerun
after tightening the cancellation/T25 losing-side checks to require 409 rather than accepting
arbitrary rejections; all **15 payment groups** passed again.

| Command                                                                                                                                                                                       | Result                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm db:validate`, `pnpm db:generate`                                                                                                                                                        | Passed                                                                                                                                       |
| `pnpm check`                                                                                                                                                                                  | Passed: formatting, root/package lint, API **95 suites / 1,720 tests**, web **49 files / 765 tests**, production builds and script typecheck |
| `pnpm verify:workspace`                                                                                                                                                                       | **138 tests passed**, including the two plan-summary tests                                                                                   |
| `pnpm --filter @hktutor/api test --runInBand test/unit/database/sprint3-concurrency-verifier.spec.ts test/unit/payments test/unit/reviews test/unit/bookings/booking-coupons.service.spec.ts` | **11 suites / 163 tests passed**                                                                                                             |
| `pnpm --filter @hktutor/api test:e2e --runInBand reviews.e2e-spec.ts payments.e2e-spec.ts booking-coupons.e2e-spec.ts`                                                                        | **3 suites / 99 tests passed**                                                                                                               |
| `HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 pnpm db:verify:sprint3-concurrency` with explicit fresh loopback URL                                                                                    | Five stages passed: real review HTTP/SQL, coupon SQL, **15 payment groups / 16 observed payment lock gates**, **six natural EXPLAIN plans**  |
| `pnpm db:verify:coupon-payments` on the same owned disposable target                                                                                                                          | All **15 groups passed** after the final strict 409 assertions                                                                               |
| Touched payment-script ESLint and `git diff --check`                                                                                                                                          | Passed                                                                                                                                       |

Sanitized final plan observations (milliseconds are local observations only):

| Query             | Indexes seen                                                    | Returned rows | Rows removed by filters | Execution ms |
| ----------------- | --------------------------------------------------------------- | ------------- | ----------------------- | ------------ |
| Public reviews    | `Review_tutorProfileId_createdAt_id_idx`                        | 21            | 33                      | 0.046        |
| Coupon list       | `Coupon_createdAt_id_idx`                                       | 21            | 3000                    | 0.960        |
| Coupon code       | `Coupon_code_text_idx`                                          | 1             | 0                       | 0.026        |
| Reserved capacity | `CouponReservation_couponId_status_idx`                         | 1 aggregate   | 0                       | 0.034        |
| Consumed capacity | `CouponUse_couponId_studentUserId_key`                          | 1 aggregate   | 0                       | 0.021        |
| Reminder scan     | `AvailabilitySlot_startAtUtc_id_idx`, `Booking_active_slot_key` | 12            | 0                       | 0.190        |

Development's initial guard/plan-parser tests failed before their implementation existed, then
passed. An initial representative-data insert exposed required timestamp/type/length constraints;
the fixture transaction rolled back and was corrected before the final runs. Pre-index plans
exposed the two sequential scans above. No assertions or planner settings were weakened to pass.
Only synthetic throwaway databases were written; all three owned test containers/volumes were
removed after verification. No existing database, provider account or board status was changed.

No browser/UI, live Omise account/QR/external webhook delivery or shared environment is certified.
DB06 owns the final clean-system rehearsal; these tests do not mark DB06 complete.
