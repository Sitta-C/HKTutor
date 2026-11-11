# S3-DB03 verification evidence

Verified 2026-11-11 against
[Trello S3-DB03](https://trello.com/c/1gsqWSoD/216-s3-db03-migrate-booking-discount-snapshots-and-authoritative-payment-amount-fields-safely)
and the Data Model Booking row. The card's current code baseline takes precedence over the
sheet's older field list.

## Delivered

- Additive nullable Booking/PaymentAttempt coupon FK, code and percent snapshots; no money or
  provider field is recreated or backfilled. Legacy money, payment state and receipts stay intact.
- Existing nonnegative, balance, THB, provider-range, payment-reference uniqueness and active/success
  partial indexes retained. Snapshot completeness, percent, canonical application data and exact
  rounded discount checks added.
- Database guards freeze booking pricing/coupon during pending/paid payment, active attempts or
  reservations and permanent consumption. New attempts copy the exact booking snapshot and retain
  immutable amounts/coupon evidence. Snapshot-bearing reservations validate the persisted discount
  and attempt before DB02 copies that amount to CouponUse.
- New zero pricing requires a full coupon. A deferred paid-receipt constraint checks a matching
  CouponUse and `coupon:<useId>` at commit. Positive coupon receipts also require the matching
  successful provider attempt. No zero Omise attempt is created.
- Student/tutor booking reads and payment responses expose stored coupon evidence; current-payment
  reads return stored money in one repeatable-read snapshot. DTOs, Swagger and web wire types align.
  A fresh coupon charge is explicitly blocked until T26 installs capacity/consumption orchestration.

## Actual commands/results

Node 24.19.0, pnpm 11.19.0, PostgreSQL 17 Alpine. No shared/dev database, seed or live Omise
request was used. A new container `hktutor-s3-db03-test` published only `127.0.0.1:55453`.

| Command/check                                                                                         | Result                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm db:validate` / `pnpm db:generate`                                                               | Passed                                                                                                                                       |
| `pnpm verify:workspace`                                                                               | 135 passed                                                                                                                                   |
| `pnpm --filter @hktutor/api test --runInBand --testPathPatterns='payments.service\|bookings.service'` | 215 passed                                                                                                                                   |
| `pnpm --filter @hktutor/api test --runInBand`                                                         | 90 suites / 1,614 passed                                                                                                                     |
| `pnpm --filter @hktutor/api test:e2e --runInBand`                                                     | 25 suites / 664 passed                                                                                                                       |
| `pnpm --filter @hktutor/api lint` / `build`                                                           | Passed, including operational script typecheck                                                                                               |
| `pnpm check`                                                                                          | Passed formatting, all workspace lint, 1,614 API tests, 725 web tests and API/web builds                                                     |
| Guarded `pnpm db:verify:booking-snapshots`                                                            | All four upgrade/constraint/settlement/contention groups passed                                                                              |
| Explicit disposable `DATABASE_URL` + `pnpm db:migrate:deploy`                                         | All 26 committed migrations applied on a separate empty test database                                                                        |
| Guarded `pnpm db:verify:coupons`                                                                      | All four DB02 groups passed, including capacity/reuse/rollback/RLS/index regression                                                          |
| Guarded `pnpm db:verify:admin-coupons`                                                                | Six real HTTP/PostgreSQL checks passed                                                                                                       |
| Guarded `pnpm db:verify:payments`                                                                     | Passed duplicate claims, callback replay, timeout recovery, rejection/retry, eight payment/cancellation races and rollback; Omise is stubbed |

The first unrestricted API test attempt inside the filesystem/network sandbox could not bind local
Supertest ports (`listen EPERM`). Re-running with local-port access passed the complete unit and HTTP
suites above. Initial upgrade-harness runs exposed PostgreSQL parameter-inference errors in its
synthetic fixtures; explicit UUID/integer casts fixed those fixtures. The successful upgrade used a
fresh empty `hktutor_booking_snapshot_v3_test`; the harness never resets a failed-run database.
Clean Prisma deployment and regression verifiers used `hktutor_snapshot_deploy_test` in the same
isolated container. After verification, `docker rm --force --volumes hktutor-s3-db03-test`
removed the task-created container and all of its synthetic test databases.

## Database evidence

The old-to-new harness replays every committed SQL migration through DB02, inserts mock-paid,
PromptPay creating/pending/successful/failed, completed historical discount/zero, canceled and
approved/rescheduled fixtures, then executes DB03. JSONB text comparisons prove every original
Booking/PaymentAttempt column is unchanged; all new coupon fields are null. Existing index
definitions and every original money/provider check except the intentionally extended receipt
check are compared before/after. The listing deliberately costs 999 while historical bookings
retain 450, 405 and zero.

New 10% evidence checks `450.00 / 45.00 / 405.00`, incomplete/forged snapshots, invalid percentages,
missing coupon FK, invalid money/NaN/currency, immutable provider amounts, refusal to change pricing
with an active attempt, and stable snapshots after editing the live coupon. A matching successful
attempt/reservation consumes exactly `45.00` in CouponUse and pays the booking atomically.

Full-discount evidence checks `450.00 / 450.00 / 0.00`, rejects a forged/missing use, settles with a
matching canonical CouponUse and no provider attempt, and rejects rewriting its receipt. New zero
pricing without a full coupon is rejected while legacy zero history survives the upgrade.

The contention test observes `pg_blocking_pids` while a payment transaction holds the booking row.
A competing amount update waits, then fails after paymentPending and the attempt commit; it cannot
alter the charged amount. Unit coverage also checks the service compares the complete money/coupon
snapshot and does not call Omise after losing a stale claim.

The existing DB02 verifier's zero fixture now applies a real 100% snapshot; its immutable attempt
reparenting check expects the earlier DB03 trigger rejection. No shared migration was rewritten.

## Deployment and scope limits

Apply DB03 before the updated API through the normal reviewed deployment process. Roll back application code while
retaining additive snapshot/evidence columns; never reconstruct historical receipts from live data.

T25 owns quote/apply/remove routes, active/expiry/applicability and their role/consent/ownership
checks. T26 owns atomic capacity reservation, verified provider consumption/release, recovery and
the runtime zero settlement route. Those endpoints were not added under this database card. Stored
coupon responses use `{ id, code, percent }`, independent of mutable Coupon data. The existing
`/mock-payment` route remains 410. Provider verification uses a stub and persisted synthetic terminal
evidence; these results do not certify live Omise, delivery of webhooks or a coupon UI journey.

## Confirmed dev rollout

On 2026-11-11, the user explicitly confirmed the configured database is dev and authorized applying
the migration. `pnpm db:migrate:status` identified only
`20261111120000_add_booking_coupon_snapshots` as pending. `pnpm db:migrate:deploy` applied it
successfully, and a subsequent `pnpm db:migrate:status` exited successfully with
`Database schema is up to date!` across all 26 migrations.

No seed, reset, disposable verifier or provider-charge operation was run against dev. The database
verification evidence above remains from the isolated disposable PostgreSQL databases.
