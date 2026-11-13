# S3-T39 — final Swagger, story-to-test traceability, QA evidence and handover

Prepared 2026-11-13 (Asia/Bangkok) from `main` at `a101733`. Sprint 3 Backlog row: _Complete final
Swagger, story-to-test traceability, QA evidence and handover documentation_. Acceptance: all 9
Sprint 3 stories mapped to acceptance tests, and the reminder-timing and rating-rounding wording
resolved.

**Merge order.** This record cites the verifiers added by S3-T11, S3-T12, S3-T37 and S3-T38
(`db:verify:tutor-reports`, `report-contract.spec.ts`, `db:verify:sprint3-flow`,
`db:verify:sprint3-security`). Each is on its own `feature/s3-…` branch. Merge them before this
branch, in backlog order, and all links resolve. The four branches and this one were trial-merged
onto `a101733` without conflicts.

## 1. Final Swagger contract

`GET /api/docs` is generated from the real `AppModule`. The S2-T39 contract test
(`apps/api/test/unit/api-documentation.spec.ts`) already requires the following of every mounted
route: summary, description, tag, a 2xx response (410 for retired routes), 401 when JWT-protected,
400/404 for path parameters, 400 for request bodies, and a description for every error. S3-T39
adds a **Sprint 3 final contract** block:

| Rule                                     | Why                                                                                                                                                                                                                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Exactly one lowercase kebab-case tag     | `@nestjs/swagger` auto-tags any controller without a class-level `@ApiTags`. Sprint 3 modules tagged methods only, so Swagger UI showed duplicate groups: `Coupons` + `Admin coupons`, `Review` / `TutorReviews` + `Reviews`, `Payments` twice, `OmiseWebhook`, `PublicTutorAvatars` |
| A response body for every 2xx except 204 | `POST /auth/consent` and the Omise webhook documented 200 without a schema                                                                                                                                                                                                           |
| US2-3, US7-1, US8-1, US8-2, US9-1, US9-2 | Each story's documented status codes (400/401/403/404/409 as the acceptance criteria require), and the specific `COUPON_EXPIRED`/`COUPON_EXHAUSTED`/`COUPON_ALREADY_USED` conflicts on payment                                                                                       |

Fixes in this change. All are documentation-only, with no runtime behavior change:

- Class-level tags via `ReviewsControllerDoc`, `PaymentsControllerDoc`, `CouponsControllerDoc` and
  `PublicTutorAvatarsControllerDoc`, with the duplicate method-level tags removed. The tags are
  now `reviews`, `payments`, `coupons`, `reports` and `avatars`, matching the existing
  `bookings`/`tutors`/… style.
- `POST /auth/consent` documents `{ consentAcceptedAt, policyVersion }`. The webhook documents
  `{ received: true }`.

Reverting the reviews/coupons tag change makes the new rule fail with the six duplicate tag
lists, so the rule does detect the original problem.

## 2. Story-to-test traceability (9 Sprint 3 stories)

Legend: **U** = API unit (Jest), **H** = API HTTP e2e (Jest/Supertest), **DB** = PostgreSQL verifier
(`pnpm db:verify:…`, disposable database), **W** = web unit (Vitest), **P** = Playwright,
**J** = final journey stage in `db:verify:sprint3-flow` (S3-T37), **S** = `db:verify:sprint3-security`
(S3-T38).

### US2-3 — real-time messages and read receipts (S3-T01…T04)

| Acceptance criterion                                                | Evidence                                                                                                                                     |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Other participant receives `message_created`/`messages_read` live   | H `conversations-socket.e2e-spec.ts`; U `conversation-events.spec.ts`; W `conversation-realtime.test.ts`; P `conversations-live.spec.ts`; J5 |
| Delivered only to the other participant, never echoed to the sender | H `conversations-socket.e2e-spec.ts`; J5; S6                                                                                                 |
| A socket in another room never receives the events                  | H `conversations-socket.e2e-spec.ts`; S6 (cross-room message)                                                                                |
| Reconnect re-joins the room                                         | W `conversation-realtime.test.ts`; P `conversations-live.spec.ts`; [S3-T04](s3-t04-qa.md)                                                    |
| Disconnected: REST history/polling still works, no duplicates       | W `conversation-realtime.test.ts`; [S3-T03 verification](../apps/web/e2e/chat-realtime-verification.md); [S3-T04](s3-t04-qa.md)              |
| Expired/invalid tokens, admins and non-participants refused         | H `conversations-socket.e2e-spec.ts`; J5; S1 (socket dropped on logout), S6                                                                  |

### US3-2 — class and payment reminders (S3-T05…T08)

| Acceptance criterion                                               | Evidence                                                                                                                              |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| 24h/1h windows on stored UTC; Asia/Bangkok boundaries              | U `reminder-policy.spec.ts`; DB `db:verify:reminders`; [S3-T08](s3-t08-qa.md)                                                         |
| Created once; repeat/late runs and existing `eventKey` create none | U `reminder-job.service.spec.ts`, `notification-events.reminders.spec.ts`; DB `db:verify:reminders`, `db:verify:sprint3-fixtures`; J7 |
| Paid: class reminder only, to student **and** tutor                | U `reminder-policy.spec.ts`; DB `db:verify:sprint3-fixtures`; J7                                                                      |
| Unpaid: payment reminder only, to the student                      | U `reminder-policy.spec.ts`; DB `db:verify:sprint3-fixtures`                                                                          |
| Canceled/pending/completed/expired: none                           | U `reminder-policy.spec.ts`; [S3-T08](s3-t08-qa.md)                                                                                   |
| Inbox shows reminder types with booking links                      | W `notifications.test.ts`; P `notification-inbox-ui.spec.ts`                                                                          |
| "Starts in 2 hours" example                                        | Resolved in §3.1                                                                                                                      |

### US7-1 — tutor report (S3-T09…T12)

| Acceptance criterion                                           | Evidence                                                                                                                                |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 12 / 6 / 2 / 3 / 1, revenue 405 + 500 = 905 THB, 6/(6+2) = 75% | U `reports.service.spec.ts`, `report-contract.spec.ts`; H `reports.e2e-spec.ts`; DB `db:verify:tutor-reports`; W `tutor-report.test.ts` |
| No finalized classes gives N/A                                 | U `reports.service.spec.ts`; DB `db:verify:tutor-reports`; W `tutor-report.test.ts` (EN `N/A`, TH `ไม่มีข้อมูล`)                        |
| Unpaid and canceled amounts excluded                           | U `report-contract.spec.ts` (4500.00 excluded); DB `db:verify:tutor-reports` (333.63 exclusions); J10                                   |
| Only the tutor's own report (role and ownership)               | H `reports.e2e-spec.ts`; DB `db:verify:tutor-reports`; J10; S4                                                                          |
| Report page and route guard                                    | P `tutor-report-ui.spec.ts`                                                                                                             |

### US8-1 — detailed review after a completed booking (S3-DB01, S3-T13…T16)

| Acceptance criterion                                                    | Evidence                                                                                                                         |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Completed owned booking, 5/4/5 + text, stored once                      | U `reviews.service.spec.ts`; H `reviews.e2e-spec.ts`; DB `db:verify:review-submissions`; J8                                      |
| Rating 0/6 → 400; 1–5 inclusive                                         | U `reviews.service.spec.ts`; DB `db:verify:review-submissions`; repository `tests/review-schema.test.mjs`                        |
| Feedback 1000 OK / 1001 → 400; whitespace-only → 400                    | DB `db:verify:review-submissions`; W `review-model.test.ts`                                                                      |
| Confirmed (not completed) → 409; another student → 403; duplicate → 409 | H `reviews.e2e-spec.ts`; DB `db:verify:review-submissions`, `db:verify:sprint3-concurrency`; J7, J8; S8 (4 concurrent → one 201) |
| Form labels/errors, submitted state, duplicate prevention               | W `submitted-review.test.ts`, `review-model.test.ts`; P `review-ui.spec.ts`; [review integration QA](review-integration-qa.md)   |
| Feedback rendered as text                                               | W `submitted-review.test.ts`; J8; S7; repository `tests/web-html-sinks.test.mjs`                                                 |

### US8-2 — average rating and review count (S3-T17…T20)

| Acceptance criterion                                    | Evidence                                                                                                                                       |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 5/4/5 + 4/4/4 → 4.33, count 2 (see §3.2)                | U `review-ratings.spec.ts`; DB `db:verify:review-ratings`, `db:verify:rating-regression`, `db:verify:sprint3-fixtures`; [S3-T17](s3-t17-qa.md) |
| Zero reviews → "New tutor", count 0, never 0.00         | W `tutor-rating.test.ts`; P `tutor-rating-ui.spec.ts`; [S3-T18](s3-t18-qa.md); J4 (`null`/0)                                                   |
| Fresh review updates detail, search and ranking         | DB `db:verify:search-ratings`, `db:verify:rating-regression`; J8 (4.67/1, ranks first)                                                         |
| `minimumRating` and `highest_rating` use the aggregates | DB `db:verify:search-ratings`; U `tutor-search-rating-verifier.spec.ts`                                                                        |

### US9-1 — admin percentage coupons (S3-DB02, S3-T21…T24)

| Acceptance criterion                                                              | Evidence                                                                                                       |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| WELCOME10 10%, future expiry, maxUses → active unique coupon                      | U `coupons.service.spec.ts`; H `coupons.e2e-spec.ts`; DB `db:verify:admin-coupons`; J2; [S3-T21](s3-t21-qa.md) |
| percent 1 and 100 valid; 0, -10 and 120 → 400; maxUses 0 → 400; past expiry → 400 | H `coupons.e2e-spec.ts`; U `coupons.service.spec.ts`; [S3-T24](s3-t24-qa.md)                                   |
| `welcome10` vs `WELCOME10` → 409                                                  | DB `db:verify:coupons`, `db:verify:admin-coupons`; J2                                                          |
| Non-admin → 403                                                                   | H `coupons.e2e-spec.ts`; J2; S4                                                                                |
| Admin UI: Bangkok input → UTC, errors, usage                                      | W `coupon-model.test.ts`, `coupon-api.test.ts`; P `admin-coupons-ui.spec.ts`; [S3-T22](s3-t22-qa.md)           |
| Swagger and audit                                                                 | U `coupons.swagger.spec.ts`; [S3-T23](s3-t23-qa.md)                                                            |

### US9-2 — coupon before payment (S3-DB03, S3-T25…T28)

| Acceptance criterion                                                | Evidence                                                                                                                             |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 450 with 10% → discount 45, net 405; one use consumed atomically    | U `booking-coupons.service.spec.ts`, `payments.service.spec.ts`; H `booking-coupons.e2e-spec.ts`; DB `db:verify:coupon-payments`; J6 |
| Expired / exhausted / already used by this student → specific error | H `booking-coupons.e2e-spec.ts`; DB `db:verify:coupon-payments`; J9 (`COUPON_ALREADY_USED`)                                          |
| Two students race for the last use → exactly one succeeds           | DB `db:verify:coupon-payments`, `db:verify:sprint3-concurrency`; [S3-T28](s3-t28-qa.md)                                              |
| Not applied twice to one booking                                    | DB `db:verify:coupon-payments`; [S3-T26](s3-t26-qa.md)                                                                               |
| Paid then canceled → use not refunded (paid cancellation rejected)  | DB `db:verify:coupon-payments`; [S3-T28](s3-t28-qa.md)                                                                               |
| Server-authoritative amounts in the checkout UI                     | W `booking-coupon.test.ts`; P `student-promptpay-payment-ui.spec.ts`; [S3-T27](s3-t27-qa.md)                                         |

### US10-1 — compare 2–3 tutors (S3-T29…T32)

| Acceptance criterion                                                    | Evidence                                                                                                                                            |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Six attributes aligned in matching rows                                 | W `tutor-comparison.test.ts`, `tutor-comparison-qa.test.ts`; P `tutor-comparison-ui.spec.ts`, `tutor-comparison-qa.spec.ts`; [S3-T30](s3-t30-qa.md) |
| Fewer than 2 or more than 3 → disabled with the 2–3 message             | W `tutor-comparison-qa.test.ts`; P `tutor-comparison-qa.spec.ts`                                                                                    |
| Reuses public search/profile data; no comparison table; no private data | W `tutor-comparison-view-model.test.ts`; DB `db:verify:comparison-visibility`; J4 (attributes + private-field scan); [S3-T31](s3-t31-qa.md)         |
| Missing values, Bangkok display, keyboard access                        | W `tutor-comparison-qa.test.ts`; P `tutor-comparison-qa.spec.ts`; [dock visibility QA](comparison-dock-visibility-qa.md)                            |

### US10-2 — sort the comparison (S3-T33…T36)

| Acceptance criterion                                       | Evidence                                                                                                                            |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 350 before 450 for `lowest_price`, selection kept          | W `tutor-comparison-sort.test.ts`, `tutor-comparison-sort-qa.test.ts`; P `tutor-comparison-sort-qa.spec.ts`; [S3-T33](s3-t33-qa.md) |
| Highest rating first; stable ties                          | W `tutor-comparison-sort-qa.test.ts`                                                                                                |
| Unknown sort rejected                                      | W `comparison-sort-query.test.ts`, `tutor-comparison-sort-qa.test.ts`                                                               |
| No future slot sorts last for earliest availability        | W `tutor-comparison-sort-qa.test.ts`; J4 (API `earliest_availability`)                                                              |
| Sort selector accessible; columns aligned on all viewports | P `tutor-comparison-responsive.spec.ts`; [S3-T34](s3-t34-qa.md)                                                                     |

## 3. Wording resolutions

The backlog sheet was not edited (the task says not to update it). The replacement wording below
matches the shipped behavior and the product decisions recorded on 2026-10-26.

### 3.1 Reminder timing (US3-2)

The sheet says: _"Given a confirmed unpaid b-501 starts in 2 hours. When the cron runs. Then only
the 1-hour reminder is created, not a 24-hour reminder."_ The approved S3-T05 rule sends a
**catch-up 24H reminder** when a class is first seen less than 24 hours ahead, then the 1H
reminder inside the last hour. A single run never selects both bands.

Proposed wording: _"Given a confirmed unpaid b-501 is first seen by the job 2 hours before start.
When the cron runs. Then one 24H payment reminder is created now, and the 1H payment reminder is
created once the class is within 1 hour; no run creates both."_

The bands are 24H for (1h, 24h] and 1H for (0, 1h], on stored UTC. Asia/Bangkok (UTC+7, no DST)
is used for display only. Class reminders require PAID and go to both participants; payment
reminders go to the student of a CONFIRMED UNPAID booking. Contract:
[S3-T05 section](../apps/api/README.md#class-and-payment-reminders-s3-t05).

### 3.2 Rating rounding (US8-2)

The sheet says: _"Given review overall means 4.67 and 4.00. When displayed. Then average=4.34."_ The
approved rule aggregates raw dimension totals and rounds once, HALF_UP, at display. So 5/4/5 and
4/4/4 give 26/6 = 4.333… and display **4.33**. The 4.34 only appears if each review's mean is
rounded first (4.67 and 4.00 average to 4.335).

Proposed wording: _"Given reviews 5/4/5 and 4/4/4 (means 4.67 and 4.00). When displayed. Then
average=4.33 and reviewCount=2."_ The `minimumRating` filter compares exactly, so 4.333… passes
4.33 and fails 4.34. Contract:
[S3-T20 section](../apps/api/README.md#tutor-rating-regression-s3-t20).

## 4. QA evidence index

| Task(s)   | Record                                                                                                                                                                                                                                    |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DB01–DB06 | [DB01](s3-db01-qa.md), [DB02](s3-db02-qa.md), [DB03](s3-db03-qa.md), [DB04](s3-db04-qa.md), [DB05](s3-db05-qa.md), [DB06](s3-db06-qa.md)                                                                                                  |
| T01–T08   | [S3-T03 verification](../apps/web/e2e/chat-realtime-verification.md), [S3-T04](s3-t04-qa.md), [S3-T08](s3-t08-qa.md)                                                                                                                      |
| T09–T12   | [S3-T11](s3-t11-qa.md), [S3-T12](s3-t12-qa.md)                                                                                                                                                                                            |
| T13–T20   | [review integration](review-integration-qa.md), [S3-T17](s3-t17-qa.md), [S3-T18](s3-t18-qa.md); S3-T15/T19/T20 in the [API README](../apps/api/README.md#tutor-rating-regression-s3-t20)                                                  |
| T21–T28   | [S3-T21](s3-t21-qa.md), [S3-T22](s3-t22-qa.md), [S3-T23](s3-t23-qa.md), [S3-T24](s3-t24-qa.md), [S3-T26](s3-t26-qa.md), [S3-T27](s3-t27-qa.md), [S3-T28](s3-t28-qa.md)                                                                    |
| T29–T36   | [S3-T30](s3-t30-qa.md), [S3-T31](s3-t31-qa.md), [S3-T33](s3-t33-qa.md), [S3-T34](s3-t34-qa.md), [dock visibility](comparison-dock-visibility-qa.md); S3-T32/T35/T36 in the [API README](../apps/api/README.md#tutor-comparison-qa-s3-t32) |
| T37–T40   | [S3-T37](s3-t37-qa.md), [S3-T38](s3-t38-qa.md), this record, [S3-T40](s3-t40-qa.md)                                                                                                                                                       |

## 5. Handover

### Where Sprint 3 lives

| Feature              | API (`apps/api/src/modules`)                                 | Web (`apps/web/src`)                                       |
| -------------------- | ------------------------------------------------------------ | ---------------------------------------------------------- |
| Real-time chat       | `conversations/` (gateway, socket contract)                  | `lib/conversation-realtime.ts`, `components/conversations` |
| Reminders            | `notifications/` (`reminder-policy`, `reminder-job.service`) | `components/notifications`                                 |
| Tutor report         | `reports/`                                                   | `components/reports`, `app/dashboard/reports`              |
| Reviews and ratings  | `reviews/`, `tutors/` (aggregates, ranking)                  | `components/reviews`, `components/tutors`                  |
| Coupons and payments | `coupons/`, `bookings/` (coupon routes), `payments/`         | `components/coupons`, `components/bookings`                |
| Comparison           | `tutors/` (public data only)                                 | `components/tutors/tutor-comparison-*`                     |

### Running the checks

`pnpm check` runs format, lint, unit tests and builds without a database. The Sprint 3 PostgreSQL
verifiers each need their own migrated, empty, loopback `hktutor_*_test` database and
`HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1`. They never read `.env`.

| Command                              | Database name             |
| ------------------------------------ | ------------------------- |
| `pnpm db:verify:sprint3-fixtures`    | any `hktutor_*_test`      |
| `pnpm db:verify:sprint3-concurrency` | see [DB05](s3-db05-qa.md) |
| `pnpm db:verify:sprint3-final`       | `hktutor_s3_db06_test`    |
| `pnpm db:verify:coupon-payments`     | any `hktutor_*_test`      |
| `pnpm db:verify:tutor-reports`       | `hktutor_s3_t11_test`     |
| `pnpm db:verify:sprint3-flow`        | `hktutor_s3_t37_test`     |
| `pnpm db:verify:sprint3-security`    | `hktutor_s3_t38_test`     |

### Known issues and follow-ups

1. **`db:verify:sprint2-flow` (S2-T38) is stale.** It stops at the retired mock-payment step (410).
   `db:verify:sprint3-flow` covers that flow with PromptPay. Update or retire the S2 runner.
2. **Consent on booking reads.** `GET /bookings/me/:bookingId` and `GET /bookings/tutor` do not
   require current consent, while Sprint 3 writes do (S3-T38 finding). This is a product decision.
3. **Consent status codes differ.** Guard routes return 403; profile and reschedule services
   return 400 `PRIVACY_CONSENT_REQUIRED`.
4. **Open PR `fix/booking-payment-deadline`** (4h payment deadline, 5h reminders) changes US3-2
   timing. If it merges, update §3.1, the S3-T05 table and `db:verify:sprint3-flow` stage 7.
5. **Backlog sheet wording.** The two proposed replacements in §3 are not yet copied into the
   Product Backlog.

## 6. Checks run for this change

```bash
pnpm --filter @hktutor/api exec jest test/unit/api-documentation test/unit/reviews test/unit/payments test/unit/coupons test/unit/avatars test/unit/auth
pnpm --filter @hktutor/api test
pnpm --filter @hktutor/api lint
pnpm --filter @hktutor/api build
pnpm format:check
pnpm verify:workspace
```

Results: documentation plus affected-module suites 321 passed (18 documentation rules); full API
unit suite 99 suites / 1794 tests passed; API and web lint clean; API build and script typecheck
passed; Prettier clean; workspace contracts 138 / 138 passed.
