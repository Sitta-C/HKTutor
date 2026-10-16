# S2-T06 mock-payment QA

Recorded on 2026-10-16 against `main` at `fecf5ac` plus the QA and pending-payment fix, using Node.js
24.19.0 and pnpm 11.19.0. S2-T04 and S2-T05 are the prerequisites for this task.

## Results

The payment regressions pass. The QA work in commit `951444a` identified that a PENDING
booking returned 409 instead of the 400 required by Product Backlog US12-5. The separate
fix changes PENDING to **400 BOOKING_NOT_PAYABLE** and preserves the error code and
payment data. CANCELED, COMPLETED and EXPIRED retain 409, as do already-paid bookings
and duplicate references. Both matching and mismatched amounts on a PENDING booking
return the state error before amount validation.

The UI recognizes `BOOKING_NOT_PAYABLE` before generic 400 validation, displays the
booking-state explanation, and requires a successful explicit refresh before another
submission. A generic `VALIDATION_FAILED` response still allows input correction.
Swagger and the API README document the new status distinction.

The requested cases behave as follows:

| Case                                                 | Observed HTTP result                  | Persisted-state evidence                                                                  |
| ---------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------- |
| Amount differs from the stored net amount            | 400 `BOOKING_PAYMENT_AMOUNT_MISMATCH` | Complete fixture booking snapshots unchanged                                              |
| Another authenticated student pays the booking       | 403 `BOOKING_NOT_OWNED`               | Complete fixture booking snapshots unchanged                                              |
| PENDING booking                                      | 400 `BOOKING_NOT_PAYABLE`             | Complete fixture booking snapshots unchanged                                              |
| Already PAID booking, submitted with a new reference | 409 `BOOKING_ALREADY_PAID`            | Original reference, timestamp, payment status and all other booking fields unchanged      |
| Empty or whitespace-only reference                   | 400 `VALIDATION_FAILED`               | Complete fixture booking snapshots unchanged                                              |
| Reference already used on a different booking        | 409 `MOCK_REFERENCE_TAKEN`            | Both the original PAID booking and the rejected UNPAID booking unchanged                  |
| Valid CONFIRMED + UNPAID booking                     | 200                                   | Response amount, reference, UTC timestamp and PAID status match PostgreSQL                |
| Injected failure after the payment write             | 500                                   | Existing rollback probe proves CONFIRMED/UNPAID with null payment timestamp and reference |

## Coverage

- `apps/api/scripts/verify-booking-endpoint-concurrency.ts` now sends the full negative
  matrix through the real NestJS HTTP stack, JWT/session authentication, ownership guard,
  validation pipe, service and PostgreSQL. Each business rejection compares complete
  booking rows before and after, including `paymentStatus`, `paidAt`, `mockReference`,
  amounts, status and `updatedAt`. The duplicate-reference case snapshots both bookings.
  The existing CI workflow already invokes this verifier after migration and seed.
- `apps/api/test/bookings-mock-payment.e2e-spec.ts` adds a literal empty reference to
  the existing HTTP matrix. This suite uses mocked Prisma and auth-token verification,
  while retaining the real guards and validation pipe. It is separate from the real
  database evidence above.
- `apps/web/e2e/student-mock-payment-ui.spec.ts` checks empty/whitespace input, duplicate
  recovery, and the existing amount/owner/payment conflicts. The additional
  `BOOKING_NOT_PAYABLE` regression verifies that a stale form stays unpaid and locked
  until a successful refresh. Refreshed PENDING and PAID responses remove the form,
  survive reload and never automatically replay the payment. A paid response from
  another tab displays that response's reference rather than the rejected local input.
- Existing browser cases also cover Thai/English receipts, server-returned amounts,
  Bangkok payment time, reload/list persistence, disabled submission while sending,
  uncertain network outcomes, keyboard focus and widths 320, 768 and 1440 pixels.
  All browser API traffic is intercepted. Screenshots of the desktop Thai form and
  mobile English receipt were inspected; long receipt references wrap within the panel.

## Verification

| Check                                                  | Result                                                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| API booking unit suites                                | 328 passed across 5 suites, including the 14 mock-payment service cases                     |
| API booking HTTP suites                                | 133 passed across 4 suites, including the 21 mock-payment cases                             |
| Web unit suite                                         | 305 passed across 29 files, including 31 booking API tests                                  |
| Mock-payment Playwright suite                          | 72 passed across desktop, tablet and mobile Chromium                                        |
| API script typecheck and API build                     | Passed                                                                                      |
| Web production build                                   | Passed                                                                                      |
| API and web lint                                       | Passed                                                                                      |
| Formatting of changed TypeScript files and this record | Passed                                                                                      |
| `git diff --check`                                     | Passed                                                                                      |
| Fresh disposable PostgreSQL migration and seed         | All 20 committed migrations and seed passed                                                 |
| Real HTTP/PostgreSQL booking verifier                  | Passed, including all seven negative payment checks and the existing payment rollback probe |

Run from the repository root:

```bash
pnpm --filter @hktutor/api test --runInBand bookings
pnpm --filter @hktutor/api test:e2e --runInBand bookings
pnpm --filter @hktutor/web test
pnpm --filter @hktutor/api typecheck:scripts
pnpm --filter @hktutor/api lint
pnpm --filter @hktutor/web lint
pnpm --filter @hktutor/api build
pnpm --filter @hktutor/web build
pnpm exec prettier --check apps/api/scripts/verify-booking-endpoint-concurrency.ts apps/api/src/modules/bookings/bookings.service.ts apps/api/src/modules/bookings/bookings.swagger.ts apps/api/test/bookings-mock-payment.e2e-spec.ts apps/api/test/unit/bookings/bookings-mock-payment.service.spec.ts apps/api/README.md apps/web/src/components/bookings/mock-payment-panel.tsx apps/web/test/booking-api.test.ts apps/web/e2e/student-mock-payment-ui.spec.ts tests/s2-t06-qa.md
git diff --check
```

The browser run used the current production build on an isolated port, 3106, because
3000 was already occupied. A temporary Playwright config preserved all three repository
projects and changed only the test/output paths, base URL and web-server port. To use
the normal repository port, start the freshly built web in a separate terminal and run:

```bash
pnpm --filter @hktutor/web start
pnpm --filter @hktutor/web exec playwright test e2e/student-mock-payment-ui.spec.ts
```

The database run used a newly initialized PostgreSQL 14.20 cluster under the OS temporary
directory, bound only to `127.0.0.1` on an automatically allocated port. Its new database
was `hktutor_s2_t06_56d9c45f`. All accounts, secrets and Storage configuration were
test-only values; no Storage or email request was needed. The cluster was stopped in
the runner's cleanup after verification. No shared/project database was selected.

To reproduce the database run, provision a **new disposable local database**, explicitly
set `DATABASE_URL` to it, supply test-only startup/seed configuration as in the CI
workflow, then run:

```bash
pnpm db:migrate:deploy
pnpm db:seed
HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 pnpm db:verify:bookings
```

The verifier retains its explicit opt-in, loopback-host and `hktutor-`/`hktutor_`
database-name checks. Migration and seed commands must never target a database whose
data needs retaining.

## Limits

The real database API checks and intercepted browser checks are separate layers; this
run does not claim a browser-to-live-backend integration test. Local PostgreSQL was
14.20, while the existing CI service uses PostgreSQL 17. The whole workspace check was
not run; the focused checks above cover the changed areas. No backlog cells, task
statuses or team assignments were changed. The pending-booking HTTP status now matches
the recorded US12-5 acceptance criterion.
