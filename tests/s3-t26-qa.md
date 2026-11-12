# S3-T26 coupon payment verification

Verified on 2026-11-12 (Asia/Bangkok), starting at repository HEAD `084c03b`.
Scope follows the [parent card](https://trello.com/c/86Jh6i4n) and its
[create](https://trello.com/c/XCptFfCu), [current](https://trello.com/c/7nR6Rokr) and
[webhook](https://trello.com/c/j6idmRXY) child cards. The sheet's older mock-payment wording
is superseded by these PromptPay Test / zero-settlement requirements. No board or sheet data
was changed.

## Implemented behavior

Existing payment routes now reserve coupon capacity before provider HTTP; consume only with
verified success; release only for definitive no-charge rejection or confirmed failure/expiry;
and preserve uncertain claims. Booking → coupon → reservation/attempt lock order and whole
transaction retries protect concurrency. Money stays Decimal/fixed-decimal strings. A full
coupon settles zero net atomically without Omise configuration or a PaymentAttempt. Its receipt
uses `coupon:<CouponUse.id>` and `attempt: null`, including retries.

The two student routes now require current privacy consent; create still accepts only an empty
body, and current rejects query parameters. Existing owner/role/session guards, raw-body HMAC,
retired mock-payment 410, no-store responses and paid/active-payment cancellation rules remain.
The Omise adapter also rejects a returned charge ID different from the requested one and reports
explicit live-mode/wrong-method contradictions as 409. Malformed/uncertain data remains 503.

No schema/migration, frontend or environment-variable changes are required. Deploy with DB02
and both DB03 migrations already applied. Swagger and the API runbook describe the contract.

## Real PostgreSQL, provider adapter and signed HTTP

Created a new `postgres:17-alpine` container named `hktutor-s3-t26-test`, publishing only
`127.0.0.1:55456`, with database `hktutor_coupon_payment_test`. All 27 committed migrations
applied successfully there. No repository `.env` database, seed or live Omise account was used.

```bash
DATABASE_URL='postgresql://postgres:disposable-local-only@127.0.0.1:55456/hktutor_coupon_payment_test' pnpm db:migrate:deploy
HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 DATABASE_URL='postgresql://postgres:disposable-local-only@127.0.0.1:55456/hktutor_coupon_payment_test' pnpm db:verify:coupon-payments
```

Final result: **13 groups passed**. This runs real payment services, PostgreSQL row locks,
constraints and evidence triggers. The real Omise adapter receives in-process stub HTTP responses;
signed callbacks pass through the real controller, raw-body signature verifier and exception
filter. Student HTTP checks use real signed JWTs and persisted sessions. The runner refuses
unapproved, remote, redirected or shared/non-test database targets and checks applied migrations.
It retains synthetic append-only evidence; discard the isolated container after use.

| Group                  | Evidence                                                                                                                               |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Final use              | Two students race for capacity 1; one claim/QR, loser never calls provider; active retry reuses it                                     |
| Success/replay         | Two signed callbacks plus current read settle once; exactly one use and consume audit; late failure cannot downgrade                   |
| In-flight expiry       | Deactivate and expire the coupon after reservation; verified success still consumes it                                                 |
| Student reuse          | Another booking for the same student's consumed coupon fails before provider HTTP                                                      |
| Uncertainty            | Lost POST response, 503 and absent history match keep CREATING, paymentPending and RESERVED; metadata recovery never creates a charge  |
| Release/retry          | Definitive 422, confirmed FAILED and confirmed EXPIRED release atomically; new attempts can retry                                      |
| Zero                   | Concurrent requests without provider configuration return the same paid receipt, no attempt/charge, one use/audit; cancellation denied |
| Amounts                | 19.99 and 150000.01 rejected; 20.00 and 150000.00 accepted; discounted subminimum rejected before reservation                          |
| Stale eligibility      | Inactive/expired coupon and changed applied code/percentage rejected without claims                                                    |
| Positive rollback      | Injected Booking failure returns generic 500 and rolls back successful attempt/use/audit; signed replay succeeds                       |
| Pending writes         | Hold provider response after claim commit; coupon removal and cancellation fail while RESERVED                                         |
| Concurrent writes      | Four payment/cancel and nine apply/remove/replace pricing-write races keep booking/attempt/amount/capacity aligned                     |
| Zero rollback and HTTP | Injected zero-payment failure leaves no reservation/use; retry consumes once; JWT/consent/body/no-store/HMAC checks                    |

The expected rollback probe logs only `An unexpected API operation failed`; no raw exception,
provider payload, token, cookie or credential is logged by the application.

## Other verification

- `pnpm --filter @hktutor/api test:e2e --runInBand payments.e2e-spec.ts`: **12 passed**.
  Covers missing authentication, wrong tutor/admin role, foreign/missing booking, invalid UUID,
  session-derived identity, client authority fields, no-store, forbidden current query parameters,
  retired mock route, valid/invalid/stale HMAC and missing/outdated consent.
- `pnpm verify:workspace`: **136 passed**.
- Full workspace `pnpm check`: **passed** (Prisma generation, repository formatting, all lint,
  web **47 files / 725 tests**, API **91 suites / 1,623 tests**, web/API builds and script typecheck).
- Existing `pnpm db:verify:payments` against the same isolated PostgreSQL database: **passed**
  (duplicate claims, callback replay, timeout recovery, rejection/retry, eight payment/cancel
  races and transaction rollback).

Initial migration/HTTP and full-check attempts inside the restricted sandbox failed because local
PostgreSQL and listening sockets were unavailable there. The same commands succeeded with local
network access. Initial development fixture/type/lint failures were corrected before the final runs;
none are counted as passes.

## Limits and integration dependency

At the initial verification baseline, the checkout did not contain T25 quote/apply/remove HTTP
routes. T25 is now included in the base branch. The verifier still prepares applied snapshots
through real Prisma writes and races the same database-guarded pricing mutations; it does not
exercise the T25 HTTP endpoints. A combined T25/T26 HTTP integration and T27 UI journey remain
additional coverage. This change implements the T26 side against the existing snapshot contract.

Omise is stubbed: no live Test Dashboard settings, actual QR delivery, external webhook delivery
or real money transfer was verified. No browser/UI behavior changed. The remaining T28/final
journey coverage remains separate. Trello/Google Sheets statuses were left as found.
