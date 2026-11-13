# S3-T12 — tutor report contract and fixture reconciliation

Prepared 2026-11-13 (Asia/Bangkok) from `main` at `a101733`. Sprint 3 Backlog row: _Document tutor
report contract and reconcile fixture totals against bookings_. Acceptance: define the finalized
denominator and rounding, exclude unpaid and canceled amounts, and make the Swagger example match
the source fixtures.

## Changes

- `apps/api/README.md` gains **Report contract definitions and fixture reconciliation (S3-T12)**:
  - a definition for every response field;
  - which status/payment combination counts as revenue, and why there is no refund case;
  - why the finalized denominator is `COMPLETED + CANCELED`;
  - the `HALF_UP` rounding rule with worked examples (75, 66.67, 33.33, and 3.125 → 3.13);
  - the `null` / N/A rule;
  - a booking-by-booking reconciliation of the 905.00 THB fixture.
- `reports.swagger.ts` publishes three named 200-response examples (`TUTOR_REPORT_EXAMPLES`). Each
  is the exact report for one S3-DB04 seeded tutor: `report905`, `reportExpired` and `reportEmpty`.
  The operation description now says that revenue uses the after-discount `netAmount` and that a
  PAID booking can never be CANCELED.
- `reports.dto.ts`: the `revenue.amount` description says `netAmount` is the snapshot after any
  coupon discount, summed with Prisma `Decimal`.

Runtime behavior, routes, guards, response shape, schema and fixtures are unchanged. Only
documentation strings and OpenAPI examples change.

## Reconciliation evidence

`apps/api/test/unit/reports/report-contract.spec.ts` builds the OpenAPI document from the real
`ReportsController` and checks the following.

| Check                     | What is proven                                                                                                                                                                                                                                                 |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Named examples ↔ fixtures | Each example key names a DB04 tutor. Its value equals `ReportsService.getTutorReport` run over that tutor's fixture bookings, grouped as PostgreSQL would group them. It also appears verbatim in the generated document                                       |
| Property examples         | The schema property examples of the four report DTOs add up to the `report905` report                                                                                                                                                                          |
| Documented rules          | The operation and DTO descriptions state `COMPLETED + CANCELED`, `HALF_UP`, null when finalized is 0, the excluded statuses, that a PAID booking can never be CANCELED, and that amounts are after discount. `percent` is nullable                             |
| Booking snapshots         | All 12 `report905` bookings satisfy subtotal − discount = net. Exactly one carries a discount: WELCOME10 (10%) on 450.00 gives 45.00 and net 405.00                                                                                                            |
| Totals                    | Revenue nets are `[405.00, 500.00]`, summing to 905.00; the subtotal for the same rows is 950.00. Excluded: unpaid completed 4 / 1800.00, canceled 2 / 900.00, pending 3 / 1350.00, confirmed 1 / 450.00. Ledger total is 5405.00; no canceled booking is paid |

To confirm the test can fail, the `report905` example was temporarily changed to `950.00`. Two
tests failed (the fixture comparison and the property-example comparison). The change was reverted.

The S3-T11 PostgreSQL runner (`pnpm db:verify:tutor-reports`, on its own branch) checks the same
905.00 / 950.00 / 5405.00 figures against seeded rows through the HTTP endpoint.

## Checks run

```bash
pnpm --filter @hktutor/api exec jest test/unit/reports test/unit/api-documentation
pnpm --filter @hktutor/api test
pnpm --filter @hktutor/api lint
pnpm --filter @hktutor/api build
pnpm format:check
pnpm verify:workspace
```

Results: report and documentation suites 3 / 27 passed; full API unit suite 100 suites /
1793 tests passed; API lint clean; API build and script typecheck passed; Prettier clean;
workspace contracts 138 / 138 passed.
