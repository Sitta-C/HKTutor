# Sprint 1 Demo Runbook (S1-T29 — DRAFT)

**Owners:** Kin, Starter · **Task:** S1-T29 · **Depends on:** S1-T26 (integrated auth → listing →
availability → search → booking flow)

**Status:** DRAFT, revised against `main` on 2026-09-13. Sections 2–5 describe what exists on `main`
today. Demo steps marked with an open pull request become runnable when that pull request merges.
Every `TBC` must be filled by a real rehearsal after S1-T26.

## 1. What this runbook proves

One person, on a machine that has never run HKTutor, can bring the system up from a clean clone and
walk the Sprint 1 story end to end: a visitor registers with privacy consent and verifies their
email, a verified tutor has a published listing and Bangkok-time availability, a student searches,
and books a slot, and the API rejects double booking and unauthorized access cleanly.

## 2. Preconditions

| Item            | Required value                                 | Check                                  |
| --------------- | ---------------------------------------------- | -------------------------------------- |
| Node.js         | `24.19.0` (`.node-version`)                    | `node -v`                              |
| pnpm            | `11.19.0` via corepack                         | `pnpm -v`                              |
| Docker          | Engine + Compose plugin (Compose path only)    | `docker compose version`               |
| Free disk space | several GB for install, pnpm store, and images | `df -h`                                |
| Shared Supabase | reachable, migrations applied                  | `pnpm db:migrate:status`               |
| Resend          | API key and an authorized `EMAIL_FROM` sender  | a verification email arrives in step 1 |
| Root `.env`     | every bracketed placeholder replaced           | `grep -n '\[' .env` returns nothing    |
| Demo inbox      | one real mailbox the presenter can open live   | needed only for the registration step  |

Rules that hold for the whole rehearsal:

- Never run `prisma migrate reset`, `prisma migrate dev`, or an unreviewed deploy against the shared
  development/demo project.
- Never run `pnpm db:verify:sprint1` against Supabase. It refuses non-local hosts by design and is
  only for a disposable local `hktutor-*` database.
- Secrets live only in the untracked root `.env`. Nothing is pasted into slides, issues, or chat.
- If Prisma reports drift or an unexpected migration history, stop and call the migration owner.

## 3. Clean-environment bring-up

```sh
git clone https://github.com/Sitta-C/HKTutor.git
cd HKTutor
nvm use                   # must print v24.19.0
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env      # then fill every bracketed placeholder
pnpm check                # Prisma generate, workspace contracts, format, lint, tests, build
```

Expected: `pnpm check` is green before anything is demonstrated. A red gate is a stop-the-demo
condition, not something to talk over.

Failures already hit on a fresh machine (2026-09-12):

| Symptom                                         | Cause                                                    | Fix                                                              |
| ----------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------- |
| `node -v` shows a newer version, `pnpm` missing | shell resolves Homebrew Node, not the nvm-pinned version | run `nvm use` in the repository in every new shell               |
| `pnpm install` fails partway                    | disk full                                                | free space; on macOS a full disk also blocks iCloud-synced files |

With placeholders still in `.env`, `pnpm check` passes. The seed, the API, and the demo do not.

## 4. Database and seed

```sh
pnpm db:migrate:status    # every migration Applied
pnpm db:migrate:deploy    # only if a migration is pending
pnpm db:seed              # idempotent; safe to re-run
```

The seed requires all six `SEED_*` values in `.env`: three different emails and three passwords of at
least 10 characters. It rejects bracketed placeholders.

Seed contents on `main`:

| Record                  | Detail                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| Administrator           | `SEED_ADMIN_EMAIL`, email verified, active                                                                    |
| Tutor **Anan**          | `SEED_TUTOR_EMAIL`, verified tutor, rating 4.80 from 24 reviews                                               |
| Student **Nan**         | `SEED_STUDENT_EMAIL`, email verified, Grade 10 student profile                                                |
| Catalog                 | Mathematics, Physics · Grade 10, Grade 11                                                                     |
| Anan's listings         | Mathematics Grade 10 at 400 THB, **published** · Mathematics Grade 10 at 300 THB, **draft**                   |
| Fixture tutors (search) | Mali · Math G10 · 350 THB, Kiet · Math G10 · 500 THB, Niran · Physics G10 · 400 THB, Pim · Math G11 · 450 THB |
| Bookable slot           | Anan, 1 January 2030, 17:00–18:00 Bangkok time                                                                |

The seed creates no bookings, and it does not remove rows created during a demo. See section 8.

## 5. Start the system

Compose path, closest to the deployed shape:

```sh
docker compose up --build --detach --wait
docker compose ps
curl -s http://localhost:3000/api/v1/health
```

Expected: `api`, `web`, and `gateway` running, `api` and `web` healthy, and the health response
`{"database":"connected"}`. Only the gateway publishes a port. The API is not reachable on 3001 from
the host in this mode.

Local development path, without Docker:

```sh
pnpm dev                  # web on 3000, API on 3001, web proxies /api/v1 to the API
```

Either way, open:

- Web: http://localhost:3000
- API health: http://localhost:3000/api/v1/health
- Swagger: http://localhost:3000/api/v1/docs

Compose on the presenting machine: `TBC`, not yet run.

## 6. Demo script (rehearse in this order)

| #   | Step                                                                                                                                                                                                                                                   | Shown by               | Evidence         | Ready?                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- | ---------------- | -------------------------- |
| 1   | Register a new tutor with the demo inbox. Submit without ticking consent and show the block. Open the privacy notice from the form, accept, then register.                                                                                             | S1-T06, S1-T11, S1-T12 | screen recording | yes                        |
| 2   | Open the verification email, follow the link, and complete tutor onboarding. Show that login before verification is refused.                                                                                                                           | S1-T08, S1-T09         | screenshot       | yes                        |
| 3   | Sign in as seeded tutor Anan. Open My listings and show the published 400 THB listing next to the 300 THB draft.                                                                                                                                       | S1-T15, S1-T16         | screenshot       | yes                        |
| 4   | As Anan, add availability in Bangkok time. Add an overlapping range and show the rejection. Show that a reserved slot cannot be deleted.                                                                                                               | S1-T18, S1-T19         | screenshot       | after PR #53 merges        |
| 5   | Sign in as seeded student Nan. On `/tutors`, filter Mathematics, Grade 10, maximum budget 500: Mali, Anan, and Kiet appear, since the limit is inclusive; Niran, Pim, and the draft do not. Then filter Physics, Grade 11 and show the no-match state. | S1-T20, S1-T21, S1-T22 | screenshot       | yes                        |
| 6   | Open Anan's tutor page, choose the slot, review the server quote on the confirmation screen, and submit. Show the booking in the student list as pending.                                                                                              | S1-T24, S1-T25         | screenshot       | after PR #54 merges        |
| 7   | In Swagger, authorized as Nan, send `POST /api/v1/bookings` again with the same `listingId` and `slotId`. Show `409` with "The selected slot is already booked." and no `500`.                                                                         | S1-T24, S1-T27         | API response     | yes, once a booking exists |
| 8   | Call `GET /api/v1/tutors/me/listings` with no token and show `401`. Call it with the student's token and show `403`. Neither response leaks private data.                                                                                              | S1-T10, S1-T13         | API response     | yes                        |
| 9   | Run steps 3 to 7 as one uninterrupted walk-through without switching to Swagger.                                                                                                                                                                       | S1-T26                 | recording        | after S1-T26               |

Not in Sprint 1, so not demonstrated: tutor confirming or rejecting a booking, and admin tools. No
endpoint for either exists on `main`.

Which slot step 6 books: `TBC`. The seeded 2030 slot works without step 4, but it stays booked after
the first rehearsal. A slot created live in step 4 avoids that but ties step 6 to step 4.

Timing target: `TBC`, measure during the first full rehearsal and record the actual duration here.

## 7. Failure fallbacks

| Failure                                     | Fallback                                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Shared Supabase unreachable                 | present from the recorded rehearsal video; do not point the demo at an unreviewed database |
| Verification email slow or not delivered    | skip to step 3 with the seeded accounts, which are already verified                        |
| Docker build slow on the presenting machine | build before the session; use `pnpm dev` if Compose fails on the day                       |
| Seeded slot already booked from a rehearsal | book a slot created in step 4 instead                                                      |
| A step is red on the day                    | show the failing test and the issue entry rather than skipping silently                    |

## 8. Reset between rehearsals

Re-running `pnpm db:seed` restores the fixture accounts, listings, and the 2030 slot. It does not
cancel bookings, remove accounts registered in step 1, or delete slots created in step 4.

`TBC`, define once S1-T26 lands. Preferred shape: a demo-scoped cleanup that removes only rows
created by the rehearsal, never a migration reset, so the shared project keeps its history.

## 9. Open items before this leaves DRAFT

- [ ] Re-run every step after PR #53, PR #54, and S1-T26 merge, and correct the wording to match the
      real screens.
- [ ] Decide which slot step 6 books and how bookings are cleaned up between rehearsals.
- [ ] Run the Compose path once on the presenting machine.
- [ ] Fill each `TBC`.
- [ ] Record one clean rehearsal end to end and link it here.
- [ ] Confirm who presents each block and who operates the terminal.
