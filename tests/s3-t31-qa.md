# S3-T31 comparison view model verification

Date: 2026-11-07 (Asia/Bangkok). Branch: `feature/s3-t31-comparison-view-model`.

## Scope and implemented behavior

- S3-T31 adds `apps/web/src/components/tutors/tutor-comparison-view-model.ts` and makes the S3-T29
  comparison popup render from it. S3-T30 owns the final side-by-side presentation, S3-T33/T34 own
  sorting and the sort selector, and S3-T32 owns the QA matrix; this change does not implement them.
- The view model reuses the existing public reads (`GET /tutors/:tutorId` and
  `GET /tutors/:tutorId/availability`) loaded by S3-T29 and the shared rating summary from S3-T18.
  No API endpoint, database table, migration, URL format or browser storage is added.
- Stable IDs: each column is keyed by the selected tutor ID and keeps its selection `position`
  through loading, error, ready and same-tutor course replacement. A repeated tutor keeps its first
  column only. A ready response whose tutor or listing ID differs from the selection is unavailable.
- Privacy: a ready entry copies only display name, subject, grade, hourly price, rating summary,
  experience and next-slot UTC start/end. Bio, course description, slot ID and any other field in
  the public responses (including fields a future API might add) are not copied. Loading,
  unavailable and error columns carry only IDs and state. Unpublished courses and non-public tutors
  are already excluded server-side (`publicTutorWhere`, published listings only) and stay
  unavailable here.
- Missing data: a blank subject/grade, a price that is not a positive finite number and an
  experience that is not a non-negative integer become `null` and render as Unavailable. 0 years of
  experience is a real value. New tutor / unavailable score keep the S3-T18 rules.
- For S3-T33: each entry exposes `sort.price`, `sort.rating` (the shown HALF_UP two-decimal score)
  and `sort.availability` (next-slot start instant), each `null` when missing, plus the column
  `position` as a stable tie-break.

## Commands and actual results

Node.js 22.23.4 (the sandbox did not have 24.19.0; pnpm warned about the engine), pnpm 11.19.0.

| Check                                                                                 | Actual result                                                                                             |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @hktutor/web exec vitest run test/tutor-comparison-view-model.test.ts` | 31 tests passed.                                                                                          |
| `pnpm --filter @hktutor/web test`                                                     | 42 files / 611 tests passed.                                                                              |
| `pnpm --filter @hktutor/web exec playwright test e2e/tutor-comparison-ui.spec.ts`     | 18 passed (6 cases × chromium, tablet-chromium, mobile-chromium); all public reads are route-mocked.      |
| `pnpm --filter @hktutor/web exec tsc --noEmit -p .`                                   | Passed.                                                                                                   |
| `pnpm format:check`, `pnpm lint:root`, `pnpm --filter @hktutor/web lint`              | Passed.                                                                                                   |
| `pnpm verify:workspace`                                                               | 131 passed, 0 failed.                                                                                     |
| `pnpm --filter @hktutor/web build`                                                    | Not completed: the sandbox cannot reach Google Fonts (`next/font` fetch for Mali/Caveat). Re-run locally. |

No database was used, migrated or seeded; the change is web-only.

## Acceptance coverage

| Evidence requirement                         | Covered by                                                                                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| No comparison database table                 | Web-only diff; view derived per render from existing public reads.                                                                                |
| Retain stable tutor IDs                      | View tests: selection order, loading → ready key, duplicate tutor, mismatched profile/course; e2e header `data-tutor-column` order.               |
| Exclude private/unpublished data             | Entry allow-list test with a wider runtime response; view test without bio/description; e2e popup never shows bio or the search-card description. |
| Six attributes / missing values (for S3-T30) | Row-order test; missing price/subject/grade/experience tests; e2e 0 price shows Unavailable, not NaN.                                             |
| Sort inputs (for S3-T33)                     | 350 before 450, shown-score rating, null for missing values, UTC availability instant, positions after a skipped duplicate.                       |

## Notes for the team

- S3-T30 can render `TutorComparisonViewColumn` directly; `COMPARISON_ATTRIBUTES` keys match the
  existing copy keys (`price`, `subject`, `rating`, `reviews`, `experience`, `availability`).
- S3-T33 can sort by `entry.sort.*` with `position` as the tie-break; `null` values should sort last
  (backlog: "no future slot sorts last").
- Search's `nextAvailableAt` uses `startAtUtc > now` while the public availability read uses
  `startAtUtc >= now`; they differ only for a slot starting at the exact request instant.
