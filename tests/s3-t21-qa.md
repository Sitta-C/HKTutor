# S3-T21 — Admin coupon creation and listing

Verified on 2026-11-10 (Asia/Bangkok), using Node 24.19.0 and pnpm 11.19.0.

Scope: [S3-T21](https://trello.com/c/VSu1dyOk),
[POST child](https://trello.com/c/chFvNE9E), and
[GET child](https://trello.com/c/sYwlEaDK); source Sprint 3 Backlog row 22, US9-1.

## Implemented contract

- Flat `coupons` module registers only `POST/GET /api/v1/admin/coupons`.
- Both routes authenticate before ADMIN authorization, require current consent and return
  successful private responses with `Cache-Control: no-store`.
- Creation trims/uppercases ASCII codes, validates the code/JSON integer/boolean/UTC future
  expiry boundaries, rejects unknown fields and defaults active to true.
- Existing CITEXT uniqueness decides duplicate races. Prisma's actual PostgreSQL adapter reports
  `Coupon_code_key` through `driverAdapterError.cause.constraint.index`; the service recognizes
  this and the target-field form, while preserving unrelated audit failures as server errors.
- Transaction-local actor context feeds DB02's atomic insert/audit trigger. The persisted action
  is **coupon.create**, not the Trello card's earlier planned **COUPON_CREATED**. No migration,
  duplicate application audit or `TutorDocumentAudit` reuse was added.
- Listing uses validated exclusive cursors and descending `(createdAt,id)`, default 20/max 50.
  A repeatable-read snapshot counts uses and RESERVED reservations, with no double-counting of
  CONSUMED reservations. Response fields are explicitly allow-listed.

## Coverage and actual results

| Check                                                                         | Result                                                      |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `pnpm --filter @hktutor/api test --runInBand test/unit/coupons`               | 2 suites, 24 tests passed                                   |
| `pnpm --filter @hktutor/api test:e2e --runInBand`                             | 25 suites, 664 tests passed, including 58 coupon HTTP tests |
| `pnpm db:verify:admin-coupons` with the explicit disposable environment below | 6 real HTTP/PostgreSQL groups passed                        |
| `pnpm verify:workspace`                                                       | 133 repository contracts passed                             |

`pnpm check` also passed: Prisma generation, repository formatting/lint, API and web unit tests,
API/script type checks and the web production build. Final `pnpm format:check`, focused lint for
the subsequently added verifier safety test, and `git diff --check` passed.

Unit coverage includes actor binding, defaulting, expiry exactly now/past/invalid and expiry after
connection acquisition, precise duplicate-index mapping, audit error propagation, repeatable-read
counts, cursor boundaries and empty data. Verifier target tests reject missing opt-in/URL,
non-loopback hosts, non-test database names and URL options/fragments.

The HTTP suite runs real guards, global validation and service code with mocked persistence. It
covers guests, wrong roles, revoked/expired sessions, inactive/deleted/unverified accounts,
missing/outdated consent; 1/100 percent, maxUses 1/INT_MAX, normalized codes, false/default active;
numeric strings/fractions/nulls/out-of-range values, unknown/missing fields, invalid/past/equal-now
expiry, non-UTC offsets/excess precision, unsafe/non-ASCII code shapes; list limits 1/50,
invalid/repeated query values, malformed cursors and private response headers/shapes.

### Real PostgreSQL evidence

A new `postgres:17-alpine` container named `hktutor-s3-t21-test` was created, bound only to
`127.0.0.1:55451`, with database `hktutor_coupon_api_test`. All 25 committed migrations applied
successfully to that empty disposable target. No shared/development database was migrated or seeded.

```bash
DATABASE_URL='postgresql://postgres:disposable-local-only@127.0.0.1:55451/hktutor_coupon_api_test' \
  pnpm --filter @hktutor/api db:migrate:deploy
DATABASE_URL='postgresql://postgres:disposable-local-only@127.0.0.1:55451/hktutor_coupon_api_test' \
  HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 pnpm db:verify:admin-coupons
```

The 6 passing groups prove:

1. Concurrent mixed-case POST requests yield one 201 and one 409 `COUPON_CODE_EXISTS`, with one
   coupon and one actor-bound audit containing only percent/maxUses/active.
2. A deliberate audit operation-key collision rolls back the coupon insert.
3. An audit actor FK failure through the real service rolls back its coupon as well.
4. One-item pages with equal creation times preserve descending IDs and reach the end.
5. Actual RESERVED → RELEASED/CONSUMED transitions yield `[consumed,reserved,available]`
   values `[0,1,9]`, `[0,1,9]`, `[1,1,8]` for maxUses 10; the final HTTP list matches the
   service metadata without private student/provider fields.
6. Revoking the persisted session rejects the real signed JWT on the HTTP list route.

The first real race exposed the adapter metadata mismatch (500 instead of 409). The final runner
passed after the specific index mapping and its negative audit-index regression test were added.
Initial sandbox-only HTTP/database attempts were denied local socket access; the successful runs
used authorized local socket access. No checks were substituted with mocked database success.
The isolated container and its anonymous data volume were removed after verification. The 9
verifier safety cases were added after the broad unit run and passed in the final 24-test focused
coupon run; formatting and focused lint were checked again afterwards.

## Limits

No coupon UI, student coupon application, Booking snapshots, actual Omise calls or deployment is
part of this task. The verifier uses synthetic payment-attempt states to exercise the existing
reservation triggers; it does not certify the later payment orchestration. DB02 must already be
deployed before these routes are used. Trello and Google Sheets were read for scope and were not edited.
