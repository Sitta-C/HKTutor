# S3-T38 — final authentication, privacy, authorization and cross-feature regression

Verified 2026-11-13 (Asia/Bangkok) from `main` at `a101733`. Sprint 3 Backlog row: _Run final
authentication, privacy, authorization and cross-feature regression suite_. Acceptance: JWT
refresh/reuse, email verification, current consent, ownership, socket isolation, XSS and
race-sensitive writes.

This task adds a verifier, its unit spec, a repository contract and documentation. No production
code, schema or DTO changes. Two findings are recorded below for the team to decide on.

## Suite

| Layer               | Command                                                                           | Scope                                                                                    |
| ------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| API + PostgreSQL    | `pnpm db:verify:sprint3-security` (`apps/api/scripts/verify-sprint3-security.ts`) | Real `AppModule` over HTTP and Socket.IO; outbound network rejected; no payment provider |
| API unit            | `apps/api/test/unit/auth/security-regression-verifier.spec.ts`                    | Database gate, synthetic environment, refresh-cookie parser                              |
| Repository contract | `tests/web-html-sinks.test.mjs` (part of `pnpm verify:workspace`)                 | No raw-HTML or dynamic-code sink anywhere in `apps/web/src`                              |

Existing focused suites remain the source of depth. They are not duplicated here: S3-T04 (chat
sockets), S3-T15 and S3-DB05 (review and coupon races), S3-T24 (admin coupons), S3-T28
(final-use coupon race), and S2-T31, S2-T34 and S2-T37 (notification, meeting-link and
attendance access).

## Acceptance coverage

| Area                  | Assertions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JWT refresh / reuse   | Cookie is `HttpOnly`, `Path=/`, `SameSite=Lax`; no `refreshToken` in any body. The DB stores the SHA-256 only, and the raw value is absent from the session row. Rotation issues a new cookie. Replaying the old one gives 401 and revokes the session, so the new cookie and its access token also give 401. Of 5 concurrent refreshes, exactly one gets 200. Logout gives 204, clears the cookie, makes the access token 401, and the live socket of that session receives `disconnect`. Refresh-as-Bearer and access-as-cookie both give 401                                                                                                                                 |
| Email verification    | An unverified login gets 403 with no cookie. A reused token gets 400. An expired token gets 400 and the user stays unverified. Resend is sent the way the browser sends it: a ready signed verification-flow cookie plus its `flowId`, minted by the real `EmailFlowService` with its clock moved past the 60-second wait. Known and unknown emails both get 200 with the same status, fields, generic message, purpose and cooldown. Only the eligible account receives a replacement email, which supersedes the old token and verifies. Mutations that change the unknown-account message, or stop delivery, make the runner fail The 6th login attempt in a minute gets 429 |
| Current consent       | Outdated `policyVersion` (student) or missing consent (tutor): coupon apply, payment create, chat send, chat read, review create and tutor report return 403 `Accept the current privacy notice to continue.` Profile read and reschedule create return 400 `PRIVACY_CONSENT_REQUIRED` with their own messages. `/auth/consent` rejects an old version (400) and accepts the current one, which restores access. `/auth/me` stays 200 throughout                                                                                                                                                                                                                                |
| Ownership / roles     | 25 routes, each called anonymously (401) and by a foreign owner or wrong role (403). A `studentUserId` mass-assignment attempt gets 400. Booking-table hash, notification `readAt`, message count and coupon count are unchanged afterwards                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Socket isolation      | Refused: expired session, refresh token, admin, malformed token. A non-participant join is refused. A message in conversation A reaches only A's other participant: no sender echo, nothing to conversation B's participants                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| XSS / stored markup   | `<script>…</script><img onerror>` in chat, tutor display name and bio is returned verbatim as JSON text (`Content-Type: application/json`). The web contract finds no `dangerouslySetInnerHTML`/`innerHTML`/`insertAdjacentHTML`/`document.write`/`eval`/`new Function`/`javascript:` sink, and the existing `submitted-review` test checks React escaping                                                                                                                                                                                                                                                                                                                      |
| Privacy of payloads   | The public tutor payload has no `firstName`/`lastName`/`school`/`phone`/`email`. `/auth/me` returns only `id`, `email`, `role`. A student's `/profiles/me` never contains another student's data                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Race-sensitive writes | 4 concurrent bookings of one slot give one 201 and three 409, with one active booking. 3 concurrent confirms give one 200 and one `BOOKING_CONFIRMED` notice. 4 concurrent reviews give one 201, one row, and a cached `reviewCount` of 1                                                                                                                                                                                                                                                                                                                                                                                                                                       |

## Run

Run against a throwaway local PostgreSQL 18.3 cluster on `127.0.0.1:55432`. It was not shared or
production, and it was deleted afterwards.

```bash
psql 'postgresql://postgres@127.0.0.1:55432/postgres' -c 'CREATE DATABASE hktutor_s3_t38_test'
DATABASE_URL='postgresql://postgres@127.0.0.1:55432/hktutor_s3_t38_test' pnpm db:migrate:deploy
HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 \
  DATABASE_URL='postgresql://postgres@127.0.0.1:55432/hktutor_s3_t38_test' \
  pnpm db:verify:sprint3-security
```

```text
PASS [AppModule over HTTP/Socket.IO + PostgreSQL] refresh cookie HttpOnly/Path=/ /SameSite=Lax, only its SHA-256 stored; rotation; replay revokes the whole session and its access token
PASS [AppModule over HTTP/Socket.IO + PostgreSQL] 5 concurrent refreshes: exactly one 200; logout clears the cookie, kills access and disconnects the live socket
PASS [AppModule over HTTP/Socket.IO + PostgreSQL] unverified login 403 without a cookie; reused and expired verification tokens 400; signed-flow resend answers known and unknown alike and only the eligible account gets a working replacement; 6th login in a minute 429
PASS [AppModule over HTTP/Socket.IO + PostgreSQL] fixture: 2 students, 2 verified tutors with listings/slots, 1 admin; s1 books t1 and opens a chat
PASS [AppModule over HTTP/Socket.IO + PostgreSQL] 25 protected routes: anonymous 401, foreign owner or wrong role 403/404; body identity injection 400; no state changed
PASS [AppModule over HTTP/Socket.IO + PostgreSQL] outdated or missing consent refused on 8 gated routes (coupon, payment, chat send/read, review, profile, reschedule, report) until /auth/consent accepts the current version
PASS [AppModule over HTTP/Socket.IO + PostgreSQL] socket: expired, refresh-as-access, admin and malformed tokens refused; non-participant join refused; no cross-room leakage
PASS [AppModule over HTTP/Socket.IO + PostgreSQL] markup in chat, display name and bio round-trips as exact JSON text; public and /auth/me payloads stay minimal
PASS [AppModule over HTTP/Socket.IO + PostgreSQL] 4 concurrent bookings of one slot: one 201; 3 concurrent confirms: one 200 and one notice; 4 concurrent reviews: one 201 and count 1
Authorization matrix and findings:
  GET booking: anonymous 401, foreign/wrong role 403 BOOKING_NOT_OWNED
  POST coupon-quote: anonymous 401, foreign/wrong role 403 BOOKING_NOT_OWNED
  PUT coupon: anonymous 401, foreign/wrong role 403 BOOKING_NOT_OWNED
  POST payment: anonymous 401, foreign/wrong role 403 BOOKING_NOT_OWNED
  GET payment: anonymous 401, foreign/wrong role 403 BOOKING_NOT_OWNED
  POST review: anonymous 401, foreign/wrong role 403 BOOKING_NOT_OWNED
  GET review: anonymous 401, foreign/wrong role 403 BOOKING_NOT_OWNED
  POST cancel: anonymous 401, foreign/wrong role 403 BOOKING_NOT_OWNED
  GET class-details: anonymous 401, foreign/wrong role 403 BOOKING_NOT_OWNED
  POST reschedule: anonymous 401, foreign/wrong role 403 BOOKING_NOT_PARTICIPANT
  POST confirm: anonymous 401, foreign/wrong role 403 BOOKING_NOT_OWNED
  POST reject: anonymous 401, foreign/wrong role 403 BOOKING_NOT_OWNED
  PUT meeting-link: anonymous 401, foreign/wrong role 403 BOOKING_NOT_OWNED
  PUT attendance: anonymous 401, foreign/wrong role 403 BOOKING_NOT_OWNED
  POST confirm as student: anonymous 401, foreign/wrong role 403 FORBIDDEN
  GET messages: anonymous 401, foreign/wrong role 403 FORBIDDEN
  POST message: anonymous 401, foreign/wrong role 403 FORBIDDEN
  POST read: anonymous 401, foreign/wrong role 403 FORBIDDEN
  PATCH notification: anonymous 401, foreign/wrong role 403 FORBIDDEN
  GET tutor report: anonymous 401, foreign/wrong role 403 FORBIDDEN
  GET admin coupons: anonymous 401, foreign/wrong role 403 FORBIDDEN
  POST admin coupon: anonymous 401, foreign/wrong role 403 FORBIDDEN
  GET admin verifications: anonymous 401, foreign/wrong role 403 FORBIDDEN
  POST listing as student: anonymous 401, foreign/wrong role 403 FORBIDDEN
  POST booking as admin: anonymous 401, foreign/wrong role 403 FORBIDDEN
  FINDING consent not required: GET /bookings/me/:bookingId → 200
  FINDING consent not required: GET /bookings/tutor → 200
S3-T38 security regression: 9 checks passed.
```

## Findings (not changed by this task)

1. **Booking reads do not require current consent.** `GET /bookings/me/:bookingId` and
   `GET /bookings/tutor` return 200 for a user whose consent is outdated or missing. Sprint 3
   booking writes (coupon, payment, review) and chat writes use `@RequireCurrentConsent()`, but
   the Sprint 1–2 booking controller routes never opted in. Booking creation was not probed, to
   keep the race fixtures intact. The web client prompts for re-consent; whether the API should
   also refuse these reads is a product decision for the booking owners.
2. **Consent refusals use two status codes.** Guard-based routes return 403 `FORBIDDEN`. Profile
   and reschedule services return 400 `PRIVACY_CONSENT_REQUIRED`. Both are the documented
   behavior of their features and the web handles both, but a shared contract would be simpler.

## Limitations

- The browser layer is covered by the existing Playwright suites, which mock the API, and by the
  web unit tests. This runner exercises the API contract the browser consumes.
- Password reset and avatar/document storage flows keep their own verifiers (`db:verify:avatars`,
  `db:verify:qualifications`) and are not repeated here.
