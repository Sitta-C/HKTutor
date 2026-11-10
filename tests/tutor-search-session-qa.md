# Tutor search session restoration verification

Date: 2026-11-10 (Asia/Bangkok). Follow-up to S3-T30, authorized by the user to retain search
context in `sessionStorage`. Node.js 24.19.0, pnpm 11.19.0. Baseline: local commit `ec11a6f`.

## Behavior

- The current tab stores one versioned record, `hktutor-tutor-search-v1`: selected tutor/course IDs
  in selection order, draft filter inputs, the applied query/ranking/page, mobile filter expansion
  and document scroll. Draft values are distinct from the applied query: editing a budget from 600
  to 750 without submitting restores 750 in the field while results still use the applied 600 budget.
- State initializes after the client boundary is ready, before the first search request. This avoids
  hydration mismatches, an unwanted unfiltered initial request and overwriting stored choices with
  an empty initial selection. Restored selections do not replay selection flights or open the popup.
- Returning from a tutor profile or reloading fetches current search results. Public tutor names,
  profile/listing payloads, prices, ratings and availability are never cached as tutor data. The
  comparison continues to recheck public visibility and the exact selected listing when opened.
  Hidden/unverified tutors remain unavailable rather than displaying old identities or another course.
- Scroll restores after results and catalogs establish layout height, and the browser clamps it to
  the available height. Pointer/touch/wheel or page-scroll keyboard interaction cancels a pending
  restore so a delayed request does not jump over user actions. Position is captured before normal
  same-tab profile-link navigation; writes after scrolling are debounced by 150ms and flushed on
  navigation/pagehide/unmount. Native history restoration is temporarily managed only while search
  is mounted; its prior setting is restored on cleanup. BFCache pageshow releases navigation guards.
- If a saved result page exceeds the current number of pages, search refetches the current last
  page (at least page 1) and persists the corrected query. Cancellation/request identity checks still
  reject stale responses, including during that corrective fetch.
- Storage is treated as untrusted: version, bounded text, applied numeric filters/ranking, page/page
  size, scroll, selected ID shape, distinct tutors/listings and maximum three selections are checked.
  The saved projection strips unknown fields and names even from broader runtime choice objects.
  Missing/malformed/unsupported state starts fresh. Storage access/quota failures retain the existing
  in-memory experience without blocking search/comparison. Clear/remove/replace update saved IDs.
- No API, authentication/token storage, database or wire type changed. No new persistence dependency
  was added. The existing Course Tabs popup, Compact Dock and Priority Tabs remain in place. This
  user request supersedes the earlier design requirement to clear selection on navigation/reload.

## Evidence

- 24 unit cases verify draft/applied separation, ordered IDs, page/ranking/scroll, invalid drafts,
  allow-listed projection, missing/malformed/oversized JSON, invalid versions/types/numbers/pages,
  invalid/duplicate/over-limit selections, storage key round trips, clearing and denied/quota storage.
- The main browser journey sets applied subject/grade/budget/rating, search ranking, page 2 and three
  selected tutors; it leaves a different unsent budget draft, scrolls down, visits a selected profile
  and returns. It verifies the fields, applied request parameters, page, pressed course selection,
  count, closed popup and restored document scroll. Reload repeats the assertions. A newly hidden
  tutor is unavailable when the comparison opens. Clearing persists across another reload. A new
  page with no opener starts independently with empty selection/default filters/page 1.
- Browser regressions now expect retained selections after both search-card and popup profile links.
  Other scenarios cover blocked storage, corrupt storage at document startup and a page 2 that
  disappears while viewing a profile. Existing six-attribute, retry, timeout, privacy, native keyboard,
  sorting/history, reduced-motion and responsive dock checks remain included.
- Browser API reads are intercepted; these checks do not certify a live database-backed journey.
  The viewport projects are desktop Chromium, tablet Chromium and mobile Chromium (320px in the
  session journey). Safari/Firefox, real assistive technology and BFCache restoration were not
  separately exercised. No migration, seed or database reset was run.

The initial corrupt-storage browser fixture mutated the running page immediately before reload.
Its legitimate pagehide save rewrote the valid in-memory state, so the expected fresh-session
assertion failed in all three projects while the other 69 tests passed. The fixture now injects
malformed data at the next document's startup, after pagehide and before application initialization;
its focused three-project rerun passed. Production behavior was not changed to accommodate the test.
A later full run exposed two fixture timing assumptions on mobile: a visibility check ran before
search finished mounting, and a fake-clock test advanced time before the unblocked comparison
column completed. Tests now await initial search results and the ready sibling respectively. The
final complete three-project browser run passed all 72 tests.

## Commands and actual results

| Command                                                                                                     | Result                                                                |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `pnpm --filter @hktutor/web test`                                                                           | Passed: 45 files, 685 tests.                                          |
| `pnpm --filter @hktutor/web lint`                                                                           | Passed with zero warnings.                                            |
| `pnpm --filter @hktutor/web build`                                                                          | Passed compilation, TypeScript and prerendering.                      |
| `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3002 pnpm --filter @hktutor/web test:e2e tutor-comparison-ui.spec.ts` | Passed: 72 tests, 24 scenarios across desktop/tablet/mobile Chromium. |
| `pnpm format:check`                                                                                         | Passed.                                                               |
| `git diff --check`                                                                                          | Passed.                                                               |
| `pnpm verify:workspace`                                                                                     | Passed: 133 tests.                                                    |

Browser checks use a production server on `127.0.0.1:3002`, started with
`pnpm --filter @hktutor/web exec next start --hostname 127.0.0.1 --port 3002` and loopback sandbox
exceptions. It prints the existing standalone-output warning and serves the production pages.
The full cross-workspace `pnpm check` and API/database checks were not run for this web-only change.

Screenshots `search-session-restored.png` under `apps/web/test-results/**/` were visually inspected
for all three projects: the returned page shows the selected course, page 2 and the three-tutor
Compact Dock at the restored scroll position, with pagination remaining accessible above the dock.
