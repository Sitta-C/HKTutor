# S3-T27 — student coupon checkout

Verified 2026-11-13. The selected design is **Receipt Strip**, above the amount breakdown in the
existing student booking Payment Slip. The current application uses PromptPay Test Mode; the
backlog's historical mock-payment wording does not reinstate the removed endpoint or form.

## Implemented behavior

- Only confirmed, unpaid owned bookings expose coupon editing. Stored coupon evidence remains
  readable after payment. Existing authenticated student endpoints retain server-side ownership.
- The code input trims and normalizes ASCII lowercase, validates 3–32 letters/digits/underscores/
  hyphens, and uses `PUT /bookings/me/:bookingId/coupon` with `{ code }` only. Removal uses `DELETE`
  with no body. Both paths encode the booking ID and use the existing authenticated API client.
- Apply/remove responses update the stored subtotal, discount, net THB and coupon snapshot; the UI
  does no monetary arithmetic. A follow-up current-payment + booking read must succeed before
  another payment or coupon change. If that read fails, the mutation's confirmed amounts remain.
- One synchronous request gate prevents overlap between coupon writes, payment creation and status
  reads. Coupon writes also participate in the existing cancellation/reschedule busy lock. Old
  reads abort when superseded; unmounted payment panels ignore mutation results.
- Explicit coupon not-found/inactive/expired/exhausted/previous-use and unsupported-amount
  rejections show specific Thai/English messages without changing amounts. Booking/ownership/state
  conflicts and uncertain failures lock checkout until a successful status read. Mutations never
  automatically retry network failures. An active or uncertain payment attempt locks coupon edits.
- A server-returned 100% coupon with net `0.00` offers confirmation through the existing PromptPay
  POST, with no client amount/code payload. Its returned paid receipt can have `attempt: null`.
  The UI neither manufactures a QR nor claims payment succeeded before the API responds.
- The field retains its label/error association, validation focus and keyboard submission. Removing
  a coupon returns focus to the input only after that removal and its status reconciliation succeed.
  A failed read cancels focus restoration; later refreshes and remote removals do not take focus.
  Container queries
  stack the payment below the amount column at a paper width of 600px or less.

## Verification

- `pnpm --filter @hktutor/web test`: all 812 tests passed, including abort propagation, payment-error
  fallback, contextual coupon recovery and stale submission-owner protection.
  The focused `booking-api`/`booking-coupon` run also passed all 73 tests.
- `pnpm --filter @hktutor/web exec tsc --noEmit`: passed.
- `pnpm --filter @hktutor/web lint`: passed.
- Prettier checks for changed files: passed.
- `pnpm --filter @hktutor/web build`: passed, including production TypeScript and route generation.
- `pnpm verify:workspace`: all 138 contracts passed. The booking-client source contract now
  recognizes the optional abort signal, covered by an API-client cancellation assertion.
- `pnpm --filter @hktutor/web exec playwright test e2e/student-promptpay-payment-ui.spec.ts
--workers=2`: all 99 cases passed across Chromium desktop, tablet and mobile. Coverage includes
  original PromptPay success/failure/reload, apply/remove persistence, specific errors, invalid
  Unicode input, submit locks, lost-response recovery, a failed read after successful application,
  forbidden/missing/conflicting bookings, zero settlement, failed removal and ineligible statuses.
- Review regressions cover initial loading without repair instructions, payment 400/unknown 409
  fallback, Thai/English coupon rejection retained after refresh, booking/attempt pending evidence
  with a false payment flag, focus after failed/remote removal or moving to another action,
  recorded coupon history, and a
  booking read that waits for payment reconciliation. The pending fixture waits for the initial
  snapshot to render before changing server state, so it actually exercises the next polling cycle.
- A further six Receipt Strip cases passed after adding screenshots. Thai/English applied-coupon
  screenshots were inspected at desktop and mobile widths; the bilingual flow also asserts no
  horizontal overflow at 320px. Selected review screenshots are retained below.

## Screenshots

The screenshots show the implemented frontend with intercepted API fixtures (450.00 THB subtotal,
WELCOME10 at 10%, 45.00 THB discount and 405.00 THB net). They contain no real student/payment data.

- [Desktop — Thai](../ui-design/review-evidence/s3-t27/receipt-strip-desktop-th.png)
- [Mobile — Thai](../ui-design/review-evidence/s3-t27/receipt-strip-mobile-th.png)
- [Desktop — English](../ui-design/review-evidence/s3-t27/receipt-strip-desktop-en.png)
- [Mobile — English](../ui-design/review-evidence/s3-t27/receipt-strip-mobile-en.png)

## Review follow-up

The review's functional and UX concerns are addressed by separating shared state into
`use-booking-checkout` and layout into `StudentBookingCheckout`. Coupon writes and payment creation
share one eligibility decision and a synchronous request gate. Parent submission state is token
owned: cleanup releases the current request, and late completions cannot unlock a new request.

Payment failures only reuse the explicitly recognized coupon rejection messages; other failures
use payment-specific recovery. Apply failures never instruct removal of an unattached coupon.
Payment-time coupon failures survive a successful refresh while the same coupon remains applied,
unlock removal and keep payment blocked until the coupon is corrected. Initial verification is a
loading state, and unpaid ineligible history says the discount was recorded.

The parallel-read suggestion is intentionally not applied: `PaymentsService.getStatus()` can call
`applyCharge()` and persist a terminal payment before returning. `readCheckout()` therefore awaits
current status before reading the booking. The browser regression holds reconciliation and verifies
that the resulting booking/receipt use the settled state.

## Limits

Browser requests are intercepted with deterministic responses. They verify the real frontend and
wire payloads, not live coupon transactions or an Omise account/webhook. No database was migrated,
seeded or reset, and no payment provider or live tracker was changed. API/database coupon arithmetic
and capacity races belong to the existing T25/T26 and T28 verification scopes.

The extra historical booking/cancellation/reschedule browser suites still contain references to
`Mock payment`, `Record mock payment` and `Load latest status`. The pre-change payment panel already
rendered PromptPay instead. These obsolete test expectations are separate from the current
PromptPay suite above; their failure is not evidence of a newly introduced mock-payment regression.

The additional Chromium regression run of `student-bookings-ui.spec.ts`,
`booking-cancellation-ui.spec.ts` and `booking-reschedule-ui.spec.ts` finished with 92 passed and
11 failed. All 11 failures target those removed mock-payment names/controls: five business-status
checks, three cancellation/payment checks and three reschedule/payment checks. The general list,
detail, authorization, cancellation and rescheduling scenarios passed. These historical tests were
not rewritten as part of the coupon UI change.
