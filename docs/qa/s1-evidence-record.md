# Sprint 1 Evidence Record (S1-T28)

- **Task:** S1-T28 — Update Swagger, QA activity record, issues, and contribution evidence
- **Owners:** Kin, Tonnam · **Dependencies:** S1-T26 (integration), S1-T27 (negative-path run)
- **Evidence / Done output:** Course evidence complete
- **Compiled against:** `main` at the S1-T26 integration merge (PR #60), 2026-09-13

## 1. How to read this record

This is the sprint-level record. Two task-level records sit underneath it and are not repeated here:

- `docs/qa/S1-T27-negative-path-evidence.md` — every 401/403/404/409 negative path.
- `docs/S1-T33-profile-traceability.md` — the Student Profile evidence items.

Every citation in section 3 is a `` `path` — `literal test title` `` pair.
`tests/sprint1-evidence-traceability.test.mjs` parses this document and fails if a cited file is
missing, a cited title does not appear verbatim in that exact file, or an endpoint in section 2 is
not registered by a controller. The record cannot silently rot: renaming a test breaks `pnpm check`.

## 2. API contract (Swagger)

The document is served from the running API at `/api/v1/docs`, with the raw contract at
`/api/v1/docs-json`. Every operation is declared in a `*.swagger.ts` decorator module;
`tests/swagger-ci-foundation.test.mjs` — `keeps Swagger implementation out of controller files`
keeps that separation enforced.

Legend for "Documented": the response codes carried by the operation's Swagger decorator.

| Method + path                                        | Doc decorator                | Documented                   |
| ---------------------------------------------------- | ---------------------------- | ---------------------------- |
| `POST /api/v1/auth/register`                         | `RegisterAuthDoc`            | 201, 400, 409, 503           |
| `POST /api/v1/auth/verify-email`                     | `VerifyEmailAuthDoc`         | 200, 400                     |
| `POST /api/v1/auth/resend-verification`              | `ResendVerificationAuthDoc`  | 200, 400, 503                |
| `POST /api/v1/auth/login`                            | `LoginAuthDoc`               | 200, 400, 401, 403           |
| `POST /api/v1/auth/refresh`                          | `RefreshAuthDoc`             | 200, 401                     |
| `POST /api/v1/auth/logout`                           | `LogoutAuthDoc`              | 204                          |
| `POST /api/v1/auth/consent`                          | `AcceptPrivacyNoticeAuthDoc` | 200, 401                     |
| `GET /api/v1/auth/me`                                | `GetCurrentUserAuthDoc`      | 200, 401                     |
| `GET /api/v1/health`                                 | `GetHealthDoc`               | 200, 503                     |
| `GET /api/v1/subjects`                               | `GetSubjectCatalogDoc`       | 200, 503                     |
| `GET /api/v1/grade-levels`                           | `GetGradeLevelCatalogDoc`    | 200, 503                     |
| `GET /api/v1/tutors`                                 | `SearchPublicTutorsDoc`      | 200, 400                     |
| `GET /api/v1/tutors/:tutorId`                        | `GetPublicTutorDoc`          | 200, 400, 404                |
| `GET /api/v1/tutors/:tutorId/availability`           | `GetTutorAvailabilityDoc`    | 200, 400, 404                |
| `GET /api/v1/tutors/me/listings`                     | `GetMyListingsDoc`           | 200, 400, 401, 403           |
| `GET /api/v1/tutors/me/listings/:listingId`          | `GetMyListingDoc`            | 200, 400, 401, 403, 404      |
| `POST /api/v1/tutors/me/listings`                    | `PostListingDoc`             | 201, 400, 401, 403           |
| `PATCH /api/v1/tutors/me/listings/:listingId`        | `PatchListingDoc`            | 200, 400, 401, 403, 404      |
| `PATCH /api/v1/tutors/me/listings/:listingId/status` | `UpdateListingStatusDoc`     | 200, 400, 401, 403, 404      |
| `POST /api/v1/tutors/me/listings/:listingId/publish` | `PublishListingDoc`          | 200, 400, 401, 403, 404      |
| `GET /api/v1/tutors/me/availability`                 | `GetMyAvailabilityDoc`       | 200, 400, 401, 403           |
| `POST /api/v1/tutors/me/availability`                | `PostAvailabilityDoc`        | 201, 400, 401, 403, 409      |
| `DELETE /api/v1/tutors/me/availability/:slotId`      | `DeleteAvailabilityDoc`      | 204, 400, 401, 403, 404, 409 |
| `GET /api/v1/profiles/me`                            | `GetMyProfileDoc`            | 200, 400, 401, 403, 404      |
| `PUT /api/v1/profiles/me/student`                    | `SaveStudentProfileDoc`      | 200, 400, 401, 403           |
| `PUT /api/v1/profiles/me/tutor`                      | `SaveTutorProfileDoc`        | 200, 400, 401, 403           |
| `POST /api/v1/bookings`                              | `CreateBookingDoc`           | 201, 400, 401, 403, 404, 409 |
| `GET /api/v1/bookings/quote`                         | `GetBookingQuoteDoc`         | 200, 400, 401, 403, 404, 409 |
| `GET /api/v1/bookings/me`                            | `GetMyBookingsDoc`           | 200, 400, 401, 403           |
| `GET /api/v1/bookings/me/:bookingId`                 | `GetMyBookingDoc`            | 200, 400, 401, 403, 404      |
| `GET /api/v1/bookings/tutor`                         | `GetTutorBookingsDoc`        | 200, 400, 401, 403           |
| `GET /api/v1/examples/protected`                     | `GetProtectedAuthExampleDoc` | 200, 401, 403                |
| `GET /api/v1/examples/private-listings/:listingId`   | `GetOwnedListingExampleDoc`  | 200, 400, 401, 403, 404      |

Contract-level proof, independent of a running server:

- `apps/api/test/unit/app.setup.spec.ts` — `publishes the API contract as OpenAPI JSON`
- `apps/api/test/unit/app.setup.spec.ts` — `returns validation details with HTTP 400 for a malformed query parameter`
- `apps/api/test/unit/auth/auth.swagger.spec.ts` — `documents access-token and refresh-cookie security independently`
- `apps/api/test/unit/auth/auth.swagger.spec.ts` — `shows authentication responses without exposing refresh tokens in JSON`
- `apps/api/test/unit/tutors/tutors.swagger.spec.ts` — `documents the public search contract without bearer security`
- `apps/api/test/unit/profiles/profiles.swagger.spec.ts` — `documents the private profile response and stale-consent error`
- `apps/api/test/unit/bookings/bookings.controller.spec.ts` — `publishes the create-booking contract`

Standing rule from the workbook, still holding: no access token, refresh token, database URL, or
service key appears in a Swagger example, an error body, or a log line.

**One endpoint is undocumented:** `GET /api/v1` (`AppController.getHello`) returns the
framework's `Hello World!` string behind `JwtAuthGuard`, and `AppControllerDoc` gives it only
`ApiTags('authentication')` — no operation, no response, and a tag that does not describe it. See
issue I2.

## 3. QA activity record

Positive paths and contract behavior. Negative paths live in the S1-T27 record; each case here
names the automated test that proves it, so "Result" means that test passes in the sprint gate.

| #   | Story  | Case                                                 | Proving test                                                                                                                                                                                                                                                                  | Result       |
| --- | ------ | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| Q1  | US11-1 | Registration stores hashes, never the plain token    | `apps/api/test/unit/auth/auth.service.spec.ts` — `stores password and verification-token hashes before sending the plain token`                                                                                                                                               | Pass         |
| Q2  | US11-1 | Passwords stored as Argon2id                         | `apps/api/test/unit/auth/password.service.spec.ts` — `stores an Argon2id hash and verifies only the original password`                                                                                                                                                        | Pass         |
| Q3  | US11-1 | Repeat registration re-sends verification            | `apps/api/test/unit/auth/auth.service.spec.ts` — `retries verification delivery when registration is repeated for an active unverified account`                                                                                                                               | Pass         |
| Q4  | US11-1 | Login refused before email verification              | `apps/api/test/unit/auth/auth.service.spec.ts` — `rejects login before email verification even when the password is valid`                                                                                                                                                    | Pass         |
| Q5  | US11-1 | Refresh rotation, reuse revokes the session          | `apps/api/test/unit/auth/auth.service.spec.ts` — `revokes a session when a previously rotated refresh token is reused`                                                                                                                                                        | Pass         |
| Q6  | US11-1 | Logout is safe for a missing or invalid cookie       | `apps/api/test/unit/auth/auth.service.spec.ts` — `makes logout safe for missing and invalid refresh tokens`                                                                                                                                                                   | Pass         |
| Q7  | US11-1 | Access token stays in memory, refresh in a cookie    | `tests/local-auth-foundation.test.mjs` — `web keeps access tokens in memory and sends refresh cookies as credentials`                                                                                                                                                         | Pass         |
| Q8  | US11-2 | Registration is blocked without consent              | `tests/privacy-consent-foundation.test.mjs` — `blocks registration submission until the notice is accepted`                                                                                                                                                                   | Pass         |
| Q9  | US11-2 | Notice names local password storage and Resend       | `tests/privacy-consent-foundation.test.mjs` — `describes local password storage and Resend email delivery`                                                                                                                                                                    | Pass         |
| Q10 | US11-2 | Consent version recorded, re-consent supported       | `apps/api/test/unit/auth/auth.service.spec.ts` — `records the current privacy notice when an authenticated user re-consents`                                                                                                                                                  | Pass         |
| Q11 | US11-2 | Partial consent rejected at the database boundary    | `tests/sprint1-database-contract.test.mjs` — `rejects partial or blank local consent state at the database boundary`                                                                                                                                                          | Pass         |
| Q12 | US11-3 | Every negative path still cited and reachable        | `tests/sprint1-negative-path-traceability.test.mjs` — `every citation points at a path that exists and a title that appears in that exact file`                                                                                                                               | Pass         |
| Q13 | US12-1 | Listing publish and status transitions               | `apps/api/test/unit/tutors/tutors.service.spec.ts` — `publishes a tutor listing without requiring verification`; `apps/api/test/unit/tutors/tutors.service.spec.ts` — `restores a listing to draft and clears its publish timestamp`                                          | Pass, see I3 |
| Q14 | US12-2 | Overlapping availability rejected                    | `apps/api/test/unit/tutors/tutors.service.spec.ts` — `rejects an existing overlap with AVAILABILITY_OVERLAP`; `apps/api/test/unit/tutors/tutors.service.spec.ts` — `maps a concurrent database exclusion violation to AVAILABILITY_OVERLAP`                                   | Pass         |
| Q15 | US12-2 | Adjacent slots allowed, soft-deleted ignored         | `apps/api/test/unit/tutors/tutors.service.spec.ts` — `allows adjacent slots and ignores soft-deleted slots in the overlap check`                                                                                                                                              | Pass         |
| Q16 | US12-2 | Reserved slots protected in the UI                   | `tests/availability-ui.test.mjs` — `protects reserved slots and exposes the required availability states`                                                                                                                                                                     | Pass         |
| Q17 | US12-2 | Availability shown and entered in Bangkok time       | `tests/availability-ui.test.mjs` — `keeps availability display and input explicitly in Bangkok time`                                                                                                                                                                          | Pass         |
| Q18 | US1-1  | Filters ANDed with inclusive boundaries              | `apps/api/test/unit/tutors/public-tutors.service.spec.ts` — `combines all filters with AND semantics and inclusive boundaries`                                                                                                                                                | Pass         |
| Q19 | US1-1  | Exact catalog matching, no partial subject match     | `apps/api/test/unit/tutors/public-tutors.service.spec.ts` — `does not turn a partial subject into a match and rejects unsupported grades`                                                                                                                                     | Pass         |
| Q20 | US1-1  | Search exposes published listings and public fields  | `apps/api/test/unit/tutors/public-tutors.service.spec.ts` — `returns only public fields for published search results`                                                                                                                                                         | Pass         |
| Q21 | US1-1  | No-match state kept distinct from error states       | `tests/tutor-search-web.test.mjs` — `keeps no-match, validation, network-error, and stale-result states separate`                                                                                                                                                             | Pass         |
| Q22 | US12-3 | Booking created for an active student on a free slot | `apps/api/test/unit/bookings/bookings.service.spec.ts` — `creates a booking for a %s tutor when the student is active and the slot is available`                                                                                                                              | Pass         |
| Q23 | US12-3 | Amount is server-authoritative, prorated to satang   | `apps/api/test/unit/bookings/bookings.service.spec.ts` — `prorates the authoritative amount from the slot duration and rounds to satang`                                                                                                                                      | Pass         |
| Q24 | US12-3 | Identity never taken from the request body           | `apps/api/test/unit/bookings/bookings.controller.spec.ts` — `derives studentUserId from the authenticated user rather than the request body`; `tests/booking-flow-web.test.mjs` — `connects selected public availability to quote and create without client authority fields` | Pass         |
| Q25 | US12-3 | Double booking is a stable 409, no partial row       | `apps/api/test/unit/bookings/bookings.service.spec.ts` — `maps database conflict %s to a stable 409 without exposing database details`; `apps/api/src/scripts/verify-booking-endpoint-concurrency.ts` — `PASS concurrent HTTP booking requests yield one 201 and one 409`     | Pass         |
| Q26 | US0-1  | Guest booking survives login and onboarding          | `tests/s1-t26-integration-flow.test.mjs` — `preserves the selected guest booking across login and student onboarding`                                                                                                                                                         | Pass         |
| Q27 | US0-1  | Private routes gated, dashboards on live data        | `tests/s1-t26-integration-flow.test.mjs` — `gates every private flow route and connects both dashboards to live booking data`                                                                                                                                                 | Pass         |
| Q28 | US0-1  | One same-origin gateway, no public API port          | `tests/docker-compose.test.mjs` — `publishes one same-origin gateway and keeps web and API services private`                                                                                                                                                                  | Pass         |
| Q29 | US0-2  | Malformed query returns documented 400               | `apps/api/test/unit/app.setup.spec.ts` — `returns validation details with HTTP 400 for a malformed query parameter`                                                                                                                                                           | Pass         |
| Q30 | US0-2  | Student Profile evidence items still traceable       | `tests/sprint1-profile-traceability.test.mjs` — `documents every S1-T33 evidence item`                                                                                                                                                                                        | Pass         |

## 4. What the sprint gate actually runs

| Stage                      | Command                                     | Covers                                                                    |
| -------------------------- | ------------------------------------------- | ------------------------------------------------------------------------- |
| Workspace contracts        | `node --test tests/*.test.mjs`              | 24 repository contract suites, including every `tests/...` citation above |
| Format and lint            | `pnpm format:check`, `pnpm lint`            | Prettier, root and per-app ESLint at `--max-warnings=0`                   |
| API unit tests             | `pnpm test` → `jest` (`test/unit/**`)       | every `apps/api/test/unit/...` citation above                             |
| Build                      | `pnpm build`                                | Next.js and NestJS production builds                                      |
| Real-database booking race | `pnpm db:verify:bookings` (CI, Postgres 17) | the 201/409 concurrency citation in Q25                                   |

Not in the gate: `apps/api/test/*.e2e-spec.ts`. The API Jest config matches `test/unit/**` only,
and CI never calls `pnpm --filter @hktutor/api test:e2e`, so the HTTP-level suites — including the
e2e rows cited by the S1-T27 record — run only when someone runs them by hand. See issue I1.

## 5. Issue log

| ID  | Found in                | Severity | Description                                                                                                                                                                    | Owner      | Status | Action                                                                                               |
| --- | ----------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ------ | ---------------------------------------------------------------------------------------------------- |
| I1  | S1-T28 review of CI     | Major    | The `*.e2e-spec.ts` suites are excluded by the API Jest `testRegex` and are not run by CI, so part of the S1-T27 evidence is manual-only.                                      | Birdie, It | Open   | Add an e2e job reusing the existing Postgres service, or record in S1-T27 that those rows are manual |
| I2  | S1-T28 Swagger sweep    | Minor    | `GET /api/v1` returns `Hello World!` behind `JwtAuthGuard`, documented only with `ApiTags('authentication')`.                                                                  | Kin        | Open   | Hide it from the contract or document it as a service probe with its own tag                         |
| I3  | S1-T28 traceability     | Minor    | Implementation lets pending tutors publish and appear in discovery — deliberate, tested and documented in Swagger — but workbook US1-1 still says only verified tutors appear. | It, Model  | Open   | Update the US1-1 acceptance criteria, or gate on verification when E6 lands in Sprint 2              |
| I4  | S1-T28 schema sweep     | Minor    | `BookingStatus.EXPIRED` exists in the schema and is pinned by a contract test, but no production code sets or reads it.                                                        | Birdie     | Open   | Implement pending-booking expiry in Sprint 2, or note the status as reserved                         |
| I5  | S1-T28 contribution run | Minor    | 29 commits on `main` are authored as `unknown <peerapatv.wong@gmail.com>` because `git config user.name` was never set, which weakens the contribution evidence.               | P          | Open   | Set a git identity; past commits stay as they are                                                    |

Severity guide: blocker (demo cannot proceed), major (story unusable or evidence missing), minor
(cosmetic, documentation, or deferred).

## 6. Contribution evidence

Counted from `main` at PR #60, excluding merge commits. "Primary-authored PRs" means the member
wrote most commits on that branch. Pairing, review, and design work do not appear in these numbers,
so the last column is where the team records it.

| Member  | Git identity                          | Commits | Primary-authored PRs                                                   | Sprint 1 tasks owned (primary / second)                     |
| ------- | ------------------------------------- | ------: | ---------------------------------------------------------------------- | ----------------------------------------------------------- |
| It      | `Sitta` / `Sitta Chalee`              |      84 | #1–5, 7, 8, 9, 12, 14–17, 22, 23, 25–27, 30, 32, 34–38, 42, 49, 51, 58 | T01–T05, T07, T14, T17, T20, T23, T30 / —                   |
| Tonnam  | `Tonnam`                              |      59 | #21, 24, 28, 29, 31, 39, 44, 55                                        | T09, T12, T13, T32, T33 / T02, T03, T14, T19, T23, T28, T30 |
| Jojo    | `Jojo-Supawit`                        |      55 | #33, 43                                                                | T08, T15, T18, T31 / —                                      |
| P       | `unknown <peerapatv.wong@…>` (see I5) |      29 | #47                                                                    | T06, T10 / T08, T16, T26                                    |
| Korpai  | `12pailnwza`                          |      22 | #53, 60                                                                | T11, T19, T26 / T09, T10, T13                               |
| Birdie  | `Tonpee Rungkunakij`                  |      17 | #46, 57                                                                | T24, T27 / —                                                |
| Model   | `KModel212` / `Kaokanya Kokirdpanich` |      14 | #45, 48, 52, 54                                                        | T21, T22, T25 / —                                           |
| First   | `weerapat plakatthong` / `wakesup1`   |       9 | #6, 10, 41, 50                                                         | T16 / T01, T06, T33                                         |
| Kin     | `Viritphon Chongpermwattanapol`       |       5 | #11                                                                    | T28, T29 / T04, T05, T11, T12, T21, T22                     |
| Starter | `starter2157`                         |       0 | —                                                                      | — / T07, T17, T29, T32                                      |

PR #19 (`feature/authentication`) is the one branch with no single primary author: P and Jojo wrote
20 and 18 commits on it. Merge authorship is not counted as contribution anywhere in this table;
Kin merged PR #57 and PR #60, and wakesup1 merged PR #11 and PR #54.

Starter has no commit authored on `main`. Starter is a second owner on four tasks, so any pairing
or co-authored work needs to be recorded by the pair before this table is submitted — a zero here
is a gap in the record, not a conclusion about the person.

## 7. Definition of done for S1-T28

- [x] Every endpoint on `main` is listed with its documented responses, and gaps are logged.
- [x] Every QA case names an automated test, and the citations are machine-checked.
- [x] Issues found while compiling the record are logged with an owner and an action.
- [x] Contribution table reconciles with the merged PR list on `main`.
- [ ] Team confirms Starter's contribution rows and P's identity fix (I5) before submission.
- [ ] I1 decided: either e2e runs in CI, or the S1-T27 record states those rows are manual.
