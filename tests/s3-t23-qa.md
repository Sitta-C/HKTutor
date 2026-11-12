# S3-T23 — Coupon rules documentation and creation audit

Verified on 2026-11-12 (Asia/Bangkok), using Node 24.19.0 and pnpm 11.19.0, on top of `e4ef81f`.

Scope: Sprint 3 Backlog row 24, US9-1 (Epic E9). Depends on S3-T21 and S3-T22. This is a
documentation card. It adds no route, response field, migration, environment variable or UI
behavior. The backlog sheet was not edited.

## What changed

- **Swagger.** `coupons.swagger.ts` and `coupons.dto.ts` now document these rules:
  - the code normalization, ASCII 3–32 pattern and CITEXT uniqueness;
  - integer `percent` and `maxUses` bounds and the `active` default;
  - the exclusive UTC expiry, and that Bangkok input is converted to UTC with no date-only guess;
  - consumed/reserved/available capacity, and that consumed uses are never refunded;
  - that there is no edit or delete route;
  - the `COUPON_CODE_EXISTS` 409 body example.

  The code pattern and maximum uses are shared constants, so validation and Swagger cannot drift.

- **API README.** The new
  [coupon rules and audit reference](../apps/api/README.md#coupon-rules-and-audit-reference-s3-t23)
  has a rules table and the 409 example. It also covers the DB02/T26 audit contract, the approved
  PromptPay decisions (reservation, zero payment, amount and expiry cutoffs) and US9-1 traceability
  to S3-DB02/T21/T22/T23/T24.
- **Root README.**
  - Removed the outdated "current-consent checks" claim for admin coupon routes. The 2026-11-12
    admin consent correction in [S3-T21 QA](s3-t21-qa.md) removed those checks.
  - Noted the activation route that replaced "no toggle routes".
  - Updated the Sprint 2 "mock payment" summary to PromptPay Test Mode.
- **UI design doc.** The "Apply coupon, mock-payment section" row in `ui-design/uidesign.md` now
  describes the PromptPay reservation and consumption rules. `/mock-payment` stays retired (410).

## Acceptance mapping

| Acceptance criterion                                 | Evidence                                                                                                    |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Swagger matches the DTO, schema and response         | `test/unit/coupons/coupons.swagger.spec.ts` (new, 4 tests)                                                  |
| Only create/list/activation routes; no edit/delete   | Same spec: the generated document has exactly `GET`/`POST /admin/coupons` and `PATCH …/activation`          |
| 409 `COUPON_CODE_EXISTS` body                        | `test/coupons.e2e-spec.ts`: `welcome10` returns exactly the documented envelope; real-DB race in T21 runner |
| Create/list/activation responses exclude audit data  | `test/coupons.e2e-spec.ts`: exact 11-key coupon shape on all three routes                                   |
| One creation audit per coupon, rollback on failure   | `pnpm db:verify:admin-coupons` and `pnpm db:verify:coupons` (real PostgreSQL)                               |
| Fixture audit: one row per create; retries add none  | `pnpm db:verify:sprint3-fixtures`: new check after a repeated seed                                          |
| Bangkok date and time input; no date-only end-of-day | `apps/web/test/coupon-model.test.ts`: empty time is rejected; Bangkok 23:59 is sent as `16:59:00.000Z` UTC  |
| T24 boundaries (1/100 allowed; 0/-10/120, maxUses 0) | Existing `test/coupons.e2e-spec.ts` cases                                                                   |

## Real PostgreSQL evidence

A new `postgres:17-alpine` container `hktutor-s3-t23-test` published only `127.0.0.1:55463`, with
database `hktutor_coupon_docs_test`. All committed migrations applied. No `.env` database, seed
target or Omise account was used, and the container was removed afterwards.

```bash
docker run --detach --name hktutor-s3-t23-test --publish 127.0.0.1:55463:5432 \
  --env POSTGRES_USER=postgres --env POSTGRES_PASSWORD=disposable-local-only \
  --env POSTGRES_DB=hktutor_coupon_docs_test postgres:17-alpine
export DATABASE_URL='postgresql://postgres:disposable-local-only@127.0.0.1:55463/hktutor_coupon_docs_test'
pnpm db:migrate:deploy
HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 pnpm db:verify:sprint3-fixtures
HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 pnpm db:verify:admin-coupons
HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 pnpm db:verify:coupons
docker rm --force --volumes hktutor-s3-t23-test
```

| Runner                       | Result                                                                                                                |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `db:verify:sprint3-fixtures` | 42 checks passed, including "each fixture coupon has exactly one safe coupon.create audit after a repeated seed"      |
| `db:verify:admin-coupons`    | 9 checks passed: one 201/one 409 mixed-case race with one actor-bound audit, audit-failure rollback, activation audit |
| `db:verify:coupons`          | All groups passed, including audit atomicity/rollback, safe JSON and append-only evidence                             |

A direct query after the fixture runner returned 12 `coupon.create` rows for 12 distinct DB04
coupons.

## Focused checks

| Command                                                                    | Result                                                     |
| -------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `pnpm --filter @hktutor/api exec jest test/unit/coupons`                   | 3 suites / 32 tests passed (includes the new Swagger spec) |
| `pnpm --filter @hktutor/api exec jest --config test/jest-e2e.json coupons` | 2 suites / 104 tests passed                                |
| `pnpm --filter @hktutor/web exec vitest run test/coupon-model.test.ts`     | 38 tests passed                                            |
| `pnpm lint`                                                                | Passed                                                     |
| `pnpm test`                                                                | Web 49 files / 767 tests; API 96 suites / 1,724 tests      |
| `pnpm --filter @hktutor/api test:e2e`                                      | 26 suites / 714 tests passed                               |
| `pnpm build`                                                               | Web and API production builds and script typecheck passed  |
| Prettier on every changed file (LF content)                                | Passed                                                     |

`pnpm check` stops at `format:check` on this Windows checkout. `core.autocrlf=true` gives 715
working-copy files CRLF endings. For the same reason `pnpm verify:workspace` passes 136/138. Its
two failures hash or compare files this card does not touch (the DB03 migration and the CI
workflow), and the committed DB03 blob matches the expected hash. Because of this, the remaining
`pnpm check` steps were run one by one above.

Playwright was not rerun because no web UI code changed. The admin coupon browser evidence
remains in [S3-T22 QA](s3-t22-qa.md).

## Limits

- This card documents and tests the existing T21/T22/DB02/T26 behavior. It does not change the
  coupon rules.
- Live Omise delivery is still outside this card; the T26 Test Mode rehearsal limits still apply.
