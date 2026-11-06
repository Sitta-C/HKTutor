# S3-T18 Margin Score verification

Date: 2026-11-06 (Asia/Bangkok).

The selected Margin Score presentation is shared by search rows, public tutor profiles, private
tutor account summaries, profile student-view previews and listing student previews. Ratings retain
two decimal places with positive HALF_UP display rounding. The existing API owns raw review
aggregation; no endpoint, database, filter, ranking or recommendation-tag behavior changes here.
Zero reviews shows New tutor and count 0 without a numeric score or empty stars. Invalid metadata
stays unavailable. The private account summary retains its existing review-unavailable notice.

Commands below use the installed workspace executables directly. Web commands run in `apps/web`.

| Check                                                                                                                                                                                          | Result                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `./node_modules/.bin/vitest run`                                                                                                                                                               | 40 files / 558 tests passed, including 30 rating model/presentation cases. |
| `./node_modules/.bin/eslint --max-warnings=0`                                                                                                                                                  | Passed.                                                                    |
| `./node_modules/.bin/tsc --noEmit`                                                                                                                                                             | Passed.                                                                    |
| `./node_modules/.bin/next build --webpack`                                                                                                                                                     | Passed.                                                                    |
| `./node_modules/.bin/playwright test e2e/tutor-rating-ui.spec.ts e2e/profile-summary-ui.spec.ts e2e/tutor-search-ui.spec.ts e2e/public-tutor-detail-ui.spec.ts --project=chromium --workers=2` | 73 tests passed.                                                           |
| Root Prettier check of changed files and `git diff --check`                                                                                                                                    | Passed.                                                                    |
| Root `node --test tests/tutor-search-web.test.mjs tests/personal-profile-foundation.test.mjs`                                                                                                  | 11 tests passed.                                                           |

The new browser suite covers Thai/English at 320/768/1440px across all five rating surfaces,
including changes from rated to zero-review metadata after reload, complete accessible score
labels, visible counts and overflow checks. Existing profile tests cover metadata updates after
saving and keyboard operation of the retained notice. Search/detail tests retain ranking, booking,
verification, loading/error and stale-result coverage. Their fixtures now include the existing
notification inbox; one stale heading assertion now matches the existing space-separated metadata.
All browser API requests are intercepted with synthetic fixtures. No project database was written.
Generated desktop/mobile screenshots were visually inspected against the selected design.

The broader root `node --test tests/*.test.mjs` attempt was interrupted while
`code-quality-config.test.mjs` waited on its `pnpm` subprocess. It reported 126 passes and one
cancellation; this is not a completed full workspace run. `pnpm check` was not run. API/database
verification is outside this UI-only change.
