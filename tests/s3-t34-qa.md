# S3-T34 comparison sort selector verification

Date: 2026-11-09 (Asia/Bangkok). Source:
[S3-T34 Trello card](https://trello.com/c/kMQBBVoH/207-s3-t34-add-comparison-sort-selector-preserving-selected-tutors-and-aligned-columns),
Sprint 3 Backlog row 35. Node.js 24.19.0, pnpm 11.19.0.

## Behavior

- The user selected **Priority Tabs** before implementation. Three native radios above the Course
  Tabs table choose `lowest_price`, `highest_rating` and `earliest_availability`. Labels and guidance
  are bilingual. The checked option has a mint wash and bottom edge; keyboard focus outlines its
  whole label. Controls have 44px targets and stack below 470px.
- The client reads the current query with `useSearchParams` inside a Suspense boundary and calls
  the existing S3-T33 pure sorter. The route no longer passes server query props and can prerender.
  Headers and all six attribute rows use the same sorted columns. Original selection order remains
  the tie-break; missing values remain last. No course is replaced by sorting.
- Native `history.pushState` updates only `comparisonSort`, retaining unrelated/repeated parameters,
  supplied tutor/course IDs and order metadata, and the fragment. Back/Forward restores the sort.
  These parameters do not initialize or persist selections. Reload/navigation away still clears
  the existing in-memory selection; there is no new URL selection format or browser storage.
- Sorting preserves selected courses, focus, table scroll and error/retry state. It does not open a
  new page, reset the selection or request public data merely to reorder. The checked priority
  remains visible while controls are disabled below two selections or when no public column is ready.
- Unknown, empty and repeated priorities retain the localized invalid-sort guidance and lowest-price
  fallback. Clicking any priority, including the checked default, repairs an invalid query. A polite
  live region announces the current sort independently of selection notices.
- No API endpoint, DTO/wire type, server search ranking, database schema or migration changed.

## Commands and actual results

| Command                                                           | Result                                                                                        |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `pnpm --filter @hktutor/web test`                                 | Passed: 44 files, 652 tests, including 8 new query-contract cases and existing sort tests.    |
| `pnpm --filter @hktutor/web lint`                                 | Passed with zero warnings.                                                                    |
| `pnpm --filter @hktutor/web build`                                | Passed, including TypeScript and `/tutors` prerendering.                                      |
| `pnpm --filter @hktutor/web test:e2e tutor-comparison-ui.spec.ts` | Passed: 48 tests, 16 scenarios across desktop/tablet/mobile Chromium on the production build. |
| `pnpm verify:workspace`                                           | Passed: 133 tests.                                                                            |
| `pnpm format:check`                                               | Passed.                                                                                       |
| `git diff --check`                                                | Passed.                                                                                       |

The sandbox initially blocked local server access (`EPERM`); the production server and Playwright
suite were run with a sandbox exception. An initial browser run was stopped because test clicks
targeted the visually hidden radio inputs. Tests now click the visible associated labels and verify
focus on the native radios; the subsequent complete run passed all 48 cases. Native arrow-key
interaction is tested separately. The production server prints Next.js's standalone-output warning;
it served the production pages successfully.

## Acceptance evidence

- **Two/three selections and repeated sorts:** new browser scenarios cycle all priorities repeatedly,
  checking tutor IDs in the header and each of the six rows, pressed course selections, selected
  radios, the localized status, and unchanged public-read logs.
- **URL history and retained metadata:** the same scenarios go Back to an absent priority, Forward
  to the selected priority and through later entries. They verify the fragment, tutor/course IDs,
  selection-order parameter and repeated unrelated parameters after every change.
- **Keyboard and scrolling:** native ArrowRight changes the selected radio and keeps focus. Clicking
  the visible labels focuses their radios. Table `scrollLeft` remains unchanged during repeated sorts
  and history traversal, including the 320px mobile viewport.
- **Invalid priorities:** unit coverage includes absent, empty, unknown, repeated identical and
  repeated different values. A browser scenario repairs an ambiguous query by selecting the checked
  default, then restores its guidance with Back while preserving selected columns.
- **Loading and retry:** translated Thai controls remain disabled until public reads complete.
  Another scenario keeps a failed column's retry action during sorting, disables controls during a
  pending retry, and reapplies the chosen priority when the retry succeeds.
- **Ties, nulls and regression:** existing S3-T33 unit/browser cases continue to cover stable ties,
  raw rating precision, missing prices/ratings/future availability, invalid sorts and refreshed data.
  Existing selection/replacement, privacy, timeout, delayed-response and movement checks also pass.

Screenshots `priority-tabs-2.png` and `priority-tabs-3.png` are generated under
`apps/web/test-results/**/`. The three-tutor desktop, tablet and 320px mobile screenshots were
visually inspected: controls fit, columns stay aligned, and the mobile table retains its native
horizontal scrolling. The viewport-height limit can require vertical table scrolling on desktop.

Browser tests intercept public/auth APIs and do not certify a live database-backed journey. No
database was migrated, seeded or reset. Full `pnpm check`, API/database tests and browsers other than
Chromium were not run for this web-only change.
