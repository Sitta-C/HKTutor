# S3-DB02 verification evidence

Verified on 2026-11-09 against the scope of
[Trello S3-DB02](https://trello.com/c/O6Kb4hB9/215-s3-db02-create-coupon-redemption-reservation-and-audit-migrations-with-usage-constraints).

## Delivered contract

- Additive Coupon, CouponUse, CouponReservation and minimal AuditLog migration and Prisma models.
- Trimmed/uppercase CITEXT codes, percent/maxUses/amount/state checks, composite booking/student
  and attempt/booking foreign keys, permanent student/booking redemption uniqueness and partial
  reservation claim indexes.
- Booking → coupon row writes serialize claim/capacity changes, including direct SQL and stale
  repeatable-read snapshots. Capacity counts uses plus RESERVED rows, without double-counting
  CONSUMED reservations or maintaining a mutable counter.
- Canonical reservation consumption creates CouponUse and safe, append-only audit evidence
  atomically. Provider-backed terminal transitions require persisted SUCCESSFUL or FAILED/EXPIRED
  evidence. A null-attempt immediate consumption requires Booking.netAmount=0.
- Stable insert IDs support matching-input `ON CONFLICT (id) DO NOTHING`; consumed/released
  transition retries preserve one use and one event. Identity, amount and terminal evidence cannot
  be rewritten. Audit failures undo the complete settlement write.
- RLS, browser-role/PUBLIC grant revocation, append-only and no-truncate protections; existing
  payment and reschedule constraints retained.

## Actual checks

| Command/check                                                                            | Result                                                                                                                                |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm db:validate`                                                                       | Passed                                                                                                                                |
| `pnpm db:generate`                                                                       | Passed                                                                                                                                |
| `pnpm verify:workspace`                                                                  | 133 passed                                                                                                                            |
| `pnpm --filter @hktutor/api lint`                                                        | Passed                                                                                                                                |
| `pnpm check`                                                                             | Passed: formatting, root/web/API lint, 83 API suites / 1,513 tests, 40 web files / 540 tests, API/script typecheck and web/API builds |
| Explicit disposable `pnpm db:migrate:deploy`                                             | All 25 migrations applied from empty PostgreSQL 17 database                                                                           |
| Opted-in `pnpm db:verify:coupons`                                                        | Passed all four verification groups below                                                                                             |
| `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` | Empty migration (no Prisma schema drift)                                                                                              |
| `git diff --check`                                                                       | Passed                                                                                                                                |

The final clean migration and coupon verification used a new database named
`hktutor_coupon_final_test` on `127.0.0.1:55449`, inside the task-created
`hktutor-s3-db02-test` PostgreSQL 17 container. No shared/demo database, seed, payment provider or
Storage service was used. The verifier retains synthetic immutable evidence; the task container
is removed after verification. Earlier scratch runs also stayed inside that same disposable
container. The initial sandboxed broad check hit Supertest `listen EPERM`; the rerun with local
socket access passed all tests and builds.

The standalone database runner printed:

```text
Coupon boundaries and normalized concurrent code collision passed.
Identity, state, terminal-provider evidence, retry and permanent claim checks passed.
Observed capacity, stale snapshot, student claim, booking claim and maxUses races passed.
Zero settlement, audit atomicity/rollback, safe JSON, append-only evidence, RLS/grants and indexes passed.
```

Contention checks explicitly observed `pg_blocking_pids` before committing the first writer. They
cover normalized code collision, last capacity, same student/different bookings, same booking/different
coupons, limit reduction, stale repeatable-read rejection, concurrent consumption retries and
release followed by a waiting new claim. Additional direct checks cover percent 1/100 and invalid
bounds/types, blank normalized code, invalid money including NaN, wrong identities, rejected
nonterminal transitions, release/retry, permanent use, zero settlement, forged CouponUse, immutable
parent identities, safe JSON, audit context, UPDATE/DELETE/TRUNCATE protection and existing indexes.

Audit atomicity was verified both by rolling back a successful consumption transaction and by
forcing the audit insert to fail its request-ID check after the consumption trigger inserted the
use. In both cases the use/event were absent and the original RESERVED claim remained.

## Scope limits

This card adds persistence, no HTTP routes, DTOs, UI, seeds or runtime coupon writer. API tests do
not certify live Omise or webhook authenticity. Existing payment fields/checks are preserved;
S3-DB03 and S3-T26 must implement the zero-amount paid-booking contract and atomically update
Booking/payment state with coupon settlement. Current consent, role/ownership, applicability and
expiry checks, discount calculation and authenticated audit context belong to their API cards.
The database terminal-status check trusts the provider evidence persisted by that API.

## Confirmed dev rollout

On 2026-11-09, after the user explicitly confirmed that the configured database is the dev
environment and authorized applying the migration:

- `pnpm db:migrate:status` reported only `20261109120000_add_coupon_persistence` pending.
- `pnpm db:migrate:deploy` applied that migration successfully.
- A subsequent `pnpm db:migrate:status` exited successfully with `Database schema is up to date!`
  across all 25 migrations.

The disposable concurrency verifier was not run against dev; its evidence above remains from the
isolated PostgreSQL 17 test databases. No seed or data-reset command was run during this rollout.

## PR validation on current main

The task branch was rebased onto `origin/main` at `6768f4e` before opening the PR. The additive
README and package-script conflicts were resolved by retaining both features. The applied migration
SQL is byte-for-byte unchanged from the dev rollout.

The rebased branch passed `pnpm check` with 87 API suites / 1,574 tests and 42 web files / 611 tests,
plus all formatting/lint and API/script/web builds. `pnpm verify:workspace` passed all 133 contracts.
