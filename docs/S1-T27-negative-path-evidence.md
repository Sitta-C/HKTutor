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
actually produced, matching the two Definition of Done items:

- [x] Regression suite passes in CI
- [x] Evidence identifies expected 401/403/404/409 behavior

No production code was changed to complete this task.

## Evidence: status code → proving test

| Status        | Case                                              | Proving test                                                                                                                                                                                                                                                                               |
| ------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `401`         | Missing bearer token                              | `test/unit/auth/auth.guard.spec.ts` — `rejects a missing bearer token before verification`                                                                                                                                                                                                 |
| `401`         | Invalid signature                                 | `auth.guard.spec.ts` — `rejects an invalid signature without exposing verification details`; `test/unit/auth/jwt.service.spec.ts` `it.each` — invalid signature / issuer / audience / algorithm                                                                                            |
| `401`         | Expired access token                              | `jwt.service.spec.ts` — `rejects an access token with an expired token` (signs a real token with `jsonwebtoken`, `expiresIn: -1` — not mocked); `auth.guard.spec.ts` `it.each` — `an expired session`                                                                                      |
| `401`         | Expired refresh token                             | `jwt.service.spec.ts` — `rejects an expired refresh token`                                                                                                                                                                                                                                 |
| `401`         | Revoked session                                   | `auth.guard.spec.ts` — `rejects a revoked session`; `test/unit/auth/auth.service.spec.ts` — `rejects refresh when the session has already been revoked`                                                                                                                                    |
| `401`         | Refresh-token reuse                               | `auth.service.spec.ts` — `revokes a session when a previously rotated refresh token is reused` (proves reuse revokes the _whole_ session, not just that one request)                                                                                                                       |
| `401`         | Missing/invalid access token via real HTTP        | `test/auth-authorization.e2e-spec.ts` — `returns 401 for a missing access token`, `returns 401 for an invalid access token`                                                                                                                                                                |
| `403`         | Login before email verification                   | `auth.service.spec.ts` — `rejects login before email verification even when the password is valid`                                                                                                                                                                                         |
| `403`         | Unverified user on any authenticated route        | `auth.guard.spec.ts` `it.each` — `an unverified user`                                                                                                                                                                                                                                      |
| `403`         | Wrong role                                        | `test/unit/auth/roles.guard.spec.ts` — `returns 403 when an authenticated user does not have a permitted role`; `auth-authorization.e2e-spec.ts` — `returns 403 for an authenticated user with the wrong role`                                                                             |
| `404`         | Not the resource owner, or resource doesn't exist | `test/unit/auth/ownership.guard.spec.ts` — `returns the same generic 404 for a missing record and another owner`; `auth-authorization.e2e-spec.ts` — `returns the same 404 for another tutor's private record and a missing record` (identical response body for both — no existence leak) |
| `201` + `409` | Concurrent double-booking on the same slot        | `apps/api/src/scripts/verify-booking-endpoint-concurrency.ts`, run via `pnpm db:verify:bookings` — two real concurrent HTTP requests against a real Postgres database and a real unique constraint                                                                                         |
| `409`         | Failed booking leaves no row (rollback)           | Same script — `a failed HTTP booking request leaves no Booking row behind`                                                                                                                                                                                                                 |

## Commands run and results (2026-09-12)

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
Test Suites: 5 passed, 5 total
Tests:       27 passed, 27 total
```

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

1. `pnpm check` — full lint + typecheck + unit test suite (covers every `401`/`403` row
   in the table above).
2. `pnpm db:migrate:deploy && pnpm db:seed && pnpm db:verify:bookings` against a real
   `postgres:17-alpine` service container — covers the concurrent double-booking case
   against a real database on every single run, not just this local verification.

Note: `pnpm test:e2e` (the e2e suite run manually above) is **not** currently part of
`pnpm check` or the CI job. This is a pre-existing gap in the CI configuration — closest
in scope to S1-T05 ("Configure Swagger, validation pipe, lint/test/build CI"), not part
of T27's own scope to fix, and flagged here only for visibility.

## Deployment context

Sprint 1 still runs locally only — there is no deployed environment yet.

## Definition of Done

- [x] **Regression suite passes in CI** — the unit suite and the concurrency check both
      already run in `ci.yml` on every push/PR; both were re-verified locally above with
      identical results.
- [x] **Evidence identifies expected 401/403/404/409 behavior** — see the status-code
      mapping table above; every code path is traced to a specific, currently-passing
      test.
