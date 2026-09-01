# Sprint 1 Demo Runbook (S1-T29 — DRAFT)

**Owner:** Kin · **Task:** S1-T29 · **Depends on:** S1-T26 (integrated auth → listing →
availability → search → booking flow)

**Status:** DRAFT. Steps 1–4 are executable today. Step 5 onward is written against the intended
S1-T26 flow and must be rehearsed and corrected once S1-T26 is merged. Every `TBC` marks a value
that cannot be filled in before then.

## 1. What this runbook proves

One person, on a machine that has never run HKTutor, can bring the system up from a clean clone and
walk the Sprint 1 story end to end: a visitor registers and accepts the privacy notice, becomes a
tutor or student, a tutor publishes a listing and availability, a student searches, books, and the
tutor confirms.

## 2. Preconditions

| Item                    | Required value                      | Check                        |
| ----------------------- | ----------------------------------- | ---------------------------- |
| Node.js                 | `24.19.0` (`.node-version`)         | `node -v`                    |
| pnpm                    | `11.19.0`                           | `corepack enable && pnpm -v` |
| Docker                  | Engine + Compose plugin             | `docker compose version`     |
| Shared Supabase project | reachable, migrations applied       | `pnpm db:migrate:status`     |
| Clerk application       | development instance keys available | TBC after S1-T08             |
| Demo accounts           | seeded admin, tutor, student        | see step 4                   |

Rules that hold for the whole rehearsal:

- Never run `prisma migrate reset`, `prisma migrate dev`, or an unreviewed deploy against the shared
  development/demo project.
- Secrets live only in the untracked root `.env`. Nothing is pasted into slides, issues, or chat.
- If Prisma reports drift or an unexpected migration history, stop and call the migration owner.

## 3. Clean-environment bring-up

```sh
git clone https://github.com/Sitta-C/HKTutor.git
cd HKTutor
corepack enable && corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
cp .env.example .env      # then fill every bracketed placeholder
pnpm check                # format, workspace contracts, lint, unit tests, build
```

Expected: `pnpm check` is green before anything is demonstrated. A red gate is a stop-the-demo
condition, not something to talk over.

## 4. Database and seed

```sh
pnpm db:migrate:status    # every migration Applied
pnpm db:migrate:deploy    # only if a migration is pending
pnpm db:seed              # idempotent; safe to re-run
```

Seed contents today: the active administrator (S1-T07), the verified tutor foundation (S1-T14), and
the subject/grade catalog plus search fixtures (S1-T20). Demo student and booking fixtures are
`TBC` — decide during S1-T26 whether the demo books against a seeded slot or one created live.

## 5. Start the system

```sh
docker compose up --build --detach --wait
docker compose ps
curl -s http://localhost:3001/health | jq
```

Expected: both containers healthy and the health endpoint reporting `database: "connected"`.

- Web: http://localhost:3000
- API: http://localhost:3001
- Swagger: http://localhost:3001/api/docs

## 6. Demo script (rehearse in this order)

| #   | Step                                                                                                        | Shown by               | Evidence to capture | Blocked on |
| --- | ----------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------- | ---------- |
| 1   | Open `/privacy`, show the notice version and the Clerk processing section                                   | S1-T11                 | screenshot          | —          |
| 2   | Register as a tutor; try to submit without accepting the notice, show the block, then accept                | S1-T11                 | screen recording    | —          |
| 3   | Complete Clerk sign-up and onboarding; show the Local User row with `consentAcceptedAt` and `policyVersion` | S1-T08, S1-T09, S1-T12 | screenshot + row    | S1-T12     |
| 4   | Create and publish a tutor profile and listing                                                              | S1-T15, S1-T16         | screenshot          | S1-T15     |
| 5   | Add availability slots in Bangkok time; show the overlap rejection                                          | S1-T18, S1-T19         | screenshot          | S1-T18     |
| 6   | Sign in as a student; filter by subject, grade, budget, rating; show the no-match state                     | S1-T21, S1-T22         | screenshot          | S1-T21     |
| 7   | Book a slot; show the confirmation screen and the student booking list                                      | S1-T24, S1-T25         | screenshot          | S1-T24     |
| 8   | As the tutor, confirm the booking; show the slot is no longer bookable                                      | S1-T24                 | screenshot          | S1-T24     |
| 9   | Show the double-booking rejection (409, not 500) from a second attempt                                      | S1-T27                 | API response        | S1-T27     |
| 10  | Show an unauthorized access attempt returning 401/403 without private details                               | S1-T10, S1-T13         | API response        | S1-T13     |

Timing target: `TBC` — measure during the first full rehearsal and record the actual duration here.

## 7. Failure fallbacks

| Failure                                        | Fallback                                                                                   |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Shared Supabase unreachable                    | present from the recorded rehearsal video; do not point the demo at an unreviewed database |
| Clerk development instance rate-limits sign-up | use a pre-created demo account signed in before the session                                |
| Docker build slow on the presenting machine    | build before the session; `docker compose up --detach --wait` only during it               |
| A step is red on the day                       | show the failing test and the issue entry rather than skipping silently                    |

## 8. Reset between rehearsals

`TBC` — define once S1-T26 lands. Preferred shape: a demo-scoped cleanup that removes only rows
created by the rehearsal, never a migration reset, so the shared project keeps its history.

## 9. Open items before this leaves DRAFT

- [ ] Re-run every step after S1-T26 merges and correct the wording to match the real screens.
- [ ] Fill each `TBC`.
- [ ] Record one clean rehearsal end to end and link it here.
- [ ] Confirm who presents each block and who operates the terminal.
