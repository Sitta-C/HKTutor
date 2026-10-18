# S2-T40 Sprint 2 seed, runbook and clean-environment rehearsal

Rehearsed on 2026-10-18 between 02:20 and 02:30 Bangkok time by Kin with pnpm 11.19.0 and
Node.js 22.22.0 (the repo pins 24.19.0, which was not available in the rehearsal sandbox), a new
PostgreSQL 16 database in UTC, the production API build (`node dist/main`), the Next.js dev server
and Chromium driven by Playwright.

## Scope

Sprint 2 Backlog row S2-T40 (US0-1): prepare a reproducible Sprint 2 seed and runbook and rehearse
the demo from a clean environment. Done means: clean migration and seed; separate student, tutor and
admin demo; no secrets or real payments.

## What changed

| Area    | Change                                                                                                                                                                                                                                                                                                                                                               |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Seed    | `apps/api/src/infrastructure/database/seed/sprint2-demo.seed.ts`, called from `seed.ts`. Adds three open slots (days +8, +9, +10 at 17:00 Bangkok) and yesterday's 17:00 class, confirmed, mock-paid with `DEMO-SEED-ENDED-CLASS` and a meeting link, so attendance can be recorded live. Fixed IDs make it idempotent; a slot held by a live booking is never moved |
| Tests   | `apps/api/test/unit/database/seed/sprint2-demo.seed.spec.ts`: Bangkok calendar days (not UTC days), the seeded states, reset on re-seed, held slots left alone, DEMO-only payment data                                                                                                                                                                               |
| Runbook | Root `README.md`, new **Sprint 2 demo runbook** section: clean-environment steps with the UTC check, a 15-step three-role script with expected results, reset and troubleshooting. The stale "Demo scope" paragraph and the seed environment list (which omitted the student account) were corrected                                                                 |

The Sprint 1 runbook (`docs/demo/s1-demo-runbook.md`) was removed from the repository on
2026-09-29 together with the rest of `docs/`, so the Sprint 2 runbook lives in the README.

## Clean migration and seed

| Check                                                                                    | Result                                                                  |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| New empty database, all 22 migrations applied in order, `pnpm db:seed`                   | Seed completed                                                          |
| Seed run a second time with no changes                                                   | Completed; same rows                                                    |
| Seed run after the Bangkok calendar day had advanced past the previous run's day         | Completed. The first version failed here (see defect 1) and was fixed   |
| CI path: migrate → seed → `pnpm db:verify:bookings` (the job CI runs after `pnpm check`) | Passed with the new seed                                                |
| Seeded slots (Bangkok time)                                                              | Yesterday 17:00 (class), day +7 (Sprint 1 slot), days +8, +9, +10 17:00 |

Prisma's engines could not be downloaded in the sandbox, so the migration SQL files were applied
with `psql` and recorded in `_prisma_migrations`, and the client was generated with
`PRISMA_SCHEMA_ENGINE_BINARY` pointing at a stub. On a developer machine `pnpm db:migrate:deploy`
does the same thing.

## Rehearsal: three roles in separate browser contexts

Each role signed in through the login page in its own browser context, so sessions, refresh cookies
and notifications were genuinely separate. Each step was checked both on screen and in the database.
Supabase Storage was replaced by a loopback stand-in (the storage configuration accepts
`http://127.0.0.1`), so the document upload exercised the real API validation without a cloud
bucket; Resend was not needed because the seeded accounts are already verified.

| #   | Step                                                       | Result | Seconds |
| --- | ---------------------------------------------------------- | ------ | ------- |
| 1   | Student signs in and accepts the privacy notice            | Pass   | 0.3     |
| 2   | Student finds a verified tutor (search, profile badge)     | Pass   | 5.3     |
| 3   | Student asks the tutor before booking                      | Pass   | 1.8     |
| 4   | Student requests the day +8 17:00 lesson                   | Pass   | 6.7     |
| 5   | Tutor sees the new-booking notification                    | Pass   | 0.7     |
| 6   | Tutor replies in chat                                      | Pass   | 3.6     |
| 7   | Tutor confirms the booking                                 | Pass   | 4.6     |
| 8   | Tutor adds the meeting link                                | Pass   | 4.6     |
| 9   | Tutor records attendance for yesterday's seeded class      | Pass   | 5.3     |
| 10  | Student sees the confirmation and records the mock payment | Pass   | 7.7     |
| 11  | Student sees the class link                                | Pass   | 15.4    |
| 12  | Student requests a reschedule to day +9                    | Pass   | 6.2     |
| 13  | Tutor approves the reschedule                              | Pass   | 5.5     |
| 14  | Student books day +10 and the tutor confirms it            | Pass   | 11.4    |
| 15  | Student cancels the unpaid class with a reason             | Pass   | 6.4     |
| 16  | Tutor uploads a teaching certificate (PDF)                 | Pass   | 5.3     |
| 17  | Admin reviews the certificate and approves it              | Pass   | 6.0     |
| 18  | Both inboxes show the reschedule and cancellation notices  | Pass   | 7.1     |

The whole walk-through took 113 seconds unattended. Final database state:

| Class (Bangkok) | Status    | Payment | Attendance |
| --------------- | --------- | ------- | ---------- |
| Yesterday 17:00 | completed | paid    | attended   |
| Day +9 17:00    | confirmed | paid    | —          |
| Day +10 17:00   | canceled  | unpaid  | —          |

Notifications, in order: tutor `BOOKING_CREATED`, student `BOOKING_CONFIRMED`, tutor
`RESCHEDULE_REQUESTED`, student `RESCHEDULE_APPROVED`, tutor `BOOKING_CREATED`, student
`BOOKING_CONFIRMED`, tutor `BOOKING_CANCELED`: one per event, none to the actor. The inbox times
displayed as Bangkok time and matched the clock.

## No secrets or real payments

- The seed reads every credential from `SEED_*` variables; the repository contains no password,
  token or key for them. The rehearsal environment used throwaway values and random JWT secrets.
- The only payment references after the rehearsal were `DEMO-SEED-ENDED-CLASS` and
  `DEMO-REHEARSAL-0001`. The payment form has no card or bank fields, and the API rejects unknown
  fields.
- Meeting links point at `meet.example.com`; fixture accounts use reserved `.invalid` or `.test`
  domains.

## Defects found

1. **Re-seeding failed the day after a previous seed (fixed).** The first version of the new seed
   moved its open slots one at a time from the earliest. Once the calendar day had advanced, moving
   the day +8 slot onto the day +9 slot's old time violated `AvailabilitySlot_no_overlap_excl`
   before that slot had moved, and the whole seed transaction rolled back. The seed now moves the
   latest slot first. A re-seed of an existing demo database reproduced the failure and passes
   with the fix.
2. **A non-UTC database time zone shifts timestamps by the offset (documented, not changed).** With
   PostgreSQL's `timezone` set to `Asia/Bangkok`, the API read a notification created at 19:28 UTC
   back as 02:28 UTC, seven hours in the future, and S2-T21's `db:verify:message-pagination` failed
   its database-clock check; with UTC both are correct. Values written by the database (`now()`
   defaults, read receipts) and values written by the Prisma client stop agreeing. Supabase runs in
   UTC, so the deployed demo is not affected, but a local PostgreSQL on a Thai machine usually
   defaults to Bangkok. The runbook makes the UTC check step 1.2. A code-level fix would pin the
   session time zone in `PrismaService` (for example `options: '-c TimeZone=UTC'`); that needs
   testing against the Supabase pooler first, so it is left for the team.

## Findings (not changed)

1. **Seeded students meet the privacy notice on first sign-in.** The seed does not record consent
   on the student's behalf, so the first sign-in lands on `/onboarding/profile` with the notice. It
   is one checkbox and arguably the right behaviour; the runbook says so.
2. **"Verification information unavailable" on a verified tutor.** The student booking detail page
   reuses the request docket, but `GET /bookings/me/:bookingId` does not return the tutor's
   verification status, so a verified tutor is labelled "Verification information unavailable".
   It reads like a warning during a demo. Either return the status or hide the line when it is
   absent.
3. **The Sprint 1 seed slot uses the UTC day.** `booking-fixtures.seed.ts` places its slot at
   10:00 UTC seven UTC days ahead, so between 00:00 and 07:00 Bangkok time it lands six Bangkok days
   ahead. Harmless, but the new Sprint 2 slots use Bangkok days.
4. **Copy.** The cancellation hint reads "This class is within the cancellation window" when the
   class is _eligible_ for cancellation (more than 24 hours away), which can be read the opposite way.

## Verification

| Check                                                          | Result          |
| -------------------------------------------------------------- | --------------- |
| `jest test/unit/database` (seed suites, including the new one) | 24 tests passed |
| Migrate → seed → `pnpm db:verify:bookings`                     | Passed          |
| Three-role rehearsal (18 steps)                                | 18/18 passed    |
| ESLint, Prettier                                               | Passed          |
