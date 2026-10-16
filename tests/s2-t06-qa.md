# S2-T06 mock-payment QA

Recorded on 2026-10-16 against `main` at `fecf5ac` plus this QA change, using Node.js
24.19.0 and pnpm 11.19.0. S2-T04 and S2-T05 are the prerequisites for this task.
This change adds verification and does not change the payment API or UI behavior.

## Results and acceptance discrepancy

The payment regressions pass against the current API contract. The Product Backlog
US12-5 negative criterion for a **PENDING** booking says **400**, while the implemented
and documented API returns **409 BOOKING_NOT_PAYABLE**. This is a known acceptance
discrepancy, not a passed 400 criterion. The new database check explicitly records the
observed 409 behavior. S2-T06 should not be signed off against that criterion until the
API or the acceptance criterion is aligned through the normal project review.

The other requested cases behave as follows:

| Case                                                 | Observed HTTP result                           | Persisted-state evidence                                                                  |
| ---------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Amount differs from the stored net amount            | 400 `BOOKING_PAYMENT_AMOUNT_MISMATCH`          | Complete fixture booking snapshots unchanged                                              |
| Another authenticated student pays the booking       | 403 `BOOKING_NOT_OWNED`                        | Complete fixture booking snapshots unchanged                                              |
| PENDING booking                                      | 409 `BOOKING_NOT_PAYABLE`; backlog expects 400 | Complete fixture booking snapshots unchanged                                              |
| Already PAID booking, submitted with a new reference | 409 `BOOKING_ALREADY_PAID`                     | Original reference, timestamp, payment status and all other booking fields unchanged      |
| Empty or whitespace-only reference                   | 400 `VALIDATION_FAILED`                        | Complete fixture booking snapshots unchanged                                              |
| Reference already used on a different booking        | 409 `MOCK_REFERENCE_TAKEN`                     | Both the original PAID booking and the rejected UNPAID booking unchanged                  |
| Valid CONFIRMED + UNPAID booking                     | 200                                            | Response amount, reference, UTC timestamp and PAID status match PostgreSQL                |
| Injected failure after the payment write             | 500                                            | Existing rollback probe proves CONFIRMED/UNPAID with null payment timestamp and reference |

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
| API mock-payment service unit suite                    | 14 passed                                                                                   |
| API mock-payment HTTP suite                            | 20 passed                                                                                   |
| Web unit suite                                         | 303 passed across 29 files, including 29 booking API tests                                  |
| Mock-payment Playwright suite                          | 66 passed across desktop, tablet and mobile Chromium                                        |
| API script typecheck and API build                     | Passed                                                                                      |
| Web production build                                   | Passed                                                                                      |
| API and web lint                                       | Passed                                                                                      |
| Formatting of changed TypeScript files and this record | Passed                                                                                      |
| `git diff --check`                                     | Passed                                                                                      |
| Fresh disposable PostgreSQL migration and seed         | All 20 committed migrations and seed passed                                                 |
| Real HTTP/PostgreSQL booking verifier                  | Passed, including all seven negative payment checks and the existing payment rollback probe |

Run from the repository root:

```bash
pnpm --filter @hktutor/api test --runInBand bookings-mock-payment
pnpm --filter @hktutor/api test:e2e --runInBand bookings-mock-payment
pnpm --filter @hktutor/web test
pnpm --filter @hktutor/api typecheck:scripts
pnpm --filter @hktutor/api lint
pnpm --filter @hktutor/web lint
pnpm --filter @hktutor/api build
pnpm --filter @hktutor/web build
pnpm exec prettier --check apps/api/scripts/verify-booking-endpoint-concurrency.ts apps/api/test/bookings-mock-payment.e2e-spec.ts apps/web/e2e/student-mock-payment-ui.spec.ts tests/s2-t06-qa.md
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
was `hktutor_s2_t06_df8ab25e`. All accounts, secrets and Storage configuration were
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
statuses or team assignments were changed. The pending-booking HTTP status discrepancy
remains open for acceptance review.
