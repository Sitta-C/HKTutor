# S3-T33 stable comparison sorting verification

Date: 2026-11-09 (Asia/Bangkok). Source:
[S3-T33 Trello card](https://trello.com/c/nsSSmbPg/206-s3-t33-implement-stable-comparison-sorting-for-price-rating-and-earliest-availability),
Sprint 3 Backlog row 34. Node.js 24.19.0, pnpm 11.19.0.

## Behavior

- The pure `sortTutorComparisonView` helper returns a new array of complete columns. It retains
  column references and their tutor/course identities and never writes to the original selection.
  The existing selection controller continues to enforce at most three unique tutors.
- Only `lowest_price`, `highest_rating` and `earliest_availability` are accepted. The default is
  `lowest_price`. Missing values, including loading/error/unavailable columns, sort last for the
  selected criterion. Ties use original selection positions; unindexed ties follow indexed ties
  and use tutor ID order.
- Prices compare as integer satang from the existing numeric-baht public API. Ratings compare the
  canonical API number, preserving precision before display formatting. This intentionally replaces
  S3-T31's rounded display-score sort input; rating presentation still uses the shared summary.
- Availability compares UTC instants strictly after one captured refresh time. Past slots and
  slots starting exactly at that instant are unavailable for sorting. No timezone-local date
  comparison or `Date.now()` call occurs in the comparator.
- `/tutors?comparisonSort=highest_rating` selects a comparison sort independently of search ranking.
  Unknown, empty and repeated query values produce the localized validation message in the popup
  and use lowest price. Missing query values use the default without an error. Query parameters
  contain no selection data. The Next.js page awaits `searchParams` and remains thin.
- Every public-data refresh reapplies the same sort and captures one time after loading. Header and
  all six attribute rows render the same sorted view. Selecting/removing/replacing courses retains
  the existing in-memory selection flow. The on-screen sort selector remains S3-T34 work.
- There is no new wire type, backend request, endpoint, database table or migration. The existing
  public profile/availability reads remain authoritative; browser tests intercept those reads.

## Commands and actual results

| Command                                                           | Result                                                                                          |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `pnpm --filter @hktutor/web test`                                 | Passed: 43 files, 644 tests, including 33 new sort tests.                                       |
| `pnpm --filter @hktutor/web lint`                                 | Passed with zero warnings.                                                                      |
| `pnpm --filter @hktutor/web build`                                | Passed, including TypeScript. `/tutors` uses request-time rendering for its query.              |
| `pnpm --filter @hktutor/web test:e2e tutor-comparison-ui.spec.ts` | Passed: 33 tests, 11 cases across desktop/tablet/mobile Chromium, against the production build. |
| `pnpm format:check`                                               | Passed.                                                                                         |
| `pnpm verify:workspace`                                           | Passed: 133 tests.                                                                              |
| `git diff --check`                                                | Passed.                                                                                         |

The initial build exposed an exact-optional-property type mismatch; explicit `undefined` support
was added to the sort props before the successful build. The sandbox initially refused the local
server port, so browser execution required a sandbox exception. An initial development-server
browser run was stopped after the Next.js Dev Tools badge intercepted comparison-button clicks.
The successful run reused a local production server started with `pnpm --filter @hktutor/web start`,
which excludes development overlays. Next.js prints a standalone-output warning for this command;
the server served the production pages and all 33 browser checks passed.

## Acceptance evidence

| Requirement                             | Evidence                                                                                                                                                                                                                                   |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 350 before 450; missing price last      | Sort unit tests; integer-satang and equal-satang cases.                                                                                                                                                                                    |
| Highest rating first; null rating last  | Canonical-rating unit test; highest-rating browser scenario with 4.90, 4.33 and New tutor.                                                                                                                                                 |
| Future before absent/past availability  | UTC unit tests cover earlier/later, null, past and exact-now starts, plus a subsequent refresh time. Browser scenario covers future and no-slot columns.                                                                                   |
| Stable ties and deterministic fallback  | Unit tests cover original positions after a previous reorder, absent indices and mixed indexed/unindexed ties. Lowest-price browser scenario retains the two equal-price tutors' selection order.                                          |
| Unknown sort and immutable selection    | Unit validation covers arbitrary property names, objects, numbers and arrays; frozen-input tests check a new output array and unchanged complete columns. Browser scenario checks `__proto__`, validation feedback and pressed selections. |
| Updated data and six aligned attributes | Browser tests reopen after a public-price change and verify the new order. Each sort scenario checks the header and all six attribute rows by tutor ID.                                                                                    |
| Responsive and existing behavior        | All 11 browser cases run on desktop/tablet/mobile, including selection limits, course replacement, missing courses, retries, delayed responses, keyboard controls and Thai copy.                                                           |

Browser screenshots are generated at `apps/web/test-results/**/comparison-sort.png` for each sort
scenario and viewport. The desktop highest-rating and mobile invalid-sort screenshots were visually
inspected: headers, attribute rows, validation copy and horizontal scrolling remain usable.

These are browser integration tests with route-mocked public/auth reads, not evidence of a live
database-backed journey. No database was migrated, seeded or reset. API/database checks and full
`pnpm check` were not run for this web-only change.
