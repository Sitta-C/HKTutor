# S3-T24 — Admin coupon authorization and boundary regression

Verified on 2026-11-13 (Asia/Bangkok), using Node 24.19.0 and pnpm 11.19.0,
on top of `4408828`.

Scope: [Trello S3-T24](https://trello.com/c/YjuaVZGs/190),
[Sprint 3 Backlog row 25](https://docs.google.com/spreadsheets/d/17RMTjXa26ho7blv-TK5pbJFbHxVHJEBRPKCXk9x5AE0/edit?gid=504754817#gid=504754817),
US9-1, Epic E9. This extends the existing T21/T22 tests and verifier; production behavior,
DTOs, wire types and migrations remain unchanged. Trello and Sheets were read for scope only.

## Acceptance mapping

Paths below are relative to the repository root.

| Requirement                                                                                                                                          | Executable evidence                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Missing/expired token → 401; STUDENT/TUTOR → 403, including forged actor/body/query                                                                  | `apps/api/test/coupons.e2e-spec.ts` exercises the real guard/controller/validation/service pipeline with mocked token verification/persistence. `apps/api/scripts/verify-admin-coupons.ts` additionally uses an actually expired, correctly signed JWT and persisted STUDENT/TUTOR accounts with signed ADMIN claims; counts prove no Coupon/AuditLog writes.                                 |
| Percent 1/100 and maxUses 1 accepted; 0/-10/120, fractional/string percent, maxUses 0/fraction/overflow, invalid boolean and unknown fields rejected | HTTP contract cases in `apps/api/test/coupons.e2e-spec.ts`; pure form cases in `apps/web/test/coupon-model.test.ts`. The browser suite submits both percentage endpoints with maxUses 1 in Thai and English.                                                                                                                                                                                  |
| Expiry equal to now/past rejected; future UTC accepted, Bangkok conversion exact                                                                     | HTTP and service cases reject now and now−1ms and accept now+1ms under a fixed clock; service also rechecks expiry after transaction acquisition. Form cases test both sides of the exclusive boundary and midnight/23:59 conversion; browser uses America/Los_Angeles and verifies Bangkok midnight → previous day 17:00Z.                                                                   |
| Trim whitespace, normalize ASCII case; invalid/overlength code rejected                                                                              | HTTP/form boundary tables cover code alphabet, 3–32 length and Unicode rejection. Browser duplicate tests retain the mixed-case/whitespace draft while sending WELCOME10.                                                                                                                                                                                                                     |
| Concurrent mixed-case code produces one Coupon, one safe creation AuditLog, one 409 COUPON_CODE_EXISTS                                               | Real PostgreSQL verifier races two HTTP POSTs and checks statuses 201/409, the complete conflict envelope, Coupon count 1 and one actor-bound creation audit with only percent/maxUses/active.                                                                                                                                                                                                |
| Database uniqueness independently of DTO; atomic audit rollback                                                                                      | Verifier inserts a duplicate directly through Prisma with lowercase and surrounding whitespace, expects P2002 and unchanged Coupon/audit counts. A deliberately colliding audit operation key leaves no Coupon and only the pre-existing audit; invalid audit actor also rolls back the service transaction.                                                                                  |
| Stable createdAt/id cursor, invalid cursor 400, limits 1/50 accepted and 0/51 rejected                                                               | Service/cursor and HTTP cases plus real PostgreSQL HTTP traversal at limit 1 over three equal-timestamp rows, checking descending IDs, no repeats and end-of-list.                                                                                                                                                                                                                            |
| Only aggregate usage, no student IDs or audit internals                                                                                              | Exact 11-key response allow-list on create/list/activation; real reserve/release/consume counts and HTTP response checked by the verifier.                                                                                                                                                                                                                                                    |
| Admin UI duplicate/network/validation/success/empty/loading; retain input                                                                            | `apps/web/e2e/admin-coupons-ui.spec.ts` covers local/server field errors, duplicate code, disabled pending submission, success/reset, empty state, read retry, network-failed creation/reconciliation and access recovery. New bilingual endpoint tests retain code, percent, maxUses, date and time after each 409. Existing responsive/keyboard/screenshot cases run in all three projects. |

## Commands and actual results

| Command                                                                                            | Result                                                                                                                                 |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @hktutor/api test:e2e --runInBand --runTestsByPath test/coupons.e2e-spec.ts`        | 1 suite / 77 tests passed                                                                                                              |
| `pnpm --filter @hktutor/api test --runInBand test/unit/coupons`                                    | 3 suites / 32 tests passed (service, Swagger, verifier target safety)                                                                  |
| `pnpm --filter @hktutor/web exec vitest run test/coupon-model.test.ts test/coupon-api.test.ts`     | 2 files / 41 tests passed                                                                                                              |
| `pnpm check`                                                                                       | Passed: Prisma generation, repository formatting/lint, 815 web tests, 1,729 API tests, both production builds and API script typecheck |
| `pnpm verify:workspace`                                                                            | 138 tests passed                                                                                                                       |
| `HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 pnpm db:verify:admin-coupons` with the explicit target below | 11 real HTTP/PostgreSQL groups passed                                                                                                  |

The completed production build was served temporarily on `http://localhost:3002` with
`pnpm --filter @hktutor/web exec next start --port 3002`, then tested with:

```bash
PLAYWRIGHT_BASE_URL=http://localhost:3002 pnpm --filter @hktutor/web test:e2e \
  admin-coupons-ui.spec.ts --workers=2 --output=/tmp/hktutor-s3-t24-browser
```

All **108 tests passed** in 1.1 minutes across Chromium desktop/tablet/mobile. Both new bilingual
boundary/duplicate journeys passed in every project. Responsive screenshots cover 1440×1024,
768×1024 and 320×860 CSS viewports, with device pixel density retained on mobile. Screenshots
were inspected at desktop (Thai), tablet (English) and mobile (Thai); labels, controls and capacity
rows remain readable without page-width overflow. Screenshot journeys assert no uncaught page errors.
Artifacts are under `/tmp/hktutor-s3-t24-browser/`, and the temporary server was stopped afterwards.

Final changed-file Prettier and `git diff --check` passed after the documentation updates.

## Disposable database evidence

Created container `hktutor-s3-t24-test` from the locally available `postgres:17`, published only
on `127.0.0.1:55424`. All 29 committed migrations applied to the empty database
`hktutor_s3_t24_final_test`; no seed, configured application database or provider was used.

```bash
DATABASE_URL='postgresql://hktutor_test:disposable-local-only@127.0.0.1:55424/hktutor_s3_t24_final_test' \
  pnpm --filter @hktutor/api db:migrate:deploy
HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 \
  DATABASE_URL='postgresql://hktutor_test:disposable-local-only@127.0.0.1:55424/hktutor_s3_t24_final_test' \
  pnpm db:verify:admin-coupons
docker rm -fv hktutor-s3-t24-test
```

The final run passed all 11 groups, including the existing usage/activation/audit safety checks.
The container and its anonymous volume were removed afterwards. The verifier still requires an
explicit opt-in, loopback host, test database name and applied migrations, and never loads `.env`.

Initial sandbox-only HTTP attempts failed because local socket creation was denied; those checks
were rerun with permitted local socket access. An early verifier attempt passed the new checks
but then hit a case-insensitive email collision between the new role fixture and the existing
tutor fixture. The new fixture names were separated and the complete verifier passed against a
new empty database. The initial broad check found a type-import order issue; it was corrected
before the successful full `pnpm check`.

## Limits

Browser tests intercept API calls with synthetic fixtures; they verify the actual route/components
but do not represent a full browser-to-live-database journey. The separate verifier supplies real
JWT, HTTP, transaction and PostgreSQL evidence. No Omise calls, deployment or production data
changes were performed. Browser coverage is Chromium desktop/tablet/mobile emulation, with Thai
and English journeys; no Safari/Firefox or physical-device pass is claimed.
