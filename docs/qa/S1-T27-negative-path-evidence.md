# S1-T27 — Run Invalid-Token, Onboarding, Authorization, and Double-Booking Regression Tests

- **Epic:** E11 — Identity, Privacy & Access Control
- **User Story:** US11-3 — As a system administrator, I want role and ownership checks
  so that users cannot access another user's private data.
- **Dependencies:** S1-T13 (auth/role/ownership guards), S1-T24 (transactional booking
  endpoint)
- **Evidence / Done output:** Automated negative-path evidence

## What this task verifies

T27 is a verification task: S1-T13 and S1-T24 already implement every negative-path
behavior below. This task runs the existing automated regression suite and the
real-database concurrency script, and records that every required status code is
actually produced.

No production code was changed to complete this task.

## Evidence: status code → proving test

Each "Proving test" cell contains only `` `path` — `literal test title` `` pairs
(semicolon-separated when a case has more than one). `tests/sprint1-negative-path-traceability.test.mjs`
parses every row as one unit and checks, per pair: the path exists, and the quoted
title appears verbatim in that specific file — not merely somewhere in the repo.

| Status        | Case                                                                | Proving test                                                                                                                                                                                                                                               |
| ------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `401`         | Missing bearer token                                                | `apps/api/test/unit/auth/auth.guard.spec.ts` — `rejects a missing bearer token before verification`                                                                                                                                                        |
| `401`         | Invalid signature                                                   | `apps/api/test/unit/auth/auth.guard.spec.ts` — `rejects an invalid signature without exposing verification details`; `apps/api/test/unit/auth/jwt.service.spec.ts` — `rejects an access token with %s`                                                     |
| `401`         | Expired access token                                                | `apps/api/test/unit/auth/jwt.service.spec.ts` — `rejects an access token with %s`; `apps/api/test/unit/auth/auth.guard.spec.ts` — `rejects an invalid signature without exposing verification details`                                                     |
| `401`         | Expired refresh token                                               | `apps/api/test/unit/auth/jwt.service.spec.ts` — `rejects an expired refresh token`; `apps/api/test/unit/auth/auth.service.spec.ts` — `rejects a missing or invalid refresh token before rotating a session`                                                |
| `401`         | Revoked session                                                     | `apps/api/test/unit/auth/auth.guard.spec.ts` — `rejects a revoked session`; `apps/api/test/unit/auth/auth.service.spec.ts` — `rejects refresh when the session has already been revoked`                                                                   |
| `401`         | Refresh-token reuse                                                 | `apps/api/test/unit/auth/auth.service.spec.ts` — `revokes a session when a previously rotated refresh token is reused`                                                                                                                                     |
| `401`         | Missing/invalid access token via real HTTP (not CI-gated, see note) | `apps/api/test/auth-authorization.e2e-spec.ts` — `returns 401 for a missing access token`; `apps/api/test/auth-authorization.e2e-spec.ts` — `returns 401 for an invalid access token`                                                                      |
| `403`         | Login before email verification                                     | `apps/api/test/unit/auth/auth.service.spec.ts` — `rejects login before email verification even when the password is valid`                                                                                                                                 |
| `401`         | Unverified user on any authenticated route                          | `apps/api/test/unit/auth/auth.guard.spec.ts` — `rejects %s`                                                                                                                                                                                                |
| `403`         | Wrong role                                                          | `apps/api/test/unit/auth/roles.guard.spec.ts` — `returns 403 when an authenticated user does not have a permitted role`; `apps/api/test/auth-authorization.e2e-spec.ts` — `returns 403 for an authenticated user with the wrong role`                      |
| `404`         | Not the resource owner, or resource doesn't exist                   | `apps/api/test/unit/auth/ownership.guard.spec.ts` — `returns the same generic 404 for a missing record and another owner`; `apps/api/test/auth-authorization.e2e-spec.ts` — `returns the same 404 for another tutor's private record and a missing record` |
| `201` + `409` | Concurrent double-booking on the same slot                          | `apps/api/src/scripts/verify-booking-endpoint-concurrency.ts` — `PASS concurrent HTTP booking requests yield one 201 and one 409`                                                                                                                          |
| `404`         | Failed booking (missing listing/slot) leaves no row                 | `apps/api/src/scripts/verify-booking-endpoint-concurrency.ts` — `PASS a failed HTTP booking request leaves no Booking row behind`                                                                                                                          |

### Notes on specific rows

- **Invalid signature / Expired access token / Unverified user on any authenticated
  route** all cite parameterized `it.each` templates (`rejects an access token with %s`
  in `jwt.service.spec.ts`, `rejects %s` in `auth.guard.spec.ts`). The literal case
  strings inside those `it.each` arrays, listed here for reference only (the automated
  guard does not check this sub-list — see below):
  - `jwt.service.spec.ts`: an invalid signature, an unexpected issuer, an unexpected
    audience, an unexpected algorithm, an expired token
  - `auth.guard.spec.ts`: a missing session, a session bound to another user, an
    expired session, a soft-deleted user, a suspended user, an unverified user

  These live in prose rather than the table so the strict pair-parser above isn't fed
  ambiguous fragments; if you rename or remove one of these array entries, this note —
  not the automated guard — is what will go stale.

- **Unverified user on any authenticated route is `401`, not `403`.** The guard throws
  `UnauthorizedException` for this case
  (`apps/api/src/auth/auth.guard.ts:53-55` as of this writing) — distinct from the
  `403` login-time check one row above, where `AuthService.login()` throws
  `ForbiddenException` for the same underlying condition. Same root cause
  (`emailVerifiedAt` is null), two different call sites, two different status codes.
  The guard test verifies `apps/api/src/auth/auth.guard.ts` exists; it does not verify
  the specific line numbers, which may drift independently of the file itself.
- **Failed booking (missing listing/slot) leaves no row is `404`, not `409`.** The
  request targets a nonexistent listing/slot and the script asserts
  `response.status === 404`
  (`apps/api/src/scripts/verify-booking-endpoint-concurrency.ts:202` as of this
  writing) before asserting zero `Booking` rows exist. The only `409` evidence in this
  document is the concurrent-race row above it. This case is deliberately **not**
  labeled "(rollback)" — the request fails validation (missing listing/slot) at the
  very first `SELECT ... FOR UPDATE` inside the transaction, before any row is ever
  written, so there is nothing to roll back. "Leaves no row" is a stronger and more
  accurate claim than "rolls back a row" here.
- **The `jwt.service.spec.ts` citations on "Invalid signature" and "Expired access
  token" only prove that `JwtTokenService.verifyAccessToken()` returns `null`** — they
  call the token service directly and assert on its return value; they never touch
  `JwtAuthGuard`, HTTP, or a status code. The actual `401`-at-the-HTTP-layer proof for
  both rows is `auth.guard.spec.ts`'s `rejects an invalid signature without exposing
verification details` test, cited on both rows despite its name: its mock
  (`verifyAccessToken.mockReturnValue(null)`) doesn't distinguish _why_ verification
  failed, so it genuinely proves "any reason `verifyAccessToken` returns `null` → the
  guard throws `UnauthorizedException` → NestJS maps that to `401`" for signature
  failure, expiry, or anything else covered by the `jwt.service.spec.ts` `it.each`.
  `auth-authorization.e2e-spec.ts`'s `returns 401 for an invalid access token`
  additionally confirms this end-to-end over real HTTP, for at least one of the
  underlying reasons. Treat the `jwt.service.spec.ts` citations as necessary supporting
  evidence for _why_ the token is rejected, not as standalone proof of the response
  status.

## Commands run and results (2026-09-12, e2e re-verified 2026-09-13)

### 1. Unit regression suite

```bash
cd apps/api
npx jest --config ./package.json
```

```
Test Suites: 36 passed, 36 total
Tests:       285 passed, 285 total
```

### 2. E2E suite (real HTTP requests through Nest)

```bash
npx jest --config ./test/jest-e2e.json
```

```
Test Suites: 6 passed, 6 total
Tests:       45 passed, 45 total
```

(Suite/test count grew from 5/27 to 6/45 between 2026-09-12 and 2026-09-13 as other
branches with their own e2e specs merged into `main`; re-run to confirm this evidence
still holds after the rebase.)

### 3. Concurrent double-booking check (real Postgres, not mocked)

Run against a disposable local Postgres container, matching the safety contract the
script itself enforces (localhost only, `hktutor_*` database name, explicit
`HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1` opt-in):

```bash
docker run -d --name hktutor-t27-verify \
  -e POSTGRES_DB=hktutor_t27_verify -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
  -p 55432:5432 postgres:17-alpine

DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:55432/hktutor_t27_verify?schema=public" \
  npx prisma migrate deploy

DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:55432/hktutor_t27_verify?schema=public" \
NODE_ENV=test \
SEED_ADMIN_EMAIL=admin@hktutor.test SEED_ADMIN_PASSWORD=admin-pass-123 \
SEED_STUDENT_EMAIL=student@hktutor.test SEED_STUDENT_PASSWORD=student-pass-123 \
SEED_TUTOR_EMAIL=tutor@hktutor.test SEED_TUTOR_PASSWORD=tutor-pass-123 \
  pnpm db:seed

DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:55432/hktutor_t27_verify?schema=public" \
HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 NODE_ENV=test \
SEED_ADMIN_EMAIL=admin@hktutor.test SEED_ADMIN_PASSWORD=admin-pass-123 \
SEED_STUDENT_EMAIL=student@hktutor.test SEED_STUDENT_PASSWORD=student-pass-123 \
SEED_TUTOR_EMAIL=tutor@hktutor.test SEED_TUTOR_PASSWORD=tutor-pass-123 \
  pnpm db:verify:bookings

docker rm -f hktutor-t27-verify
```

```
PASS concurrent HTTP booking requests yield one 201 and one 409
PASS a failed HTTP booking request leaves no Booking row behind
Booking endpoint concurrency verification passed
```

The container was disposable and removed immediately after — the shared Supabase dev
database was never touched.

### Failures encountered

None. All three runs passed on the first attempt, with no flakes or retries.

## CI wiring (pre-existing, not changed by this task)

`.github/workflows/ci.yml` runs on every push to `main` and every pull request:

1. `pnpm check` — full lint + typecheck + unit test suite. This covers every row in the
   table above **except** the "Missing/invalid access token via real HTTP" row, which is
   proven only by `auth-authorization.e2e-spec.ts` (an e2e spec).
2. `pnpm db:migrate:deploy && pnpm db:seed && pnpm db:verify:bookings` against a real
   `postgres:17-alpine` service container — covers the concurrent double-booking case
   against a real database on every single run, not just this local verification.

`pnpm test:e2e` (the e2e suite run manually above) is **not** currently part of
`pnpm check` or the CI job — this is a pre-existing gap in the CI configuration, in
scope for S1-T05, not this task. Concretely: the "Missing/invalid access token via real
HTTP" row's evidence is real and currently-passing, but it is **not** re-verified by CI
on every push today; every other row in the table is.

## Deployment context

Sprint 1 still runs locally only — there is no deployed environment yet.

## Definition of Done

- [x] **Regression suite passes in CI** — true for every row except the one HTTP e2e
      row called out above, which runs manually until S1-T05 wires `pnpm test:e2e` into
      `ci.yml`.
- [x] **Evidence identifies expected 401/403/404/409 behavior** — see the status-code
      mapping table above; every code path is traced to a specific, currently-passing
      test, verified against the actual thrown exception/assertion, not just the test's
      description text.
