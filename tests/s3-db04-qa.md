# S3-DB04 — deterministic fixtures and test guide

Source: [DB04 acceptance card](https://trello.com/c/EBurjaoR).
Verified on 2026-11-11 against `main` baseline `d057d68`, with Node 24.19.0,
pnpm 11.19.0 and disposable PostgreSQL 17 Alpine. No shared database or Omise call was used.

## เริ่มใช้ / entry points

ใช้ **seed รวมเดิม** `pnpm db:seed`; `runSeed()` เรียก Sprint 1, 2 และ 3 ใน transaction เดียว
โดย DB04 ไม่เพิ่มคำสั่ง seed อีกชุด และไม่เปลี่ยน schema/migrations/API contracts.

| File (relative to repository root)                                   | Responsibility                                                                                                   |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/infrastructure/database/seed/sprint3-fixtures.ts`      | Pure fixture inputs, semantic case keys, fixed IDs and injected clock; safe to import in unit tests without a DB |
| `apps/api/src/infrastructure/database/seed/sprint3-fixtures.seed.ts` | Persist those inputs using existing constraints and reservation/consumption triggers                             |
| `apps/api/src/infrastructure/database/seed.ts`                       | Existing combined seed; accepts an optional `now` for deterministic tests                                        |
| `apps/api/test/unit/database/seed/sprint3-fixtures.spec.ts`          | Independent expected report/review/coupon inputs, clock shifting and real reminder policy checks                 |
| `apps/api/test/unit/database/seed/sprint3-fixture-verifier.spec.ts`  | Reject unsafe disposable verifier targets; importing the verifier never executes it                              |
| `apps/api/scripts/verify-sprint3-fixtures.ts`                        | Real PostgreSQL, combined seed reruns, service reads, notification writes and preservation checks                |

Fixture ≠ test: fixture เป็นข้อมูลตั้งต้น ส่วน test ต้องเรียกพฤติกรรมจริงแล้วตรวจผลตามตารางด้านล่าง.
Unit tests ใช้ `buildSprint3Fixtures()` ใน memory ได้; integration tests ต้องลงข้อมูลใน DB ทดสอบแยก.

## Clock, identities and isolation

`SPRINT3_FIXTURE_NOW = 2030-12-31T17:00:00.000Z` (1 January 2031, 00:00 Bangkok).
Always pass this same anchor to `runSeed(prisma, SPRINT3_FIXTURE_NOW)` in deterministic tests.
Normal `pnpm db:seed` uses the current time on first creation; rerunning preserves original DB04
times and subsequent live changes. Rebuilding fixture inputs with another anchor does **not** move
already stored classes: start from a fresh disposable DB when changing test time or resetting tests.

`SPRINT3_IDS` exports students, tutor IDs and the dedicated subject/grade. Classes export `key`,
`id`, `slotId`, `reviewId`, `attemptId`, `reservationId`, `studentId`, `tutorId` and timestamps.
Resolve by key; do not copy array positions into tests. Persisted operation IDs are append-only:
append new cases rather than inserting/reordering existing ones. All DB04 IDs use `db040000-…`.

There are **61 bookings, 62 slots (one prior reschedule slot), 12 coupons, 5 reviews,
8 provider-stub attempts, 8 reservations, 4 consumed uses, 1 approved reschedule and 1 historical
notification**. There are 5 synthetic student users and 11 isolated tutors/listings. DB triggers
also create append-only coupon audit records; audit IDs/times remain database-generated. These
counts concern DB04, not earlier sprint rows also created by the combined seed.

Synthetic identities use `.invalid` addresses and `passwordHash: null`, following existing
non-loginable search fixtures. They have current consent for service testing. The ordinary three
configured demo accounts retain the existing environment/password-hashing setup. Never embed real
credentials in tests. For authenticated HTTP/browser tests, use your suite's session/JWT setup with
the exported synthetic user ID; password login for synthetic users is intentionally unavailable.

Each report/review group has its own tutor to prevent aggregates leaking between scenarios.
Reminder starts are three days apart, so one 24-hour `runOnce()` scan cannot select a neighbouring
scenario. The explicit Bangkok New Year scenario is isolated at anchor +365 days.

## Review cases

| Tutor key in `SPRINT3_IDS.tutors` | Class keys                 | Raw ratings     | Expected average / count                                                |
| --------------------------------- | -------------------------- | --------------- | ----------------------------------------------------------------------- |
| `review433`                       | `review-545`, `review-444` | 5/4/5 and 4/4/4 | **4.33 / 2**, aggregate dimensions first, HALF_UP only at final display |
| `review400`                       | `review400`                | 4/4/4           | 4.00 / 1                                                                |
| `review100`                       | `review100`                | 1/1/1           | 1.00 / 1                                                                |
| `review500`                       | `review500`                | 5/5/5           | 5.00 / 1                                                                |
| `newTutor`                        | None                       | No reviews      | null / 0                                                                |

Every seeded review has a completed, attended, paid booking owned by its author. Verify through
`TutorDirectoryService.getPublicTutor()` and `ReviewsService.findMine()`. The individual 5/4/5
review displays **4.67**; averaging its rounded display with 4.00 would incorrectly give 4.34.
The verifier separately queries raw PostgreSQL averages and compares with literal expected values.
`report-3` is completed and unreviewed, suitable for a new review test; successful review creation
and another student's rejected read are exercised by the verifier.

## Report cases

| Tutor key           | Data                                                                            | Expected                                                             |
| ------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `report905`         | `report-1` through `report-12`                                                  | Total 12; completed 6; canceled 2; pending 3; confirmed 1; expired 0 |
| `report905`         | `report-1`: 450.00 −45.00 =405.00, paid with WELCOME10; `report-2`: 500.00 paid | Paid completed revenue **905.00 THB**                                |
| `report905`         | `report-3` through `report-6` completed but unpaid                              | Excluded from revenue; still included in completion count            |
| `report905`         | Finalized denominator: 6 completed +2 canceled                                  | **75%** completion                                                   |
| `reportExpired`     | One `report-expired` booking                                                    | EXPIRED 1; no finalized bookings → N/A completion                    |
| `reportUnfinalized` | One `report-unfinalized` confirmed unpaid booking                               | No finalized bookings → N/A completion                               |
| `reportEmpty`       | No bookings                                                                     | Total/revenue 0; completion N/A                                      |

Read stored `netAmount`, not today's listing price. Other tutor groups contain bookings on purpose
to expose missing ownership filters. The real report endpoint/UI remains S3-T09/T10/T11 work:
DB04 verifies the persisted ledger, arithmetic and existing booking-detail wire snapshots, not a
report endpoint that does not exist yet.

## Coupon and payment cases

Coupon keys below belong to `buildSprint3Fixtures().coupons`; class keys belong to `.classes`.

| Coupon/case key                              | Initial state                                                                | Action and expected result for consuming tests                                           |
| -------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `welcome10` / WELCOME10                      | Active 10%, maxUses 20, expiry anchor +1 day; one consumed use in `report-1` | Apply to a fresh eligible booking: 450.00 /45.00 /405.00 snapshot                        |
| `free100` / `free-ready`                     | 100%, fresh unpaid net 0.00 for `otherStudent`                               | Zero settlement: consume once, mark paid with coupon receipt, no Omise attempt           |
| `free100` / `free-settled`                   | Already paid net 0.00 for `student`                                          | One use; reference `coupon:<reservationId>`; zero attempts; retry must not consume twice |
| `inactive`                                   | Active false                                                                 | Applicability must reject                                                                |
| `expired`                                    | Expiry anchor −1 ms                                                          | Reject at anchor                                                                         |
| `expiresNow`                                 | Expiry exactly anchor                                                        | Reject at anchor under exclusive expiry policy                                           |
| `expiresNext`                                | Expiry anchor +1 ms                                                          | Unexpired at anchor; expired at +1 ms                                                    |
| `exhausted` / `exhausted-used`               | maxUses 1, one consumed use                                                  | Remaining capacity 0                                                                     |
| `lastUse` / `lastUse-used`                   | maxUses 2, one consumed use by `student`                                     | Remaining capacity **1**                                                                 |
| `last-use-a`, `last-use-b`                   | Same lastUse coupon, different active students, no attempts/reservations yet | Inputs for DB05/T26 last-use race; only one future settlement may succeed                |
| `same-student-reuse`                         | New booking by already-used `student`, same lastUse coupon                   | Future apply/reserve rejects same-student reuse                                          |
| `report-1`, `exhausted-used`, `lastUse-used` | Already redeemed bookings                                                    | Inputs for duplicate-booking/retry tests                                                 |
| `active`                                     | PENDING attempt; RESERVED; unpaid/paymentPending                             | Capacity held, no use; do not duplicate charge                                           |
| `uncertain`                                  | CREATING without charge ID; RESERVED; `PROVIDER_RESULT_UNKNOWN`              | Unknown outcome keeps capacity; do not release or duplicate                              |
| `released-failed`                            | FAILED attempt, RELEASED reservation                                         | No CouponUse; released capacity available                                                |
| `released-expired`                           | EXPIRED attempt, RELEASED reservation                                        | Same release behavior with confirmed provider expiry                                     |
| `below-provider-minimum`                     | 20.00 −2.00 =18.00; no attempt                                               | Positive net below 20 is unsupported; do not fabricate a provider attempt                |
| `coupon-unapplied`                           | Confirmed unpaid 450.00, no coupon, `otherStudent`                           | Fresh input for quote/apply/remove tests of the coupon variants above                    |

Capacity = uses + RESERVED, not uses + all reservations. CONSUMED is counted only through its use.
The stored active/uncertain examples deliberately have elapsed provider expiry times: elapsed time
alone must never release an unresolved claim. Each uses its own coupon to avoid per-student claim
conflicts. Positive settlements persist matching successful attempt, consumption and Booking
snapshot in one transaction; zero settlements use the null-attempt path. `CouponUse` is created
by the existing consumption trigger, never inserted directly by seed code.

`chrg_test_DB04…` values are **synthetic provider-stub IDs**, not charges returned by Omise. They
must not be reconciled against live Omise. The seed does not call a provider. `/mock-payment`
remains retired (410). Fresh coupon payments remain blocked by existing DB03 orchestration until
S3-T25/T26 implements application/reservation/settlement; the table documents future consuming
test expectations, not evidence those endpoints already work.

## Reminder cases

Use `.reminders` to obtain each case's **own `now`**, booking ID, expected band and recipient count.
The suffixes `-unpaid` and `-paid` exist for every boundary below.

| Case prefix         | start − now      | Expected band |
| ------------------- | ---------------- | ------------- |
| `24h-plus-1ms`      | 24h +1 ms        | None          |
| `24h`               | 24h              | 24H           |
| `24h-minus-1ms`     | 24h −1 ms        | 24H           |
| `1h-plus-1ms`       | 1h +1 ms         | 24H           |
| `1h`                | 1h               | 1H            |
| `1h-minus-1ms`      | 1h −1 ms         | 1H            |
| `start-minus-1ms`   | 1 ms             | 1H            |
| `start`             | 0                | None          |
| `start-plus-1ms`    | −1 ms            | None          |
| `late-first-run-2h` | 2h, no prior run | 24H only      |

With the payment lifecycle fix, unpaid sends PAYMENT only to student (1). Paid sends CLASS to both
(2), never PAYMENT. `skip-canceled`, `skip-pending`, `skip-completed`, `skip-expired` send none.
`inactive-student` and `deleted-student` are unpaid and send none.
`payment-pending` remains unpaid and sends 1. Running the same case twice adds zero notifications;
advancing `24h-unpaid` to its 1H point yields 2 total across the two separate bands.

`rescheduled` has an approved RescheduleRequest, an old slot and one historical old-occurrence
CLASS notification. At its new occurrence, expect **1 new notification +1 retained history**;
old keys cannot suppress the new occurrence or create duplicate old events. Notification event keys
include booking, slot, UTC start, band and kind. `bangkok-year-midnight` begins at
`2031-12-31T17:00:00.000Z` = 1 January 2032 00:00 Bangkok, tested at one hour before start.

## Example consuming test

Inside an API integration test with configured synthetic demo seed environment and its own fresh
disposable database:

```ts
import { runSeed } from '@infrastructure/database/seed';
import {
  buildSprint3Fixtures,
  SPRINT3_FIXTURE_NOW,
  SPRINT3_IDS,
} from '@infrastructure/database/seed/sprint3-fixtures';

await runSeed(prisma, SPRINT3_FIXTURE_NOW);
const fixtures = buildSprint3Fixtures(SPRINT3_FIXTURE_NOW);
const scenario = fixtures.reminders.find((row) => row.key === '1h-paid');
if (!scenario) {
  throw new Error('Missing 1h-paid fixture');
}
await reminderJob.runOnce(scenario.now);
const notifications = await prisma.notification.findMany({
  where: { bookingId: scenario.bookingId },
});
expect(notifications).toHaveLength(2);
expect(notifications.map((row) => row.eventType)).toEqual([
  'CLASS_REMINDER_1H',
  'CLASS_REMINDER_1H',
]);

const detail = await tutorDirectory.getPublicTutor(SPRINT3_IDS.tutors.review433);
expect(detail.tutor.ratingAverage).toBe(4.33);
expect(detail.tutor.reviewCount).toBe(2);
```

Expected values in consuming tests must come from these acceptance examples, not by recomputing
the same implementation formula or asserting a fixture field against itself. Unit tests can use
only `buildSprint3Fixtures` without calling seed or touching any DB. UI suites can reuse the
semantic cases as response input, but mocked browser evidence does not prove database persistence.
Mutable tests need their own fresh DB; running tests concurrently against one seeded database will
contaminate capacities, reviews and notifications. Re-seeding deliberately does not undo changes.

## Real database verification and cleanup

From the repository root, use a **new** container and explicit URL. The password below is a
throwaway local-only example, not a project credential. The verifier does not load `.env`,
run migrations itself, clear tables, or call external services. It requires zero users initially,
all committed migrations, explicit opt-in and a loopback `hktutor_*_test` database with no URL
options/fragments. It creates random temporary configured demo passwords in memory and never prints
them. The initial rollback/collision probe is followed by the same combined `runSeed` used by
`pnpm db:seed`; this is a verification command, not a second seed implementation.

```bash
docker run --detach --name hktutor-s3-db04-test \
  --publish 127.0.0.1:55464:5432 \
  --env POSTGRES_USER=postgres --env POSTGRES_PASSWORD=disposable-local-only \
  --env POSTGRES_DB=hktutor_db04_test postgres:17-alpine
docker exec hktutor-s3-db04-test pg_isready -U postgres -d hktutor_db04_test
export DATABASE_URL='postgresql://postgres:disposable-local-only@127.0.0.1:55464/hktutor_db04_test'
pnpm db:migrate:deploy
HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 pnpm db:verify:sprint3-fixtures
# Inspect synthetic evidence if needed, then discard only this owned disposable container.
docker rm --force --volumes hktutor-s3-db04-test
unset DATABASE_URL
```

For a UI/demo stack, the existing `pnpm db:seed` still reads configured demo credentials from `.env`
and seeds whichever database `DATABASE_URL` selects. This command is not made disposable-only;
confirm the intended demo/disposable target before running it. No new environment configuration is
required. DB04 rows are create-once and existing live changes remain intact. Existing Sprint 2
attendance-reset behavior remains for an unreviewed legacy demo class without provider/coupon
evidence; classes with reviews, attempts, reservations or uses are protected from that reset.

## Acceptance evidence

| Requirement                                                             | Executable evidence                                                                                                              |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Combined entry point and deterministic inputs                           | `sprint3-fixtures.spec.ts`; real verifier calls `runSeed`                                                                        |
| IDs, injected time, no mutation between builds                          | `sprint3-fixtures.spec.ts`                                                                                                       |
| Reviews 4.33/null/1/5, true aggregates                                  | Verifier: raw SQL plus public detail service; owner review read and rejection                                                    |
| 905.00, 12-status ledger, 75%, N/A inputs, isolation                    | Verifier: persisted tutor-scoped ledger and independent literal expectations                                                     |
| Coupon, capacity, reservations, free receipt, unsupported amount inputs | Verifier: real constraint-backed rows; triggers create canonical use/audit                                                       |
| ±1 ms, paid/unpaid/status/recipient/catch-up cases                      | Unit policy test plus 29 real `runOnce` scenarios                                                                                |
| Repeat jobs and separate occurrence/band keys                           | Verifier: repeat creates zero, 24H→1H, retained old reschedule notification                                                      |
| No destructive rerun                                                    | Verifier: full DB04 row/audit/notification snapshot before/after repeat and next-day seeds                                       |
| Changed live data retained                                              | Verifier: service-created review, changed meeting URL/uncertain attempt, provider-backed Sprint 2 demo, edited live price/coupon |
| Failure atomicity/non-fixture preservation                              | Verifier: identity collision rolls back combined seed; enclosing transaction failure; unrelated sentinel unchanged               |
| Unsafe verifier targets rejected                                        | `sprint3-fixture-verifier.spec.ts`                                                                                               |

Latest real DB run: **41 grouped checks passed**, all **27 committed migrations** applied to a new
PostgreSQL 17 database. Synthetic append-only evidence is retained until the disposable container
is discarded. The verifier intentionally adds a review, notifications and live-state changes after
checking the initial counts, so final retained rows differ from the initial fixture inventory.

| Command actually run                                                                                         | Result                                                                                                          |
| ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `pnpm db:validate` and `pnpm db:generate`                                                                    | Passed                                                                                                          |
| `pnpm --filter @hktutor/api test --runInBand test/unit/database/seed`                                        | 9 suites / 42 tests passed                                                                                      |
| `pnpm --filter @hktutor/api lint`                                                                            | Passed, zero warnings                                                                                           |
| `pnpm --filter @hktutor/api build`                                                                           | Passed, including script typecheck                                                                              |
| `pnpm check`                                                                                                 | Passed: formatting, root/package lint, API 92 suites / 1,630 tests, web 49 files / 763 tests, production builds |
| `pnpm verify:workspace`                                                                                      | 136 tests passed                                                                                                |
| `HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 pnpm db:verify:sprint3-fixtures` with an explicit fresh disposable URL | 41 grouped checks passed                                                                                        |
| `git diff --check`                                                                                           | Passed                                                                                                          |

The last focused seed and PostgreSQL reruns include the final upcoming coupon-slot inputs.
Sandboxed Supertest listeners and subprocess-ESLint stdin initially failed; running the same
checks with the required local process permissions passed without weakening assertions.
The PostgreSQL container and temporary baseline worktree were removed after verification.

This evidence does not certify live Omise, browser rendering, report or coupon application APIs
still owned by other tasks, or the full concurrent final-use/review race matrix (DB05). DB06 owns
the final clean-environment rehearsal and full reminder/audit persistence coverage.
