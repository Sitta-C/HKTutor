# S3-T11 — tutor report arithmetic, revenue, empty data and access QA

Verified 2026-11-13 (Asia/Bangkok) from `main` at `a101733`, after S3-T09
(`GET /api/v1/reports/tutor/me`) and S3-T10 (tutor report page) merged. This task adds tests and
documentation only. The production report service, controller, DTOs, schema and web components
are unchanged.

Sprint 3 Backlog row: _Test report arithmetic, discounted revenue, empty data and role/ownership
access_. Its acceptance examples are 405 + 500 = 905 THB, completion = 6 / (6 + 2) = 75%, and
N/A when no class is finalized.

## What was missing

The S3-T09 Jest unit and HTTP suites replace `PrismaService` with mocks, so the
`groupBy` statement, the enum mapping and the guards' database lookups had never run against
PostgreSQL. The DB04 fixture verifier checks the 905.00 ledger with its own Prisma queries but never
calls the report endpoint.

## Coverage

`apps/api/scripts/verify-tutor-reports.ts` (`pnpm db:verify:tutor-reports`) runs the real
`ReportsController`, `ReportsService`, `JwtAuthGuard`, `RolesGuard`, consent check and global
validation pipe over HTTP against a disposable PostgreSQL database. Access tokens are signed for
real `AuthSession` rows. Every report is also compared with `expectedTutorReport`, a separate
row-by-row oracle over raw `Booking` rows.

| Acceptance point        | Assertion                                                                                                                                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 905 THB / 75% example   | DB04 `report905` tutor returns exactly 12 total, PENDING 3 / CONFIRMED 1 / COMPLETED 6 / CANCELED 2 / EXPIRED 0, `905.00` THB and `{ completed: 6, finalized: 8, percent: 75 }`, with `Cache-Control: no-store`                |
| Discounted revenue      | A direct SQL cross-check shows revenue is the discounted net (405.00 from WELCOME10 plus 500.00). It is neither the 950.00 subtotal nor the 5405.00 all-status net                                                             |
| Revenue exclusions      | A verifier tutor has paid completed nets 0.10 + 0.20 + 333.33, plus unpaid completed 999.99, paid confirmed 777.77, canceled 888.88, expired 111.11 and pending 222.22. Revenue is exactly `333.63` and the rate is 4 / 5 = 80 |
| Empty data → N/A        | The empty, expired-only and confirmed-only DB04 tutors return zero revenue `0.00` and `percent: null`                                                                                                                          |
| Rounding                | Verifier ledgers of 1/32, 2/3 and 1/3 return 3.13, 66.67 and 33.33. 1/32 = 3.125% is the case that separates HALF_UP (3.13) from banker's rounding (3.12)                                                                      |
| History and freshness   | Archiving and soft-deleting a listing keeps its bookings in the report. New bookings show on the next read (450.00 → 855.00, rate 66.67)                                                                                       |
| Authentication (401)    | Missing token, expired token, token signed with another key, revoked session                                                                                                                                                   |
| Role and consent (403)  | Student, admin, a student token whose role claim says TUTOR (the guard uses the database role), and a tutor with an outdated privacy policy version (`Accept the current privacy notice to continue.`)                         |
| Ownership               | `?tutorId=<other tutor>` and a body `{ tutorId }` are rejected with 400 `VALIDATION_FAILED`. The empty tutor still sees only its own zero report                                                                               |
| Isolation and read-only | 24 interleaved concurrent reads across four tutors each match that tutor's report. A SHA-256 of every `Booking` row is unchanged after all reads                                                                               |

### Unit and web tests

- `apps/api/test/unit/reports/tutor-report-verifier.spec.ts` covers the runner's target gate:
  explicit opt-in, loopback only, exact `hktutor_s3_t11_test` name, no options or fragments. It
  also rebuilds the 905 / 75% ledger from the pure DB04 inputs. Seven ledgers (empty, expired,
  unfinalized, 1/32, 2/3, 1/3, all completed) are run through both the oracle and `ReportsService`
  to show they agree.
- `apps/web/test/tutor-report.test.ts` checks that the page shows the API's rounded rate unchanged
  (3.13%, 66.67%, 33.33%, 80%, 100%, 0%) in English and Thai, and English `N/A` for a null rate.

## Commands and results

Run against a throwaway local PostgreSQL 18.3 cluster on `127.0.0.1:55432`. It was not a shared
or production database, and it was deleted afterwards.

```bash
psql 'postgresql://postgres@127.0.0.1:55432/postgres' -c 'CREATE DATABASE hktutor_s3_t11_test'
DATABASE_URL='postgresql://postgres@127.0.0.1:55432/hktutor_s3_t11_test' pnpm db:migrate:deploy
HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 \
  DATABASE_URL='postgresql://postgres@127.0.0.1:55432/hktutor_s3_t11_test' \
  pnpm db:verify:tutor-reports
```

```text
PASS [ReportsController over HTTP + PostgreSQL] DB04 ledger returns 12 total, 3/1/6/2/0, 905.00 THB and 6/(6+2)=75% (oracle agrees)
PASS [ReportsController over HTTP + PostgreSQL] revenue is discounted net 405.00 + 500.00, not subtotal 950.00 nor the 5405.00 all-status total
PASS [ReportsController over HTTP + PostgreSQL] empty, expired-only and confirmed-only ledgers return 0.00 THB and null percent
PASS [ReportsController over HTTP + PostgreSQL] completion rate rounds HALF_UP to 3.13, 66.67 and 33.33 on PostgreSQL ledgers
PASS [ReportsController over HTTP + PostgreSQL] only PAID+COMPLETED net counts: 0.10+0.20+333.33 = 333.63 exactly; unpaid completed, paid confirmed, canceled, expired and pending excluded
PASS [ReportsController over HTTP + PostgreSQL] archived+deleted listing history still counts; new bookings show on the next uncached read
PASS [ReportsController over HTTP + PostgreSQL] 401 missing/expired/wrong-key/revoked; 403 student, admin, forged TUTOR claim and outdated consent
PASS [ReportsController over HTTP + PostgreSQL] another tutor's ID in query or body is rejected 400 and never widens the report
PASS [ReportsController over HTTP + PostgreSQL] 24 interleaved concurrent reads stay isolated per tutor and leave every booking row unchanged
S3-T11 tutor report verification: 9 checks passed.
```

To confirm the runner can fail, `ROUND_HALF_UP` in `reports.service.ts` was temporarily changed to
`ROUND_HALF_EVEN` and the runner was rerun on a fresh database. It failed at the rounding check
(3.12 instead of 3.13). The change was reverted before committing.

Focused checks:

```bash
pnpm --filter @hktutor/api exec jest test/unit/reports
pnpm --filter @hktutor/web exec vitest run test/tutor-report.test.ts
```

## Limitations

- The runner boots only the report controller and its guards, not the whole `AppModule`. The full
  journey is covered by S3-T37.
- The report remains all-time with no date filters; the backlog asks for no more.
- Suspended or deleted tutor accounts are already covered by the shared `JwtAuthGuard` tests and
  are not repeated here.
