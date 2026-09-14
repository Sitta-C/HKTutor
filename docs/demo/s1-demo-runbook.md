# Sprint 1 Demo Runbook (S1-T29 — DRAFT)

**Owners:** Kin, Starter · **Task:** S1-T29 · **Depends on:** S1-T26 (integrated auth → listing →
availability → search → booking flow)

**Status:** DRAFT until one clean rehearsal is recorded. Revised against `main` at the S1-T26
integration merge (PR #60) on 2026-09-13; S1-T25 (PR #54) is merged, so every demo step below is
runnable today. What remains is the rehearsal itself: the one `TBC` in section 5 and the open items
in section 9 are measurements and assignments, not unknown behavior.

Companion record: `docs/qa/s1-evidence-record.md` (S1-T28) carries the API contract, the QA
citations, and the issue log referenced here.

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

| Record                  | Detail                                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Administrator           | `SEED_ADMIN_EMAIL`, email verified, active                                                                                                             |
| Tutor **Anan**          | `SEED_TUTOR_EMAIL`, email verified, verification status **VERIFIED**, 5 years experience, rating **4.80** from 24 reviews (set by the search fixtures) |
| Student **Nan**         | `SEED_STUDENT_EMAIL`, email verified, completed Grade 10 student profile                                                                               |
| Catalog                 | Mathematics, Physics · Grade 10, Grade 11                                                                                                              |
| Anan's listings         | Mathematics Grade 10 at 400 THB, **published** · Mathematics Grade 10 at 300 THB, **draft**                                                            |
| Fixture tutors (search) | Mali · Math G10 · 350 THB · 4.40, Kiet · Math G10 · 500 THB · 4.00, Niran · Physics G10 · 400 THB · 4.70, Pim · Math G11 · 450 THB · 4.60              |
| Bookable slot           | Anan, **seed run date + 7 days**, 17:00–18:00 Bangkok time, always slot id `30000000-0000-4000-8000-000000000001`                                      |

Two consequences worth knowing before the demo:

- Anan is rated 4.80 from 24 reviews, so the minimum-rating filter does not hide him. With only the
  seeded listings, Mathematics, Grade 10 at a minimum of 4.0 keeps Anan, Mali, and Kiet, since the
  bound is inclusive, and a minimum of 4.5 leaves only Anan. Any extra listings in the database appear
  alongside them.
- The bookable slot is one fixed row that every seed run moves to seven days ahead. Re-seeding does
  not create a second slot and does not release a booking already made against it. See section 8.

The seed creates no bookings and removes nothing created during a demo. The four fixture tutors have
no usable password, so they can be searched but not signed in as.

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

| #   | Step                                                                                                                                                                                                                                                   | Shown by               | Evidence         | Ready?            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- | ---------------- | ----------------- |
| 1   | Register a new tutor with the demo inbox. Submit without ticking consent and show the block. Open the privacy notice from the form, accept, then register.                                                                                             | S1-T06, S1-T11, S1-T12 | screen recording | yes               |
| 2   | Try to sign in with the new account **before** opening the verification email and show the refusal. Then open the email, follow the link, and complete tutor onboarding.                                                                               | S1-T08, S1-T09         | screenshot       | yes               |
| 3   | Sign in as seeded tutor Anan. Open My listings and show the published 400 THB listing next to the 300 THB draft.                                                                                                                                       | S1-T15, S1-T16         | screenshot       | yes               |
| 4   | As Anan, add availability in Bangkok time. Add an overlapping range and show the rejection.                                                                                                                                                            | S1-T18, S1-T19         | screenshot       | yes               |
| 5   | Sign in as seeded student Nan. On `/tutors`, filter Mathematics, Grade 10, maximum budget 500: Mali, Anan, and Kiet appear, since the limit is inclusive; Niran, Pim, and the draft do not. Then filter Physics, Grade 11 and show the no-match state. | S1-T20, S1-T21, S1-T22 | screenshot       | yes               |
| 6   | Open Anan's tutor page, choose the slot, review the server quote on the confirmation screen, and submit. Show the booking in the student list as pending.                                                                                              | S1-T24, S1-T25         | screenshot       | yes               |
| 7   | Back as Anan, open availability and show the slot booked in step 6 marked reserved, and that it cannot be deleted while that booking is active.                                                                                                        | S1-T18, S1-T19, S1-T24 | screenshot       | yes, after step 6 |
| 8   | In Swagger, authorized as Nan, send `POST /api/v1/bookings` again with the same `listingId` and `slotId`. Show `409` with "The selected slot is already booked." and no `500`.                                                                         | S1-T24, S1-T27         | API response     | yes, after step 6 |
| 9   | Call `GET /api/v1/tutors/me/listings` with no token and show `401`. Call it with the student's token and show `403`. Neither response leaks private data.                                                                                              | S1-T10, S1-T13         | API response     | yes               |
| 10  | Run steps 3 to 7 as one uninterrupted walk-through in the web UI, without opening Swagger. Steps 8 and 9 are the only Swagger steps and stay outside the walk-through.                                                                                 | S1-T26                 | recording        | yes               |

Not in Sprint 1, so not demonstrated: tutor confirming or rejecting a booking, and admin tools. No
endpoint for either exists on `main`.

Three things to say accurately on stage:

- Discovery lists only **verified** tutors with published listings. Pending and rejected tutors may
  save drafts, but cannot publish, appear in public discovery, expose public availability, or receive
  new bookings.
- Booking requires a **completed student profile**. Seeded Nan has one. An account registered live
  in step 1 must finish student onboarding before step 6 will succeed.
- The quote shown in step 6 is computed by the API from the slot duration and the listing price. The
  client never sends an amount.

**Which slot step 6 books:** book a slot created live in step 4. The seeded slot is the fallback for
a run that skips step 4, and it can only be booked once per database — see section 8.

## 7. Failure fallbacks

| Failure                                     | Fallback                                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Shared Supabase unreachable                 | present from the recorded rehearsal video; do not point the demo at an unreviewed database |
| Verification email slow or not delivered    | skip to step 3 with the seeded accounts, which are already verified                        |
| Docker build slow on the presenting machine | build before the session; use `pnpm dev` if Compose fails on the day                       |
| Seeded slot already booked from a rehearsal | book a slot created live in step 4 instead; re-seeding will not release it                 |
| A step is red on the day                    | show the failing test and the issue entry rather than skipping silently                    |

## 8. Reset between rehearsals

Sprint 1 has no cancel endpoint and nothing sets `BookingStatus.EXPIRED` (issue I4 in the evidence
record), so a booking made during a rehearsal is permanent for the life of that database.

What `pnpm db:seed` does and does not do:

| Does                                                               | Does not                                                           |
| ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Restore admin, Anan, Nan, the four fixture tutors and the listings | Cancel or delete any booking                                       |
| Move slot `3000…0001` to seven days ahead of the run               | Create a second bookable slot                                      |
| Stay idempotent and safe to re-run                                 | Remove accounts registered live in step 1 or slots added in step 4 |

Because availability excludes slots that already have a pending or confirmed booking, the seeded
slot disappears from Anan's availability after the first booking and re-seeding does not bring it
back.

The rehearsal procedure that follows from this:

1. Run step 4 in every rehearsal and book the slot you create there in step 6. The rehearsal then
   needs no cleanup at all.
2. Keep the seeded slot for the one run where step 4 is skipped.
3. If a rehearsal leaves the database unusable for another run, ask the migration owner for a fresh
   disposable database. Never run `prisma migrate reset` against the shared project, and never edit
   booking rows by hand during a demo window.

## 9. Open items before this leaves DRAFT

Everything below needs the machine that will present, so none of it can be settled from the
repository alone.

- [ ] Run steps 1–10 once end to end on the presenting machine and correct any wording that does not
      match the real screens.
- [ ] Run the Compose path once on that machine and replace the `TBC` in section 5.
- [ ] Record the walk-through duration in section 6 and keep the recording as the fallback in
      section 7.
- [ ] Confirm who presents each block and who operates the terminal.
- [ ] Re-read section 6 against the evidence record's issue log, so nothing claimed on stage is
      contradicted by a known issue.
