ผ# S3-T22 — Admin coupon workspace

Scope: Sprint 3 Backlog row 23, US9-1. Verified on 2026-11-11 (Asia/Bangkok).
The implementation uses the existing S3-T21 API and S3-DB02 persistence. No API, database,
payment, student coupon application or other Sprint task was changed.

## Implemented behavior

- Thin `/dashboard/coupons` route exports noindex/nofollow metadata. Only ADMIN sessions mount
  the workspace or fetch coupons; the existing server API remains the authorization authority.
  Admin navigation adds Coupons without exposing it in student/tutor menus.
- Feature components, bilingual copy, pure validation/recovery logic and Tailwind utilities live in
  `apps/web/src/components/coupons`. The existing shell, inputs, icons, toast and loading primitives
  are reused. Responsive container queries handle the sidebar's effect on usable content width.
  Coupon-specific CSS has been removed. Body text inherits the existing Bai Jamjuree font;
  the note accent uses the shared `font-note` class (Mali for Thai, Caveat for English).
  Headings/counts use the available 700 weight and form inputs remain 16px.
  Browser assertions compare heading/input font families with the application body font and
  check the localized note font. Screenshot checks also verify stacked versus side-by-side layout,
  input visibility and clearance from the desktop sidebar. Captures use reduced motion so they
  do not record the shared shell halfway through a transition.
- Creation sends only normalized code, integer percent, UTC expiresAt, integer maxUses and active.
  Code is 3–32 ASCII letters/digits/underscore/hyphen; percent is 1–100; maximum uses is
  1–2147483647. Expiry must be strictly future. Bangkok midnight is converted to the previous UTC
  date with the existing helper, independently of the browser's local timezone.
- The register pages newest-first with limit 20 and the server's opaque cursor. It displays exact
  consumed/reserved/available/maximum values and Bangkok expiry. Inactive, expired and exhausted
  badges are independent; available requires all eligibility conditions. Expiry updates locally
  at its exclusive boundary, on focus/visibility resume, and during periodic clock checks.
- Initial and next-page loading, empty results, recoverable reads, 400 field errors, 409 duplicate
  codes, 401 sign-in recovery and 403 access denial have distinct states. Mutation failures retain
  form input. Pending submission locks the fields/button and prevents duplicate POSTs.
- A confirmed POST inserts its response immediately and refetches page one. Late reads are canceled;
  failed refreshes retain the confirmed row. Terminal access failures hide the private workspace.
  Requests are canceled and private state is discarded on unmount or account changes.
- Network/timeout/5xx creation outcomes require an explicit read-only reconciliation before a user
  can retry. Because T21 has no code filter, reconciliation traverses cursor pages with a 30-second
  deadline, 12-second request timeouts and 100-page ceiling. Failed, repeated-cursor and incomplete
  scans retain the retry gate. A found code is described as existing, never as proof that this
  request created it; a complete absence permits a manual retry. No automatic network POST retry
  or extra endpoint is introduced.
- There are no edit/delete/activation-toggle controls, usage mutations, fabricated runtime data,
  monetary calculations or payment changes.

## Checks

| Command                                                                                                   | Actual result                                                                   |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `pnpm --filter @hktutor/web test -- coupon-model.test.ts coupon-api.test.ts dashboard-navigation.test.ts` | 3 files, 44 tests passed                                                        |
| `pnpm --filter @hktutor/web test`                                                                         | 49 files, 763 tests passed                                                      |
| `pnpm --filter @hktutor/web lint`                                                                         | Passed                                                                          |
| `pnpm --filter @hktutor/web test:e2e admin-coupons-ui.spec.ts --workers=2`                                | 54 tests passed across desktop, tablet and mobile Chromium                      |
| `pnpm --filter @hktutor/web build`                                                                        | Passed on the final implementation; `/dashboard/coupons` generated successfully |
| `pnpm verify:workspace`                                                                                   | 132 passed, 1 unrelated failure in the existing CI contract                     |

The repository failure is `tests/swagger-ci-foundation.test.mjs` at its CI secret-placeholder
comparison: CRLF in the unchanged `.github/workflows/ci.yml` yields a trailing `\r` that the test
does not strip. Those files were left untouched. A full `pnpm check` was not run: only the web
workspace changed, its relevant checks were run directly, and the unrelated contract issue remains.
The available runtime reported Node 24.20.0 and pnpm 11.19.0; the repository requests Node 24.19.0.

Initial tooling attempts were denied access to installed dependencies and were rerun with permitted
access. Early browser runs caught test-fixture omissions (refresh-cookie presence and collapsed
mobile navigation) and a real focus issue after re-enabling the saving fieldset. Focus restoration
now waits for the rendered enabled input. The final 54-test run includes that regression.

## Browser evidence and limits

The E2E tests load the actual Next.js route and components, intercepting API requests with explicit
synthetic fixtures. They do not touch a project database or a payment provider. They verify keyboard
operation, focus, noindex, role restrictions, UTC conversion, payload shape, validation, pending
submission, uncertain recovery, pagination/retry, stale GET cancellation, creation-refresh failure,
expiry and terminal access failures. The browser timezone is deliberately America/Los_Angeles.
This is frontend integration evidence; it does not rerun T21's real PostgreSQL verification.

Six real browser captures are saved in `ui-design/review-evidence/s3-t22/`:

- `coupons-1440-en.png` and `coupons-1440-th.png`: 1440×1024 desktop viewport.
- `coupons-768-en.png` and `coupons-768-th.png`: 768×1024 tablet viewport.
- `coupons-320-en.png` and `coupons-320-th.png`: 320×860 mobile viewport, retaining Pixel 7
  touch/device-density emulation. Image pixel dimensions therefore differ from CSS viewport size.

These are full-page captures of the implemented UI using test data, not generated design images.
Both languages have visible labels, non-color status text and readable capacity rows. The responsive
checks assert no page-width overflow, usable input dimensions and keyboard focus order, and collect
zero uncaught browser errors in the screenshot journeys. The existing body font is local Bai
Jamjuree; an earlier development run temporarily fell back for Google-hosted note fonts because of
network access, without changing app source. No Safari/Firefox or physical-device run is claimed.

## PR #163 review follow-up (2026-11-11)

- [P2: primary-button contrast](https://github.com/Sitta-C/HKTutor/pull/163#discussion_r4535381547):
  the creation button now uses Tailwind `amber-800` with `amber-900` on hover and the existing
  paper-colored text. A browser regression calculates WCAG contrast from computed colors converted
  to sRGB and requires at least 4.5:1. Normal contrast is checked on all three Chromium projects;
  hover contrast is checked when the device reports hover support. Touch-only projects retain the
  normal state, matching Tailwind's hover media query.
- [P3: inspect the recovered coupon](https://github.com/Sitta-C/HKTutor/pull/163#discussion_r4535405756):
  reconciliation retains the actual matching API record and displays a read-only summary directly
  below its notice. The summary includes code, percent, consumed/reserved/available/maximum uses,
  Bangkok expiry and stored activation in both languages. It remains visible when the match is on
  a later page and refreshing page one fails. Editing the form clears the summary; the user's draft
  values remain intact. Finding an existing code does not claim that the failed request created it.
- New regressions use 20 recent rows followed by a matching 21st coupon with values different from
  the submitted draft. They verify the returned details, retained draft, single POST and a failed
  first-page refresh in Thai and English. Screenshots wait for the transient toast to disappear.

The production build passed, and the web unit run passed all 49 files / 763 tests. Browser evidence
uses a separate production server at `http://localhost:3002`, with the same intercepted API fixtures
and no database/provider writes. An earlier browser attempt lost the development server during a
concurrent build (`ERR_CONNECTION_REFUSED`); browser verification was restarted after the build
completed. No application workaround or unrelated configuration change was introduced.

Additional recovered-summary captures are named `recovery-{project}-{language}.png` under
`ui-design/review-evidence/s3-t22/`, for `chromium`, `tablet-chromium`, `mobile-chromium` and `en`/`th`.
The existing six responsive page screenshots are regenerated to show the updated button.

Review verification results:

| Command                                                                    | Actual result                                                               |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `pnpm --filter @hktutor/web test`                                          | 49 files, 763 tests passed                                                  |
| `pnpm --filter @hktutor/web lint`                                          | Passed; focused E2E-file lint also passed after the hover/toast corrections |
| `pnpm --filter @hktutor/web build`                                         | Passed; coupon route generated successfully                                 |
| `pnpm --filter @hktutor/web test:e2e admin-coupons-ui.spec.ts --workers=2` | 63 tests passed across all three Chromium projects (2.5 minutes)            |

The browser command above ran with `PLAYWRIGHT_BASE_URL=http://localhost:3002` after starting the
completed production build with `pnpm exec next start --port 3002` from `apps/web`.
After narrowing the recovery screenshot to its summary region, the six bilingual recovery cases
were rerun with `--grep '21st coupon'` and all passed. Prettier checks passed for all five changed
source, test and documentation files.

## Shared coupon expiry pickers (2026-11-12)

Coupon creation now reuses `LocalizedDatePicker` and `TimeWheelPicker` from tutor availability.
Date and time stack at the form's full width so the seven-column calendar fits narrow screens.
The shared controls accept optional trigger IDs, placeholders, disabled/error styling and error
associations; existing availability callers retain their defaults. Empty dates open at Bangkok
today without silently selecting it, and both fields reset to empty after successful creation.
The calendar blocks earlier dates; existing validation still rejects a missing/past expiry instant.
Thai shows Buddhist years and English Gregorian years, while the draft stores ISO dates and
24-hour times and the existing Bangkok-to-UTC conversion constructs `expiresAt`.

Validation focuses the date trigger and links both triggers to the expiry explanation/error.
Buttons use error styling and `aria-describedby`; they do not use unsupported `aria-invalid`.
The existing calendar keyboard controls, time-wheel wrap/scroll/drag behavior, Enter/Escape and
focus restoration remain available. Pending/uncertain submissions disable both controls.

Browser tests now choose actual calendar cells and time-wheel values rather than filling native
inputs. New bilingual tests cover empty validation, past-day disabling, Buddhist/Gregorian years,
calendar Escape, minute 59→00 wrap, focus, clearing after success, UTC payload and no horizontal
overflow at 1440, 768 and 320px. Screenshots now go to each test's output directory, preserving
historical curated review images. API calls are intercepted; no real coupon is created.

Verification:

- Web unit suite: 49 files / 763 tests passed. The command
  `pnpm --filter @hktutor/web test -- coupon-model.test.ts date-time.test.ts` ran the full suite.
- `pnpm --filter @hktutor/web lint` and `pnpm --filter @hktutor/web build`: passed.
- `pnpm --filter @hktutor/web test:e2e admin-coupons-ui.spec.ts --workers=2 --output=/tmp/hktutor-coupon-picker-results`:
  all 69 tests passed across desktop, tablet and mobile Chromium.
- `pnpm --filter @hktutor/web test:e2e availability-ui.spec.ts --grep 'vertical wheels|touch gestures|outside clicks|creates an overnight|rejects reversed' --workers=2 --output=/tmp/hktutor-availability-picker-results`:
  14 passed; the desktop-only project skips the touch-only test by design.
- Safari manual check: shared calendar opens, Escape restores focus without choosing a date,
  and the time picker opens with separate hour/minute wheels. Existing draft fields were retained;
  no live coupon was submitted.
- Formatting and `git diff --check`: passed.

Early test assertions were updated for Thai weekday labels and button-based field errors.
Concurrent browser runs initially collided in Playwright's default artifact directory; final
runs use distinct output directories and passed without those artifact errors. No API or database
behavior was changed by this picker update.
