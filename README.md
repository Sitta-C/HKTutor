# HKTutor

HKTutor is a pnpm monorepo containing a Next.js web client and a NestJS/Prisma API. Authentication
is owned by the application: users register with email and password, verify their address through
Resend, and then use short-lived JWT access tokens backed by revocable refresh sessions.

## Workspace

- `apps/web` — Next.js 16 client on port 3000
- `apps/api` — NestJS 11 API on port 3001
- `packages/eslint-config` and `packages/tsconfig` — shared tooling
- `ui-design` — versioned static HTML design references; these do not ship with `apps/web`

Use Node.js 24.19.0 and pnpm 11.19.0.

```bash
pnpm install
cp .env.example .env
pnpm db:generate
pnpm dev
```

The web client calls the API through the same origin at `/api/v1`. During `pnpm dev`, Next.js
rewrites that path to the API on port 3001. The API documentation is available at
`http://localhost:3000/api/v1/docs` (or directly at `http://localhost:3001/api/v1/docs`).

### Current product surface

The implemented web flow includes authentication and email verification, profile onboarding/editing,
role-specific dashboards, tutor availability and course management, tutor discovery, student booking,
private student/tutor messaging, and the informational `/about-me` page. Messaging at
`/dashboard/messages` supports asking a tutor before booking, inbox pagination, latest-first opening,
incremental older-history loading, text sending and server-backed sent/read receipts. The open chat
checks for updates every four seconds, pauses while the tab is hidden and stops when closed;
manual Refresh remains available. Student and tutor sidebar Messages badges show the global
unread incoming-message count, refresh every 15 seconds while visible, and refresh immediately
after successful read acknowledgements. Availability supports overnight and multi-day ranges with
Bangkok-time presentation and UTC timestamps on the wire. Day and week views use the private
availability overlap filter to include carry-over slots without loading past history. Reserved slots
remain protected.

Message sends use `POST /api/v1/conversations/:conversationId/messages` with trimmed text of 1–2,000
Unicode code points. The API returns `201` when a student or tutor participant sends successfully,
`400 VALIDATION_FAILED` for blank or overlong text, `401 UNAUTHENTICATED` without a valid session,
`403 FORBIDDEN` for an admin or nonparticipant, and `404 NOT_FOUND` for a missing conversation.
The server derives the sender from the authenticated session; rejected responses never include
conversation content or participant details.

The tutor dashboard shows the next confirmed lesson, today's availability, pending requests, and
monthly teaching analytics. It uses existing read-only API filters to load pending requests, future
confirmed lessons, and the selected analytics month separately. Monthly loading/errors stay within
analytics and failed loads offer retry actions. Booking value represents scheduled lessons, not
received revenue; earnings and individual reviews remain unavailable without supporting data.

`/dashboard/bookings` serves both roles: a student reviews the requests they sent, while a tutor
works the booking inbox and confirms or rejects one pending request at a time. A decision is
rendered only from the status the API returns, and a 403, 404, or 409 answer locks that row behind a
refresh so the inbox never shows an optimistic status the server did not persist.

Students see paid/unpaid status on booking rows. Confirmed, unpaid bookings support Omise
PromptPay **Test Mode**: create or resume a QR, receive a signed webhook, and reconcile status
through the API. No real money is collected. An active or uncertain attempt blocks duplicate
charges and cancellation until Omise confirms a terminal result. The previous mock-payment
endpoint returns `410 Gone`; existing mock-paid demo bookings remain readable. See the
[PromptPay setup and recovery runbook](apps/api/README.md#promptpay-test-payments).

See [frontend direction](ui-design/frontend-direction.md) for the Notebook Focus patterns and
[implemented frontend behavior](ui-design/implemented-behavior.md) for interaction, loading,
responsive layout, and accessibility details.

Students and tutors can optionally upload, replace, or remove a profile photo during onboarding or
from `/dashboard/profile`. JPEG, PNG, and static WebP inputs up to 2 MiB are normalized server-side.
Student photos remain in the owner's private account area; eligible tutor photos also appear in
public search/detail pages. Avatar files use private Storage with short-lived signed URLs.

The API also supports private tutor qualification uploads, owner/admin signed previews, and an
admin review queue with atomic review and audit records. See the
[qualification API contract and rollout notes](apps/api/README.md#qualification-document-api-s2-t07).
Tutors submit and track documents under `/dashboard/profile`; administrators review pending and
completed documents under `/dashboard`. Both screens use the seven existing qualification endpoints.

The accepted student and tutor dashboard concepts, plus the tutor profile/certificate form, live
in [`ui-design`](ui-design/). Open [`ui-design/index.html`](ui-design/index.html) directly or serve
the directory as static files. [`ui-design/uidesign.md`](ui-design/uidesign.md) records the page
inventory, design tokens, component conventions, draft status, and API dependencies. Implemented
UI must be ported into `apps/web`; do not import or iframe the prototype HTML.

## Authentication flow

1. `POST /api/v1/auth/register` accepts email, password, `student` or `tutor` role, and privacy consent.
2. The API stores an Argon2id password hash and a SHA-256 hash of a random verification token.
3. Resend delivers a link to `/register/verify?token=...`.
4. `POST /api/v1/auth/verify-email` consumes the one-time token and starts a session.
5. Login and verification return a short-lived JWT access token. The rotating refresh token is kept
   only in an HttpOnly cookie and represented in PostgreSQL by its SHA-256 hash.
6. Protected endpoints verify the JWT signature, issuer, audience, token type, session state,
   account state, and email verification state.

Public auth endpoints are rate-limited. Access tokens are held in browser memory; they are not
written to local storage. Refresh-token rotation detects reuse and revokes the affected session.

### Email resend behavior

Accepted registration and initial password-reset requests start separate signed email flows, stored
in HttpOnly, SameSite=Strict cookies scoped to `/api/v1/auth` for 24 hours. Responses contain a
non-secret `emailFlow` view (`id`, `email`, `purpose`, `resendAvailableAt`, `retryAfterSeconds`).
`GET /api/v1/auth/email-flow?purpose=verification|password-reset` restores this view with
`Cache-Control: no-store`, without querying whether an account exists. Flow cookies cannot be used
as authentication, verification or password-reset credentials.

The verification page displays the registration email read-only; URL email parameters are ignored.
After the first password-reset request, the same form displays its email read-only. Both resend
buttons count down 60 seconds using the server's remaining wait and restore it after refresh.
`POST /api/v1/auth/resend-verification` and `POST /api/v1/auth/resend-password-reset` accept only
`{ flowId }`; the API obtains the original email from the signed cookie. Replacement email fields,
missing/expired/tampered cookies and mismatched IDs are rejected with 400. The ID check prevents a
stale tab from sending to an address selected by another tab. Early requests receive 429 with
`Retry-After`. A resend reserves a fresh cooldown even if the verification email provider fails.
Both services also lock the user row and enforce one issued email per account per minute, including
the initial verification email, so starting another flow or replaying a cookie cannot bypass that
account limit. Existing IP limits remain in place.

If an email was mistyped during registration, return to registration with the correct address;
this does not rename or delete the original pending account. Password recovery offers an explicit
start-new-request action before entering a different account email. No raw email-link tokens or flow
cookies are saved in browser storage. Deploy the updated web/API together because resend no longer
accepts an email body. These changes require no additional database migration or configuration.

### Password recovery

The login recovery link opens `/forgot-password`. `POST /api/v1/auth/forgot-password` accepts
`{ email }` and returns the same generic result for unknown, inactive, unverified, passwordless,
and eligible accounts. Eligible accounts receive a Resend link to `/reset-password?token=...`.
Account lookup, token persistence and delivery run asynchronously so response timing does not reveal
account eligibility. Delivery is best effort, without a durable mail queue; processing failures produce
only a generic server warning. Retry after one minute if no email arrives. Requests are limited to three per IP per minute and one email per account per minute.
A newly issued link replaces older reset links. Requesting a link does not change the password.

`POST /api/v1/auth/reset-password` accepts `{ token, password }`. Tokens are random, stored only
as SHA-256 hashes, expire after `PASSWORD_RESET_TTL_MINUTES` (default 30), and can be used once.
Passwords follow the registration policy: 10–128 characters with a letter and number. Redemption
atomically updates the Argon2id hash, consumes outstanding reset/verification links, and revokes all
account sessions. Users must sign in again; recovery never verifies an email or starts a session.
Reset submissions are limited to five per IP per minute. Both recovery pages prevent indexing and
send a `no-referrer` policy. Keep query strings out of proxy/access logs because reset URLs contain
credentials.

Apply the additive `20261016120000_add_password_reset_token` migration through the normal reviewed
deployment workflow before using recovery. No existing users or credentials are deleted. Tests
with mocked persistence/email do not certify a live database migration or Resend delivery.

### Environment

Copy `.env.example` to the ignored `.env` and replace every bracketed placeholder. Important values:

- `DATABASE_URL` — PostgreSQL/Supabase connection string used only by the API
- `SUPABASE_URL` and `SUPABASE_SECRET_KEY` — Supabase project origin and backend `sb_secret_` key
- `SUPABASE_AVATAR_BUCKET` and `SUPABASE_DOCUMENT_BUCKET` — distinct, pre-created Storage buckets;
  both must be private. See the API README for file limits and service integration.
- `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` — different random values, each at least 32 characters
- `RESEND_API_KEY` and `EMAIL_FROM` — Resend API key and an approved sender
- `APP_URL` — web URL embedded in email verification links
- `WEB_ORIGIN` — exact browser origin allowed by API CORS
- `COOKIE_SECURE=true` — required for an HTTPS deployment
- `API_INTERNAL_URL` — server-only NestJS origin used by the Next.js development rewrite
- `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_TUTOR_EMAIL`, `SEED_TUTOR_PASSWORD`,
  `SEED_STUDENT_EMAIL`, and `SEED_STUDENT_PASSWORD` — local verified demo accounts; the three emails
  must differ and passwords must be at least 10 characters

Generate secrets locally, for example:

```bash
openssl rand -base64 48
openssl rand -base64 48
```

Use two different outputs and never commit `.env`.

For a Resend sandbox, the sender and recipient restrictions in the Resend account still apply. For
a deployed demo, verify a sending domain and set `EMAIL_FROM` to an address on that domain.

## One-shot migration and reseed

The migration `20260908120000_replace_clerk_with_local_jwt_auth` is intentionally destructive. The
project has no real users, so it deletes the demo identity-owned graph in foreign-key order:
`Booking`, `AvailabilitySlot`, `TeachingListing`, `TutorProfile`, then `User`. It preserves the
subject and grade-level catalogs, removes the old external-auth identity fields, and creates local
verification/session tables.

Do not apply this migration to a database containing data that must be retained. Review the target
and back it up first. With the intended disposable/demo database and completed `.env`:

```bash
pnpm db:migrate:status
pnpm db:migrate:deploy
pnpm db:seed
```

The seed hashes the configured passwords and marks the provisioned admin, tutor and student
accounts as verified. Public registration can create only student or tutor accounts, never
administrators. It is idempotent: re-running it repairs the same rows by fixed IDs.

For Sprint 2 the seed also prepares the demo states that cannot be produced live: three open slots
for the tutor at 17:00 Bangkok time on days +8, +9 and +10 (for the booking, reschedule and
cancellation steps), and yesterday's 17:00 class, confirmed and mock-paid with a meeting link, so
attendance can be recorded during the demo. Re-seeding resets that class to "attendance not
recorded" and never moves an open slot that a live booking now holds. The seeded class retains the legacy `DEMO-SEED-ENDED-CLASS` reference. New PromptPay attempts
store test charge IDs and QR URLs, never card or bank credentials.

To exercise database constraints against a disposable local PostgreSQL database only:

```bash
HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 pnpm db:verify:sprint1
```

The verifier refuses non-loopback hosts and database names that do not begin with `hktutor-` or
`hktutor_`.

S2-DB04 adds `RescheduleRequest` persistence with one pending request per booking and old/new slot
relations. Its PostgreSQL race/rollback verifier is `pnpm db:verify:reschedules`; see the
[API runbook](apps/api/README.md#reschedulerequest-persistence-s2-db04) for the disposable-target
requirements and the separate S2-T25 endpoint work.

## Checks

```bash
pnpm check
```

This generates Prisma Client, runs formatting checks, lint, unit tests, and production builds. It
does not apply migrations, seed a database, or send email. The repository contract checks are kept
as an optional maintenance command and can be run with `pnpm verify:workspace`.

Docker images can be validated with `docker compose config` after required environment values are
set. Compose publishes Next.js on port 3000; the app forwards same-origin `/api/v1` requests to the
private NestJS service. Terminate HTTPS at an upstream VM proxy and set `COOKIE_SECURE=true` for a
deployed demo.

## Sprint 2 demo runbook

Rehearsed from a clean environment on 2026-10-18 (S2-T40); the record, timings and findings are in
[`tests/s2-t40-qa.md`](tests/s2-t40-qa.md). Use three separate browser profiles (or one normal and
two private windows) so the student, tutor and admin stay signed in side by side.

### 1. Prepare a clean environment

1. Complete `.env` as described under [Environment](#environment), including the three `SEED_*`
   accounts. Keep the real `.env` out of screen shares; nothing in the demo needs a secret on screen.
2. Use a disposable or demo database only. **Its time zone must be UTC.** Supabase already is. A
   local PostgreSQL installed on a Mac in Thailand usually defaults to `Asia/Bangkok`, and then
   timestamps the database writes itself (notifications, read receipts) are read back seven hours
   off. Check and fix it once:

   ```bash
   psql -d hktutor_demo -c 'SHOW timezone'
   psql -d hktutor_demo -c "DO \$\$ BEGIN EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'UTC'); END \$\$;"
   ```

   Use your local database name in place of `hktutor_demo`, then restart `pnpm dev` so the API
   opens new connections.

3. Migrate, seed and start:

   ```bash
   pnpm install
   pnpm db:generate
   pnpm db:migrate:deploy
   pnpm db:seed
   pnpm dev
   ```

4. Preflight: `http://localhost:3000/api/v1/health` returns `{"database":"connected"}` and
   `http://localhost:3000/api/v1/docs` opens.

### 2. Demo script

Times are Bangkok time. "Day +8" means eight days after the seed ran.

| #   | Role    | Do                                                                                                                     | Expect                                                                   |
| --- | ------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1   | Student | Sign in with `SEED_STUDENT_EMAIL`; accept the privacy notice shown on first sign-in                                    | Student dashboard "Welcome back, Nan"                                    |
| 2   | Student | **Find a tutor** → Mathematics → open **Anan**                                                                         | Only verified tutors are listed; Anan shows the **Verified tutor** badge |
| 3   | Student | **Ask the tutor** and send a question                                                                                  | Message appears in the conversation                                      |
| 4   | Student | Back on Anan's profile, pick the **day +8, 17:00** time → **Send lesson request**                                      | Request is pending                                                       |
| 5   | Tutor   | Sign in with `SEED_TUTOR_EMAIL`; open the bell                                                                         | "New booking request"                                                    |
| 6   | Tutor   | **Messages** → reply to Nan                                                                                            | Nan's question now shows as read on her side                             |
| 7   | Tutor   | **Booking requests** → **Confirm** → **Yes, confirm booking**                                                          | Booking confirmed; Nan is notified                                       |
| 8   | Tutor   | Open that booking → enter an `https://` meeting link → **Save meeting link**                                           | Link saved                                                               |
| 9   | Tutor   | Open **yesterday's 17:00** class (seeded) → **Attended** → **Record attendance**                                       | Saved with its time; the class becomes Completed                         |
| 10  | Student | Bell → "Booking confirmed"; open the booking → **Create test QR** → mark the charge Successful in Omise Test Dashboard | Paid; the meeting link is visible in Classroom details                   |
| 11  | Student | **Reschedule** → choose **day +9** → send                                                                              | Request pending; tutor sees **Review reschedule request**                |
| 12  | Tutor   | **Review reschedule request** → **Approve**                                                                            | Booking moves to day +9; day +8 is open again; Nan is notified           |
| 13  | Student | Book **day +10**; tutor confirms it; student **Cancel class** with a reason                                            | Canceled; day +10 is open again; tutor gets "Booking canceled"           |
| 14  | Tutor   | **My profile** → Tutor certificates → Certificate → choose a PDF → **Submit document**                                 | Document pending review                                                  |
| 15  | Admin   | Sign in with `SEED_ADMIN_EMAIL` → verification queue → open the document → **Approve** with a note                     | Document approved; the tutor stays verified                              |

Point out while presenting: payments use Omise PromptPay Test Mode (no real money); a paid class
cannot be canceled; attendance cannot change once recorded; and the API contract is browsable at
`/api/v1/docs`. Automated evidence for every step, including the failure paths, is listed in
[`tests/s2-t39-qa.md`](tests/s2-t39-qa.md#2-sprint-2-qa-traceability).

### 3. Reset between rehearsals

Run `pnpm db:seed` again: it resets yesterday's class and frees open slots that no live booking
holds. Bookings made during a rehearsal are not deleted, so a fully clean run needs a fresh
database (drop, migrate, seed). Never point these commands at a database whose data must be kept.

### 4. If something goes wrong

| Symptom                                        | Cause and fix                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Times in notifications or chat are 7 hours off | Database time zone is not UTC; see step 1.2                                                 |
| Health check shows `disconnected`              | `DATABASE_URL` or network; the API never prints the URL                                     |
| Seeded sign-in fails                           | `pnpm db:seed` was not run after changing the `SEED_*` values                               |
| No open slots on Anan's profile                | The seed has not run since the slots were used; re-seed or create availability as the tutor |
| Document upload fails                          | Supabase Storage settings or private buckets; see the API README                            |

## Demo scope

The local authentication implementation covers registration, verification-link resend, email
verification, login, refresh rotation, logout, current-user lookup, and route protection. Email
change, multi-factor authentication, and session-management UI are intentionally out of scope for
this small demo. Password recovery is available through `/forgot-password` and `/reset-password`.

Sprint 2 adds tutor qualification review and verified-only publishing, ranked discovery, chat with
read receipts, booking confirmation, mock payment, meeting links, attendance, cancellation,
rescheduling and in-app notifications, all connected to their production APIs. Reviews, coupons,
tutor comparison, reminders and real-time chat are Sprint 3 work.
