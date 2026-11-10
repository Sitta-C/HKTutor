# Comparison Dock visibility verification

Date: 2026-11-10 (Asia/Bangkok). User-approved follow-up to S3-T30 and search-session persistence.
Baseline: local commit `973b01b`. Node.js 24.19.0, pnpm 11.19.0.

## Behavior

- `TutorComparisonPocket` mounts the floating Dock/popup only when at least one tutor is selected.
  Zero selections leave the search-row controls and existing inline comparison guidance available.
  Restored nonempty `sessionStorage` selections show the Dock with the popup initially closed.
- With one tutor, the Dock shows the bilingual add-one guidance and opens for inspection/removal;
  Priority Tabs remain disabled. Two/three tutors use the existing comparison behavior.
- Removing the last tutor or clearing explicitly closes the native dialog before updating selection
  and unmounting the floating UI. The parent focuses its existing results heading with
  `preventScroll: true`. Removing a tutor while others remain keeps focus on the popup close control;
  ordinary close/Escape returns focus to the visible Dock. Toggling the final search-row selection
  leaves focus on that row's still-mounted button.
- The polite selection-status region stays mounted outside the conditional floating UI, so removal
  and clear announcements remain available after the Dock disappears. The existing data hook cleans
  up pending reads on unmount; a new selection mounts a closed popup with fresh request state.
- Session persistence, sorting, public-data validation, selection limits/replacement, Dock geometry,
  native scrolling, selection flights and reduced-motion behavior retain their existing contracts.
  This supersedes the former zero-selection Dock/empty-popup behavior. No API, storage schema,
  database or migration changed.

## Evidence and checks

- Updated existing browser expectations: fresh/corrupt/blocked/cleared sessions have no Dock, and
  clearing removes the popup. The Thai normal-motion scenario now starts without a Dock, selects one
  tutor, opens its guidance with Enter, then checks two-tutor Space/Escape, scroll/resize and 320px
  geometry as before.
- A new browser journey verifies zero/one/two selections, keyboard selection, disabled one-tutor
  sorting, final removal and clear via keyboard, heading focus, retained removal/clear announcements,
  empty persisted IDs, zero-selection reload, restored one-tutor Dock with closed popup, and final
  deselection from a search row. A second verifies removing the only loading tutor and opening a
  later selection without a delayed response restoring old data.
- Screenshots `comparison-dock-hidden.png` and `comparison-dock-one-selected.png` are generated in
  `apps/web/test-results/**/`. Desktop hidden/one-selected and mobile one-selected images were
  visually inspected: zero state has no Dock; the heading receives a visible focus outline; selected
  state retains the white paper Dock, mint edge, count and readable guidance.

| Command                                                                                                     | Result                                                                                        |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `pnpm --filter @hktutor/web test`                                                                           | Passed: 45 files, 685 tests.                                                                  |
| `pnpm --filter @hktutor/web lint`                                                                           | Passed with zero warnings.                                                                    |
| `pnpm --filter @hktutor/web build`                                                                          | Passed compilation, strict TypeScript and prerendering.                                       |
| `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3002 pnpm --filter @hktutor/web test:e2e tutor-comparison-ui.spec.ts` | Passed: 78 tests, 26 scenarios across desktop/tablet/mobile Chromium on the production build. |
| `pnpm verify:workspace`                                                                                     | Passed: 133 tests.                                                                            |
| `pnpm format:check`                                                                                         | Passed.                                                                                       |
| `git diff --check`                                                                                          | Passed.                                                                                       |

Browser tests intercept public/auth APIs; they do not certify a live database-backed journey or real
assistive-technology output. Safari/Firefox and full cross-workspace `pnpm check` were not run for
this web-only change. No database was migrated, seeded or reset. The production server used
`pnpm --filter @hktutor/web exec next start --hostname 127.0.0.1 --port 3002` with loopback sandbox
exceptions and printed its existing standalone-output warning while serving all test pages.
