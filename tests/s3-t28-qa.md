# S3-T28 — coupon/payment lifecycle regression

Verified 2026-11-13 (Asia/Bangkok), starting from HEAD `2187ec8`, against the
[S3-T28 card](https://trello.com/c/swNSPMJ2). Its approved PromptPay Test/zero-settlement
scope supersedes Sprint 3 Backlog row 29's older mock-payment wording. No tracker data was
changed. This change extends verification and documentation; production behavior, schema,
DTOs and wire types remain unchanged.

## Coverage and evidence

`apps/api/scripts/verify-coupon-payments.ts` extends the existing T26/DB05 verifier rather
than duplicating payment logic. It runs actual services, Prisma, PostgreSQL constraints/audit
triggers, JWT sessions, the Omise adapter and raw-body signed HTTP webhooks. Only outbound
provider HTTP is replaced in process; no external provider or real money is involved.

| Card requirement                            | Assertion / test                                                                                                                                                                                                          |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two students, two bookings, `maxUses=1`     | Observe both PostgreSQL coupon-lock waiters, one RESERVED/attempt/provider create, loser 409 and no claim/attempt/use/pending flag; winner settles once                                                                   |
| Same student, two bookings                  | New race with capacity **5**, proving student reuse rather than exhaustion: one success, one 409 `COUPON_ALREADY_USED`, one provider create; consumed reuse leaves full snapshot unchanged                                |
| Same booking retry / duplicate redemption   | Active retry keeps one charge; two signed callbacks plus current contend on the booking and create one use/consume audit; paid retry returns its existing receipt                                                         |
| Failure / confirmed expiry                  | New concurrent callback/current replay for both FAILED and EXPIRED releases once; fresh attempt after coupon expiry returns 409 `COUPON_EXPIRED`, makes no new charge and leaves the complete released snapshot unchanged |
| Uncertain create / status / countdown       | Lost POST, 503, missing metadata match and a passed QR deadline keep RESERVED; retry never POSTs again; metadata recovery uses the original attempt                                                                       |
| Coupon expires while pending                | Expire and deactivate after reservation; verified success still honors the reserved discount                                                                                                                              |
| Out-of-order failure after success          | Retrieved late failure cannot downgrade SUCCESSFUL, PAID or CONSUMED                                                                                                                                                      |
| Database failure and recovery               | Trigger-injected positive/zero settlement failures roll back booking/attempt/reservation/use/audit; successful retry settles once                                                                                         |
| Provider success versus cancel/apply/remove | New races keep the original 405.00 QR amount, coupon, one use and PAID status; each mutation returns 409 and cannot refund consumption                                                                                    |
| Pricing changes versus QR create            | Existing nine actual T25 apply/remove/replace service races preserve attempt/booking/reservation amounts                                                                                                                  |
| Zero settlement                             | Two simultaneous requests without Omise configuration return one coupon receipt, PAID, one use/audit and zero attempts/provider calls; cancellation denied                                                                |
| Amount boundaries                           | Existing checks reject 19.99, 150000.01 and coupon-discounted subminimum net before claims/provider; accept 20.00 and 150000.00                                                                                           |
| T25/T26 HTTP integration                    | New actual apply HTTP normalizes lowercase code to 10%/405.00; payment POST, blocked remove, signed success, current GET and paid POST retry preserve one charge/use                                                      |
| Legacy / retired writes                     | New legacy mock-paid read/retry preserves original timestamp/reference without charge or state change; actual retired mock-payment HTTP returns 410                                                                       |
| Provider contract / signatures              | Existing safety/mismatch/HMAC cases plus new attemptId recovery when another attempt shares bookingId, absent metadata and uncertain 429/500/503 POST responses without retry                                             |
| 905.00 report ledger                        | Existing DB04 PostgreSQL verifier sums only PAID + COMPLETED `netAmount`, excluding unpaid/canceled amounts: 405.00 + 500.00 = 905.00; no report endpoint introduced                                                      |
| Browser coupon/payment journey              | New bilingual apply → lost charge response → 503 → reload → recovered paid receipt → reload, with one payment POST and one coupon PUT; existing countdown/terminal/zero/lock/error coverage retained                      |

The lock helper still requires every lock-taking contender to be observed in PostgreSQL
before releasing its gate. In the success/cancellation case, both settlement contenders
wait; cancellation returns 409 at its existing active-payment precheck before acquiring a
write lock. Apply/remove each produce three observed waiters. Promise concurrency alone is
not counted as proof of overlapping writes.

## Sanitized persisted counts

Captured directly by the runner's `EVIDENCE` lines in
[payment-verifier.txt](evidence/s3-t28/payment-verifier.txt). Counts are per booking after
settlement; all four have `paymentPending=false` and zero remaining RESERVED claims.
No identity, token, secret, raw provider body or QR URL is printed.

| Case                    | Status / net THB |     Attempts | CONSUMED | CouponUse | Consume audit | Provider creates | Receipt kind |
| ----------------------- | ---------------- | -----------: | -------: | --------: | ------------: | ---------------: | ------------ |
| Final-use winner        | PAID / 405.00    | 1 SUCCESSFUL |        1 |         1 |             1 |                1 | Test charge  |
| Final-use loser         | UNPAID / 405.00  |            0 |        0 |         0 |             0 |                0 | None         |
| 100% settlement         | PAID / 0.00      |            0 |        1 |         1 |             1 |                0 | Coupon       |
| Integrated HTTP journey | PAID / 405.00    | 1 SUCCESSFUL |        1 |         1 |             1 |                1 | Test charge  |

The positive rollback probe intentionally returns generic HTTP 500 and logs only
`An unexpected API operation failed`. The entire before/after database evidence is compared
before replay, including audit rows. That expected error is not counted as a failed check.

## Reproduction

Use Node 24.19.0 and pnpm 11.19.0 from the repository root. The actual run created its own
`postgres:17-alpine` container, `hktutor-s3-t28-test`, on loopback port 55478 and applied all
29 committed migrations. A second empty database in that same container isolated DB04's seed
checks. The project `.env` database was never migrated, seeded or reset.

```bash
docker run --detach --name hktutor-s3-t28-test \
  --publish 127.0.0.1:55478:5432 \
  --env POSTGRES_USER=postgres --env POSTGRES_PASSWORD=disposable-local-only \
  --env POSTGRES_DB=hktutor_s3_t28_test postgres:17-alpine
docker exec hktutor-s3-t28-test pg_isready -U postgres -d hktutor_s3_t28_test
export DATABASE_URL='postgresql://postgres:disposable-local-only@127.0.0.1:55478/hktutor_s3_t28_test'
pnpm db:migrate:deploy
HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 pnpm db:verify:coupon-payments

docker exec hktutor-s3-t28-test createdb -U postgres hktutor_s3_t28_fixtures_test
export DATABASE_URL='postgresql://postgres:disposable-local-only@127.0.0.1:55478/hktutor_s3_t28_fixtures_test'
pnpm db:migrate:deploy
HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 pnpm db:verify:sprint3-fixtures
docker rm --force --volumes hktutor-s3-t28-test
unset DATABASE_URL
```

Both verifiers require the explicit opt-in, loopback-only disposable test URL without options
or fragments and applied migrations. Neither loads `.env` or migrates. DB04 also requires
initially empty users. They retain synthetic append-only evidence: discard only the owned
test container afterward. The example password is disposable local fixture data.

## Results

- `pnpm db:verify:coupon-payments` with the explicit target above: **19 groups passed**,
  with observed PostgreSQL lock gates and sanitized persisted evidence.
- `pnpm db:verify:sprint3-fixtures` with its separate empty target: **42 checks passed**,
  including the 905.00 THB ledger. See [fixture-verifier.txt](evidence/s3-t28/fixture-verifier.txt).
- `pnpm --filter @hktutor/api test --runInBand test/unit/payments`: **3 suites / 44 tests passed**.
- `pnpm --filter @hktutor/api test:e2e --runInBand payments.e2e-spec.ts booking-coupons.e2e-spec.ts`:
  **2 suites / 43 tests passed**.
- `pnpm verify:workspace`: **138 passed**.
- `pnpm --filter @hktutor/web exec playwright test e2e/student-promptpay-payment-ui.spec.ts --workers=2`:
  **111 passed** across desktop, tablet and mobile Chromium, including all six new bilingual
  recovery cases. Existing zero settlement, countdown, unsupported/error and checkout-lock cases pass.
- `pnpm check`: **passed** — Prisma generation, repository formatting, root/API/web lint,
  API **96 suites / 1,729 tests**, web **51 files / 815 tests**, API/web production builds and
  verifier script typecheck. The final documentation formatting check also passed.

### Browser receipts

Synthetic recovered receipts retain WELCOME10, 450.00 subtotal, 45.00 discount and 405.00 paid
net, with the fixed `chrg_test_t28recovered` reference. These are intercepted browser fixtures,
not provider receipts. The screenshots are written by the passing tests; desktop English,
tablet English and mobile Thai were visually inspected.

| Viewport | Thai                                                                             | English                                                                          |
| -------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Desktop  | [Receipt](../ui-design/review-evidence/s3-t28/discounted-receipt-desktop-th.png) | [Receipt](../ui-design/review-evidence/s3-t28/discounted-receipt-desktop-en.png) |
| Tablet   | [Receipt](../ui-design/review-evidence/s3-t28/discounted-receipt-tablet-th.png)  | [Receipt](../ui-design/review-evidence/s3-t28/discounted-receipt-tablet-en.png)  |
| Mobile   | [Receipt](../ui-design/review-evidence/s3-t28/discounted-receipt-mobile-th.png)  | [Receipt](../ui-design/review-evidence/s3-t28/discounted-receipt-mobile-en.png)  |

The owned container and both disposable databases were removed after verification.

Development failures were corrected before these final results: a nullable fixture ID caught
by TypeScript, an overly strict waiter count for cancellation's early rejection, and browser
locators for payment-specific errors and the two displayed net amounts. An initial full check
stopped at formatting while test edits were still in progress. No assertion was removed to pass.

## Limits

Browser API responses and QR images are intercepted; PostgreSQL/HMAC/provider-adapter checks
run separately. This is not a live Omise Test Dashboard or external-webhook delivery rehearsal.
It certifies neither real payment processing nor a new tutor-report aggregate endpoint.
No authentication, authorization, pricing or transaction rule was weakened, and no tracker
comment/status, production database or provider account was changed.
