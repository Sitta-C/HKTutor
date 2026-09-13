# S1-T33 — Student Profile E2E Regression Tests and Documentation Traceability

- **Epic:** E11 — Identity, Privacy & Access Control
- **User Story:** US11-4 — As a student, I want to complete and update my personal profile after
  email verification, so that the platform has the information required to support my tutoring
  journey.
- **Dependencies:** S1-T31 (owner-only student profile API), S1-T32 (onboarding/edit UI and
  incomplete-profile redirects)
- **Evidence / Done output:** Cover create/update, validation, access, consent, privacy, redirects,
  and migration.

## What this task verifies

T33 is a verification task. S1-T31 and S1-T32 already implement every behavior below; this task adds
the missing end-to-end regression coverage, a behavioral test for the redirect decision, and the
traceability map from each evidence item to the test that proves it.

One production-source change was required, and it changes no behavior: the redirect decisions that
lived inline in `apps/web/src/app/dashboard/page.tsx` and
`apps/web/src/components/profile/profile-editor.tsx` moved into the pure module
`apps/web/src/lib/profile-navigation.ts`. The web test runner executes in a `node` environment and
renders no React tree, so inline redirect logic could not be tested at all; a pure function can. The
same task therefore asserts that both components still call the extracted helpers, which catches a
redirect that is removed from the UI layer.

- [x] Student profile regression suite runs green
- [x] Every evidence item below maps to a named automated test
- [x] Redirect decisions are covered by tests that can fail

## Evidence: item → proving test

| Evidence item | Proving test                                                                                                                                                                                                                                                                                 |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| create        | `apps/api/test/student-profile-contract.e2e-spec.ts` — `creates the profile for the authenticated student through the upsert route` (real `PUT /api/v1/profiles/me/student`)                                                                                                                 |
| update        | same spec — `updates an existing profile with the same route and returns the stored values`                                                                                                                                                                                                  |
| ownership     | same spec — `uses the authenticated user id as the owner of the saved profile`; `apps/api/test/unit/profiles/profiles.controller.spec.ts` — `uses the authenticated student id as the upsert owner`                                                                                          |
| validation    | same spec — `returns 400 for %s` (`it.each`: missing field, whitespace-only value, out-of-pattern phone, over-length first name/school/grade level, undeclared property); `apps/api/test/unit/profiles/profiles.dto.spec.ts`                                                                 |
| access        | same spec — `returns 403 when a tutor calls the student profile route`, `returns 403 when an admin calls the student profile route` (real `RolesGuard`); `apps/api/test/unit/profiles/profiles.controller.spec.ts` — `restricts the student upsert route to the student role`                |
| consent       | same spec — `rejects a student profile write until the current notice is accepted`, `rejects a private read and leaks no profile data until consent is current`; `apps/api/test/unit/profiles/profiles.service.spec.ts` — `blocks profile writes until the current notice has been accepted` |
| privacy       | same spec — `never returns private credential fields from the profile routes` (no `passwordHash`, refresh token or `userId` in either response), `rejects a private read and leaks no profile data until consent is current`                                                                 |
| redirects     | `apps/web/test/profile-navigation.test.ts` — `dashboard gate` and `onboarding hand-off` suites; `tests/sprint1-profile-traceability.test.mjs` — asserts both UI components call the extracted helpers                                                                                        |
| migration     | `tests/personal-profile-foundation.test.mjs` — `adds role-specific personal profile fields without putting private names on User`, `creates the student profile table with bounded nonempty data and restrictive ownership`; `tests/sprint1-database-contract.test.mjs`                      |

## Commands run and results

Run from `HKTutor/` with Node 24.19.0 and pnpm 11.19.0.

### 1. API e2e suite (real HTTP requests through Nest)

```bash
pnpm --filter @hktutor/api test:e2e
```

```
Test Suites: 6 passed, 6 total
Tests:       45 passed, 45 total
```

### 2. API unit suite

```bash
pnpm --filter @hktutor/api test
```

```
Test Suites: 36 passed, 36 total
Tests:       285 passed, 285 total
```

### 3. Web suite

```bash
pnpm --filter @hktutor/web test
```

```
Test Files  2 passed (2)
Tests       17 passed (17)
```

### 4. Workspace contract suites

```bash
pnpm verify:workspace
```

```
tests 81
pass 81
fail 0
```

### 5. Repository gate

```bash
pnpm check
```

See the CI job `check` (`.github/workflows/ci.yml`), which runs `pnpm check` followed by the
PostgreSQL-backed `pnpm db:verify:bookings` script.

## Notes for reviewers

- The e2e spec overrides `JwtAuthGuard` only. Keeping the real `RolesGuard` and the real
  `ValidationPipe` is what makes the access and validation rows above meaningful.
- `pnpm check` runs the API jest unit suite (`test/unit/**`); the e2e specs run through
  `pnpm --filter @hktutor/api test:e2e` and are reported separately.
- Migration evidence is checked by reading
  `apps/api/prisma/migrations/20260909190000_add_personal_profiles/migration.sql`; no migration was
  added or changed by this task.
