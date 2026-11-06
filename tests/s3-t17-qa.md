# S3-T17 and detail API-02 verification

Date: 2026-11-06 (Asia/Bangkok). PR: <https://github.com/Sitta-C/HKTutor/pull/145>.

## Scope and implemented behavior

- S3-T17 owns raw review totals, display-cache maintenance/reconciliation and detail API-02.
  S3-T19/API-01 owns search/filter/ranking/HIGHEST_RATED and search fixture integration; S3-T18 owns
  UI presentation. This change does not implement those separate cards.
- Review creation and the new reconciliation command share one cache writer. It sums actual
  clarity/punctuality/preparation dimensions, retains the raw numerator/count, and explicitly rounds
  HALF_UP only for display. The agreed 5/4/5 plus 4/4/4 example yields 4.33/count 2.
- Review creation retains its booking-then-tutor locks and atomic insert/cache transaction.
  Reconciliation uses tutor-row locking and READ COMMITTED transactions, with batches of 100 IDs.
  Tutors without reviews are reset to null/0/null. Otherwise ratingUpdatedAt is the latest actual
  review timestamp. Existing reviews, bookings and profile identity remain intact; no synthetic
  reviews or counts are created.
- The operational command requires an explicit DATABASE_URL and
  HKTUTOR_APPLY_REVIEW_RATING_RECONCILIATION=1. It never loads .env, migrates or seeds. An interrupted
  rebuild is restartable because each tutor is atomic; the ordinary profile updatedAt advances on
  rebuilding, while derived cache values and the latest review timestamp remain reproducible.
- Detail retains its numeric ratingAverage/null, integer reviewCount and tutor/listings wrapper.
  Unsupported query fields and malformed UUIDs return 400; missing/non-public tutors return 404.

## Commands and actual results

Node.js 24.19.0, pnpm 11.19.0. Commands run from the repository root.

| Check                                                                                                                          | Actual result                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused reviews service, rating helper, reconciliation-command and verifier-safety unit tests                                  | 4 suites / 44 tests passed.                                                                                                                                       |
| `pnpm check`                                                                                                                   | Passed: Prisma generation, formatting, all workspace lint, 83 API suites / 1,513 tests, 40 web files / 540 tests, API/web production builds and script typecheck. |
| `pnpm --filter @hktutor/api test:e2e --runInBand`                                                                              | 24 suites / 587 tests passed. These suites use their configured isolated persistence; the real database evidence is below.                                        |
| `pnpm verify:workspace`                                                                                                        | Passed.                                                                                                                                                           |
| `git diff --check`                                                                                                             | Passed.                                                                                                                                                           |
| `HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 pnpm db:verify:review-ratings` with the explicit disposable URL                          | All five real-service/PostgreSQL scenario groups passed.                                                                                                          |
| `HKTUTOR_APPLY_REVIEW_RATING_RECONCILIATION=1 pnpm db:reconcile:review-ratings` with that disposable URL after fixture cleanup | Passed; zero tutors remained to reconcile.                                                                                                                        |

No shared/project database was migrated, seeded or reconciled. A newly created PostgreSQL 17
container, hktutor-s3-t17-rating-test, exposed only an ephemeral loopback port and the disposable
hktutor_s3_t17_rating_test database. All 24 committed migrations were applied to this empty target.
Only synthetic rating.invalid users and randomly identified fixtures were used. The container was
removed after verification.

## Real service and PostgreSQL evidence

The verifier calls production ReviewsService, review-rating helpers and TutorDirectoryService,
and runs the public detail controller with the real global validation/error pipeline. Persistence
is real PostgreSQL rather than mocked responses. It passed the following scenario groups:

1. Start with null/0 detail values; gate two independent completed-booking review writes behind a
   real tutor-row lock and observe both blocked through pg_stat_activity. After release, both
   reviews persist, raw numerator/count are 26/2, and fresh detail/search reads return 4.33/count 2.
2. Corrupt caches across 103 synthetic tutors, including tutors with no reviews, then rebuild across
   the 100-row batch boundary. Rated caches are repaired, all 102 no-review tutors become
   null/0/null, the timestamp matches the latest stored review, and review/booking records compare
   equal before and after. A second rebuild returns the same derived values.
3. Gate reconciliation and a third real review creation on the same tutor row. After both complete,
   detail/search return 4.56/count 3 without a lost count regardless of lock acquisition order.
4. Install a temporary failure trigger on only the synthetic tutor's cache update. A real review
   creation fails and the new Review row is absent; the previous 4.56/count 3 remains. Reconciliation
   propagates failure, and succeeds when rerun after the trigger is removed.
5. Verify the exact public detail projection and numeric fields, unsupported query/UUID 400s,
   missing tutor 404 and unverified tutor 404. Fixture and failure-trigger cleanup runs in finally.

Unit tests additionally cover the exact HALF_UP 4.125 boundary, rating endpoints 1 and 5,
zero reviews, scoped aggregate queries, tutor deletion between scan and lock, failure propagation,
explicit write opt-in and rejection of unsafe disposable-verifier targets. The existing full API
HTTP suite continues to cover review authentication, consent, ownership, validation and conflicts.

## Handoff

This verifies the agreed S3-T17/API-02 implementation scope. PR approval/merge and running cache
reconciliation on a separately confirmed deployment database remain normal rollout actions.
Raw-precision search comparisons, ranking/tag behavior and search fixtures remain S3-T19/API-01.
