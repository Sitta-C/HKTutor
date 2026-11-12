# Attendance-to-review integration evidence

Date: 2026-11-12

## Implemented behavior

- Tutor attendance remains the only completion transition. A paid, confirmed class must have ended;
  either `ATTENDED` or `ABSENT` atomically persists attendance and changes the booking to
  `COMPLETED`.
- Student booking detail reads that canonical status, then reads or creates the booking's review.
  A successful submit refreshes the booking and saved review without inventing a client completion
  flag or losing the confirmed result if a reconciliation read fails.
- Public tutor detail loads `GET /tutors/:tutorId/reviews?limit=20&cursor=...`, appends opaque cursor
  pages, formats timestamps in Asia/Bangkok, and renders author names and feedback as React text.
- A public review contains no booking ID or private student fields. A 404 from the review list hides
  the profile, retaining the API's verified/active/non-deleted tutor eligibility rule.
- Public search and detail API calls remain `no-store`; a reload reads fresh review and aggregate
  rating values after submission.

## Verification results

| Command                                                                                                                             | Result                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `pnpm --filter @hktutor/web test`                                                                                                   | 49 files, 763 tests passed                                           |
| `pnpm --filter @hktutor/web lint`                                                                                                   | Passed with zero warnings                                            |
| `pnpm --filter @hktutor/web build`                                                                                                  | Passed; production compile, TypeScript and 21 static pages completed |
| `playwright test review-ui.spec.ts public-tutor-detail-ui.spec.ts --project=chromium`                                               | 50 passed                                                            |
| `playwright test public-tutor-detail-ui.spec.ts --grep 'public reviews\|reload reads\|reviews 404'`                                 | 9 passed across desktop, tablet and mobile Chromium                  |
| `pnpm --filter @hktutor/api test:e2e -- --runInBand --runTestsByPath test/bookings-attendance.e2e-spec.ts test/reviews.e2e-spec.ts` | 2 suites, 77 tests passed                                            |
| `pnpm lint`                                                                                                                         | Root and all workspace lint passed                                   |
| `pnpm test`                                                                                                                         | API: 92 suites/1,630 tests; web: 49 files/763 tests passed           |
| `pnpm build`                                                                                                                        | API and web builds passed                                            |
| Prettier check for every touched file                                                                                               | Passed                                                               |

The focused browser run includes reload persistence, unfinished-booking exclusion, wrong-student
access handling, duplicate submission reconciliation, public hidden-tutor handling, literal saved
markup/XSS probes, cursor pagination, and a fresh aggregate/review read after reload. The focused API
run covers paid-only ended-class attendance for both `ATTENDED` and `ABSENT`, canonical completion,
role/ownership failures, review eligibility, duplicate conflicts, public redaction and tutor
visibility.

The HTTP suites use isolated persistence doubles and the browser suites intercept API fixtures. They
do not replace the existing explicitly opted-in disposable PostgreSQL review, rating and attendance
verifiers documented in the API runbook.

`pnpm check` generated Prisma Client successfully, then stopped at the repository-wide formatting
baseline: Prettier reported 341 existing CRLF files across API, web, infrastructure and tests. Those
unrelated files were not rewritten. `pnpm verify:workspace` similarly passed 134 of 136 contracts;
the two existing failures are the DB03 applied-migration hash mismatch and a CRLF suffix in the CI
secret fixture. All remaining `pnpm check` stages were run separately as `pnpm lint`, `pnpm test`
and `pnpm build` and passed. Commands used the bundled Node 24.22.1/pnpm 11.25.0 runtime, which emits
an engine warning against the repository's pinned Node 24.19.0/pnpm 11.19.0 versions.
