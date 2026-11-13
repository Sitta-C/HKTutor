# S3-T37 — final Sprint 3 journey integration

Verified 2026-11-13 (Asia/Bangkok) from `main` at `a101733`. Sprint 3 Backlog row: _Integrate
final discovery/comparison → chat → discounted payment → class → review/report journey_.
Acceptance: the student/tutor/admin demo uses persisted data, and the regression includes
cancellation/reschedule and the existing booking flow.

This task adds a verifier, a unit spec and documentation. No production code, schema, DTO or
fixture changes.

## Runner

`apps/api/scripts/verify-sprint3-integration.ts` (`pnpm db:verify:sprint3-flow`) boots the real
`AppModule` as `main.ts` does (`rawBody: true`, `cookie-parser`, `configureApplication`). It
listens on a loopback port so Socket.IO clients connect over real WebSockets. Every guard, pipe,
service, transaction, trigger and constraint is the production one. Three outer boundaries are
replaced:

| Boundary            | Replacement                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| Resend email        | Verification tokens captured in memory                                                                 |
| Supabase Storage    | In-memory private bucket (qualification PDFs)                                                          |
| Outbound Omise HTTP | In-process test-mode charge store on `https://api.omise.co`; **any other outbound host fails the run** |

The Omise webhook is posted with a real HMAC over the raw body, using a random per-run Base64
secret.

## Journey and assertions

| #   | Stage                               | What is proven                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Accounts                            | Two tutors and one student register, verify email and onboard over HTTP; the admin signs in                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2   | Promotion (US9-1)                   | Admin creates a lowercase code, stored normalized upper-case, 10%, 5 uses. The student gets 403; the same code in another case gets 409                                                                                                                                                                                                                                                                                                                                                                                                |
| 3   | Supply                              | Both tutors upload a degree PDF, the admin approves it, and the listing publishes (450 and 350 THB) with open slots                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 4   | Discovery and comparison (US10-1/2) | Anonymous search returns both tutors with the six comparison attributes (price, subject, rating `null` / count 0, experience 8 and 3, next availability equal to the first slot). `lowest_price` and `earliest_availability` put the 350 THB tutor first. Search, public detail, availability and reviews contain no email, phone, name, school, consent or meeting URL                                                                                                                                                                |
| 5   | Real-time chat (US2-3)              | Both participants join their rooms. A REST message reaches the tutor socket as `message_created`, and marking it read reaches the student as `messages_read`. The other tutor cannot join and receives nothing, the sender gets no echo, the admin cannot post (403), and the admin socket is refused at connect                                                                                                                                                                                                                       |
| 6   | Discounted payment (US9-2)          | Paying a pending booking gives 409. After confirmation, the coupon quote with the lowercase code gives 450.00 / 45.00 / 405.00. Apply; a tutor cannot pay (403). One 40,500-satang charge; resuming creates no second charge; coupon removal during the active payment gives 409. A webhook with a forged signature changes nothing; the signed webhook settles PAID with the charge reference and coupon snapshot. A paid retry makes no new charge, the retired mock-payment route returns 410, and the admin list shows 1 of 5 used |
| 7   | Reminders and class (US3-2)         | `ReminderJobService.runOnce` one hour before the class gives exactly one `CLASS_REMINDER_1H` to each party, and a rerun creates none. Meeting link; attendance before the end gives 409, a review before completion gives 409, and attendance after the end gives COMPLETED                                                                                                                                                                                                                                                            |
| 8   | Review (US8-1/2)                    | Before submitting, the student's review is `null`. A 5/4/5 review gives a public rating of 4.67 from 1 review, and the tutor ranks first by `highest_rating`. A second review gives 409. Feedback containing `<b>` and `&` comes back trimmed and unchanged as text                                                                                                                                                                                                                                                                    |
| 9   | Regression                          | The same student reusing the consumed coupon gets 409 `COUPON_ALREADY_USED`. Cancellation releases the slot and notifies the tutor. The slot is rebooked and the tutor rejects it, releasing the slot again. Reschedule: duplicate pending gives 409, reject keeps the booking, approve swaps slots. Coupon uses stay at 1                                                                                                                                                                                                             |
| 10  | Report (US7-1)                      | Tutor A: 4 bookings (COMPLETED 1, CANCELED 2, CONFIRMED 1), revenue `405.00` THB (discounted net), rate 1/3 = 33.33. Tutor B: empty, `percent: null`. Student and admin get 403; `?tutorId=` gets 400                                                                                                                                                                                                                                                                                                                                  |
| 11  | Invariants                          | Every recipient's notification event keys are unique, and read-all clears the inbox. The persisted ledger is [COMPLETED/PAID/405.00, CANCELED/UNPAID/450.00 ×2, CONFIRMED/UNPAID/450.00]. One coupon use, one review, one provider charge                                                                                                                                                                                                                                                                                              |

## Commands and result

Run against a throwaway local PostgreSQL 18.3 cluster on `127.0.0.1:55432`. It was not shared or
production, and it was deleted afterwards.

```bash
psql 'postgresql://postgres@127.0.0.1:55432/postgres' -c 'CREATE DATABASE hktutor_s3_t37_test'
DATABASE_URL='postgresql://postgres@127.0.0.1:55432/hktutor_s3_t37_test' pnpm db:migrate:deploy
HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 \
  DATABASE_URL='postgresql://postgres@127.0.0.1:55432/hktutor_s3_t37_test' \
  pnpm db:verify:sprint3-flow
```

```text
PASS [AppModule over HTTP/Socket.IO + PostgreSQL] two tutors and a student register, verify email and onboard; admin signs in
PASS [AppModule over HTTP/Socket.IO + PostgreSQL] admin creates S3T37<run> (10%, 5 uses); student is refused; case-insensitive duplicate 409
PASS [AppModule over HTTP/Socket.IO + PostgreSQL] both tutors pass admin document approval and publish listings with open slots
PASS [AppModule over HTTP/Socket.IO + PostgreSQL] discovery returns both tutors with price, subject, rating null/count 0, experience and next slot; sorts and hides private data
PASS [AppModule over HTTP/Socket.IO + PostgreSQL] chat: tutor receives message_created live, student receives messages_read; outsider, echo and admin socket refused
PASS [AppModule over HTTP/Socket.IO + PostgreSQL] confirmed booking: coupon 450.00 → 45.00 → 405.00; one 40500-satang charge; forged webhook ignored; signed success PAID; admin sees 1 of 5 used
PASS [AppModule over HTTP/Socket.IO + PostgreSQL] paid class gets one 1H reminder per party (idempotent rerun); link; attended → COMPLETED
PASS [AppModule over HTTP/Socket.IO + PostgreSQL] review 5/4/5 → public 4.67 from 1 review, ranks first by rating; duplicate 409; text preserved
PASS [AppModule over HTTP/Socket.IO + PostgreSQL] coupon reuse by the same student 409; cancel releases the slot and notifies; rebook+reject; reschedule duplicate 409, reject, approve swaps slots
PASS [AppModule over HTTP/Socket.IO + PostgreSQL] tutor A report: 4 bookings (1 completed, 2 canceled, 1 confirmed), discounted 405.00 THB, 1/3 = 33.33%; tutor B empty; others refused
PASS [AppModule over HTTP/Socket.IO + PostgreSQL] final state: one paid charge, one coupon use, one review; unique unread-free inboxes
S3-T37 Sprint 3 journey verification: 11 checks passed (run <random>).
```

`apps/api/test/unit/database/sprint3-integration-verifier.spec.ts` covers the target gate, that
provider settings are synthetic test-mode values with a fresh JWT secret per run, and the
private-field scan.

## Findings and limitations

- **The S2-T38 runner is stale.** `pnpm db:verify:sprint2-flow` on the same fresh-database setup
  now stops at its fifth stage. It expects `POST /bookings/me/:id/mock-payment` to return 400 for
  a pending booking, but the PromptPay change returns 410 for every mock-payment call. This
  runner covers the same flow, plus its Sprint 3 extensions, with PromptPay. The S2 runner was not
  changed here.
- **Open PR to check against.** `fix/booking-payment-deadline` (OPEN on `main`, by another team
  member) changes the payment deadline to 4h and reminders to 5h. If it merges, stage 7's
  `CLASS_REMINDER_1H` expectation may need updating to the new reminder bands.
- The runner proves the API contract that the web comparison, chat, checkout, review and report
  screens consume. It does not drive a browser: those screens are covered by the existing
  Playwright suites (S3-T03, T27, T36, T10 and others), which mock the API.
- External providers are stubbed at the HTTP boundary only. No real email is sent, no file is
  stored and no money moves.
