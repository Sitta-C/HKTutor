# S3-T30 accessible tutor comparison verification

Date: 2026-11-10 (Asia/Bangkok). Source:
[S3-T30 Trello card](https://trello.com/c/ExbDK664/203-s3-t30-build-accessible-side-by-side-comparison-of-all-six-tutor-attributes),
Sprint 3 Backlog row 31. Node.js 24.19.0, pnpm 11.19.0. Baseline: main `df6e108` (merged PR #154).

## Agreed scope and implementation

The user authorized aligning the card with the implemented Course Tabs popup and white Compact
Dock with mint edge and Balance icon. The Trello description was saved and verified before coding;
source metadata, dependencies and existing Definition of Done were retained. This completes the
remaining S3-T30 work on `/tutors`, reusing S3-T29 selection, S3-T31 public projections, S3-T33 sorts
and S3-T34 Priority Tabs. There is no separate `/tutors/compare` route or second Compare action.

- Ready columns show the existing public Verified badge and a tutor-name link to
  `/tutors/[tutorId]?listingId=...`. Link path segments are encoded and the query uses
  `URLSearchParams`. Accessible names are bilingual; Enter follows the selected listing. Prefetch
  is disabled so merely showing a comparison does not prefetch profile pages.
- The existing guard requires the requested tutor, VERIFIED public status and exact selected
  listing before reading availability. Missing/hidden/unverified profiles or missing courses show
  unavailable without old identities, badges, links or substituted courses. Only the existing
  allow-listed projection reaches cells; bio and course description remain excluded.
- A focused data store and React hook replace the batch `Promise.all` read. Each column completes
  independently, with a distinct abort controller and 15-second timeout. Only an error column can
  retry; repeated requests while loading are ignored. Ready and other failed columns retain their
  objects. Removal, course replacement, close, unmount or reopening cancels obsolete reads, and
  request identity checks reject late responses even if the transport ignores cancellation.
- One UTC reference is captured on opening, used in each availability request's ISO `from`, in
  strictly-future slot selection (`start > reference`) and in sorting. Individual retries retain
  that reference; reopening captures another. The API still clamps `from` to its own current time.
  This is a consistent client reference, not an atomic server snapshot. Bangkok presentation uses
  the existing shared helpers. No API, DTO, schema, migration or profile-page range changed.
- The native table retains its caption and scoped headers. Each cell explicitly names its row
  header and stable tutor header with `headers`, so sorting/removal keep associations intact.
  Column keys remain tutor IDs. Native horizontal/vertical scrolling remains contained in the table.
- Retry focuses the stable close control before replacing the retry button with loading content.
  Other columns remain usable; Priority Tabs remain enabled if at least two tutors are selected
  and any public column is ready. The selected priority, URL, selections and horizontal scroll
  survive retry. Zero/one-selection guidance, reduced motion and Escape/focus return remain intact.

## Actual checks

| Command                                                                                                     | Result                                                                                             |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `pnpm --filter @hktutor/web test`                                                                           | Passed: 44 files, 661 tests (9 added S3-T30 cases).                                                |
| `pnpm --filter @hktutor/web lint`                                                                           | Passed with zero warnings.                                                                         |
| `pnpm --filter @hktutor/web build`                                                                          | Passed compilation, strict TypeScript and prerendering.                                            |
| `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3002 pnpm --filter @hktutor/web test:e2e tutor-comparison-ui.spec.ts` | Passed: 60 tests, 20 scenarios across desktop/tablet/mobile Chromium against the production build. |
| `pnpm verify:workspace`                                                                                     | Passed: 133 tests.                                                                                 |
| `pnpm format:check`                                                                                         | Passed.                                                                                            |
| `git diff --check`                                                                                          | Passed.                                                                                            |

The first lint run caught a stale effect dependency left by replacing the batch loader and an unused
parameter in a test helper; both were corrected. The first build rejected a deliberately unverified
fixture because the public API type permits only VERIFIED tutors. The browser fixture now returns a
malformed JSON response without changing the production wire type; the unit fixture explicitly
mutates a cloned response to exercise the runtime guard. The subsequent lint/build and full browser
suite passed. No lint rules or production types were weakened.

The local production server used `pnpm --filter @hktutor/web exec next start --hostname 127.0.0.1
--port 3002`. Browser tests and the server required a sandbox exception for loopback access. Next.js
printed its existing standalone-output warning; the server served all production test pages.

## Evidence and practical limits

- Unit tests cover independent partial completion, shared captured `from` across delayed reads and
  retries, duplicate retry rejection, unchanged ready/failed siblings, concurrent retries, a timeout
  followed by retry, late responses after close/removal/replacement/new opening, unverified public
  data rejection, missing courses and the exact future boundary. Existing sort/privacy tests pass.
- Browser checks verify all six fixture attributes, selected-listing links and Verified badges for
  two/three tutors; caption, row headers and explicit associations after sorting/removal; keyboard
  profile navigation and selection reset on return; two ready tutors while another is loading;
  revoked status hiding old identities/links; request logs proving only the failed tutor is retried;
  shared UTC through retry and a fresh UTC on reopening; focus, horizontal scroll and selected
  priority during retry. Existing selection/history/error/timeout/dock regressions remain covered.
- Browser screenshots are generated under `apps/web/test-results/**/`: `s3-t30-attributes-2.png`,
  `s3-t30-attributes-3.png`, `s3-t30-partial-loading.png` and the existing Priority Tabs/Compact Dock
  captures. The three-column desktop, mobile partial-loading and Thai 320px dock images were visually
  inspected. Rows remain aligned; the viewport-height limit requires native vertical table scrolling,
  and narrow widths use native horizontal scrolling without widening the page.
- These browser tests intercept public/auth API reads. They do not certify a live database-backed
  journey, actual screen-reader output, Safari or Firefox. Semantics, header relationships and
  keyboard behavior are checked in Chromium. No database was migrated, seeded or reset. API tests
  and the full cross-workspace `pnpm check` were not run for this web-only change.
