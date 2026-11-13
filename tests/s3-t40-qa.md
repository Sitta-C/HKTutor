# S3-T40 — final demo fixtures, deployment/runbook checks and clean-environment rehearsal

Rehearsed 2026-11-13 (Asia/Bangkok) from `main` at `a101733`. Sprint 3 Backlog row: _Prepare final
demo fixtures, deployment/runbook checks and clean-environment rehearsal_. Acceptance: safe
environment placeholders, migration and seed instructions, backup/rollback notes, known issues and
a three-role rehearsal.

## Changes

| Area             | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Demo fixture     | `apps/api/src/infrastructure/database/seed/sprint3-demo.seed.ts`, called by `runSeed` after the Sprint 2 demo. It adds one **completed, attended, mock-paid** Anan × Nan class three Bangkok days before the seed run (400.00 THB, reference `DEMO-SEED-S3-REVIEW-READY`) with no review. The review demo no longer depends on recording attendance first, and the tutor report has paid, completed revenue from the start. It is create-only, so a rehearsal review is never overwritten. Fixed IDs `30000000-…0301` / `40000000-…0301` |
| Unit tests       | `test/unit/database/seed/sprint3-demo.seed.spec.ts` covers Bangkok calendar placement, the exact completed/paid/attended snapshot, no review, create-only re-seed and safe demo values. `test/unit/database/sprint3-demo-verifier.spec.ts` covers the database gate and the synthetic environment                                                                                                                                                                                                                                        |
| Rehearsal runner | `pnpm db:verify:sprint3-demo` (`apps/api/scripts/verify-sprint3-demo.ts`, database `hktutor_s3_t40_test`)                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Runbook          | Root `README.md`, **Sprint 3 demo runbook**: placeholders, payments with or without Omise test keys, build-time `API_INTERNAL_URL`, backup → migrate → seed → build → start, rollback, a 12-step three-role script, reset and known issues                                                                                                                                                                                                                                                                                               |

No migration, schema, API contract or web change.

## Environment placeholder check

Every variable the API and web source read (`config.get`, `process.env`) has a placeholder in
`.env.example`, except the standard `NODE_ENV` and `PORT`. The workspace contract
`tests/environment-template.test.mjs` still passes. Two findings went into the runbook:

1. **The example Omise values stop the API from starting.** `skey_test_REPLACE_ME` and `REPLACE_ME`
   are rejected by `payments.config.ts`, so `.env.example` cannot be copied as-is. Either set real
   Omise **test** keys or leave both empty. With both empty, QR creation returns 503 `PromptPay
test payments are not configured`, and a 100% coupon still settles at zero net. This is
   deliberate fail-closed validation and was not changed.
2. **`API_INTERNAL_URL` is fixed at web build time.** `next.config.ts` bakes the `/api/v1` rewrite
   into `.next/routes-manifest.json` (the default `http://localhost:3001` was found there), so the
   value must be set before `pnpm build`.

## Clean-environment rehearsal

Run on a throwaway local PostgreSQL 18.3 cluster (`127.0.0.1:55432`, UTC). It was deleted
afterwards. No shared or production database was used.

### 1. Database, seed and three roles over HTTP

```bash
psql 'postgresql://postgres@127.0.0.1:55432/postgres' -c 'CREATE DATABASE hktutor_s3_t40_test'
DATABASE_URL='postgresql://postgres@127.0.0.1:55432/hktutor_s3_t40_test' pnpm db:migrate:deploy
HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 \
  DATABASE_URL='postgresql://postgres@127.0.0.1:55432/hktutor_s3_t40_test' \
  pnpm db:verify:sprint3-demo
```

Create and migrate took 2 s. Seeding twice plus the rehearsal took 6 s.

```text
PASS [seed + AppModule over HTTP + PostgreSQL] 29 committed migrations applied to an empty database; health connected
PASS [seed + AppModule over HTTP + PostgreSQL] runSeed twice is idempotent; the S3-T40 review-ready class is completed, paid and unreviewed
PASS [seed + AppModule over HTTP + PostgreSQL] seeded admin, tutor (Anan) and student (Nan) sign in; tutor and student accept the current notice
PASS [seed + AppModule over HTTP + PostgreSQL] admin creates DEMOFREE (100%, 3 uses); WELCOME10 from the seed is listed
PASS [seed + AppModule over HTTP + PostgreSQL] Mathematics Grade 10 offers the 3-tutor comparison set (Mali 4.33/2, Kiet 4.00/1, Anan New tutor null/0)
PASS [seed + AppModule over HTTP + PostgreSQL] student messages Anan; tutor marks it read
PASS [seed + AppModule over HTTP + PostgreSQL] student reviews the seeded class 5/5/4; Anan now shows 4.67 from 1 review
PASS [seed + AppModule over HTTP + PostgreSQL] book day +8 → confirm → WELCOME10 quotes and applies 400.00/40.00/360.00 → replaced by DEMOFREE, settles 0.00 PAID with no provider → link visible
PASS [seed + AppModule over HTTP + PostgreSQL] tutor records attendance; report matches the database: 3 bookings, 2 completed, 800.00 THB, 100%
S3-T40 demo rehearsal: 9 checks passed.
```

The second seed changes only `updatedAt` on the Sprint 2 ended class, which that seed resets on
every run by design. A per-column diff of every booking, slot, review and coupon confirmed this,
so the idempotency check compares all columns except `updatedAt`. The seeded student and tutor
start without current consent and accept it as the runbook's first sign-in step.

### 2. Production build and deployment smoke

```bash
pnpm build                                   # 37 s, exit 0 (all workspaces)
PORT=3001 NODE_ENV=production … node apps/api/dist/main
pnpm --filter @hktutor/web exec next start -p 3100
```

| Probe (through the web origin `:3100`)                                        | Result                                                               |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `/api/v1/health` (rewrite to the API)                                         | 200 `{"database":"connected"}`                                       |
| `/api/v1/tutors?subject=Mathematics&grade=Grade 10`                           | 3 tutors: Anan, Mali, Kiet                                           |
| `/api/v1/docs`                                                                | 200                                                                  |
| `/api/v1/reports/tutor/me` anonymously                                        | 401                                                                  |
| `/`, `/tutors`, `/register`                                                   | 200                                                                  |
| `/dashboard/reports`, `/dashboard/coupons`, `/dashboard/messages` anonymously | 307 to `/?returnTo=…`; the pages declare `robots: noindex, nofollow` |

In production mode the reminder cron ran on its first tick and logged `scanned=12 created=15
duplicates=0 failed=0`. Neither server log contained an error. `next start` warns that
`output: standalone` prefers `node .next/standalone/server.js`. Deployments use the standalone
server (Docker image); the warning does not affect this smoke test.

### 3. What was not rehearsed

- The **browser walkthrough** of the 12-step script was not clicked through in this session.
  Every step's API behavior was rehearsed above, and the screens have Playwright coverage (see the
  [S3-T39 traceability](s3-t39-qa.md)). Run the script once in three browser profiles before
  presenting.
- **Docker Compose** could not be validated here (Docker was not running). Run
  `docker compose config` with a completed `.env`.
- **PromptPay with real Omise test keys** was not exercised; no keys were available. The
  zero-net path and the stubbed provider path (S3-T28, S3-T37) are covered.
- **Backup/restore** commands are documented, not executed, since there was no shared demo
  database to protect.

## Known issues

See the [S3-T39 handover](s3-t39-qa.md#known-issues-and-follow-ups): the stale S2-T38 runner,
consent on booking reads, the 403/400 consent codes, the open payment-deadline PR, and the
backlog wording.

### 4. Existing seed verifiers with the new demo step

On fresh databases, `pnpm db:verify:sprint3-fixtures` (42 checks) and `pnpm db:verify:sprint3-final`
(DB06 clean seed/startup, `hktutor_s3_db06_test`) both still pass with `seedSprint3Demo` in
`runSeed`.

## Checks run

```bash
pnpm --filter @hktutor/api exec jest test/unit/database
pnpm --filter @hktutor/api test
pnpm --filter @hktutor/api lint
pnpm build
pnpm format:check
pnpm verify:workspace
```

Results: database unit specs 88 passed; full API unit suite 101 suites / 1791 tests passed; API lint
clean; all-workspace production build passed; Prettier clean; workspace contracts 138 / 138 passed.
