# S2-T38 Sprint 2 cross-role integration

Verified on 2026-10-18 by Kin with pnpm 11.19.0 and Node.js 22.22.0 (the repo pins 24.19.0,
which was not available in the verification sandbox) against a new disposable PostgreSQL 16
database with all 22 committed migrations applied and no seed.

## Scope and traceability

Sprint 2 Backlog row S2-T38 (US0-1) asks for the verified tutor discovery → chat → booking →
confirmation → mock payment → class/attendance flow to be integrated end to end. Done means:
cross-role happy-path evidence plus cancellation and reschedule regression evidence. Its
dependencies are the per-feature QA rows, all Done: S1-T26 (Sprint 1 flow), S2-T06 (payment),
S2-T12 (verification visibility), S2-T15 (ranking), S2-T21 (chat history), S2-T24
(cancellation), S2-T27 (reschedule), S2-T31 (notifications), S2-T34 (meeting links) and S2-T37
(attendance). S2-DB06 (clean migration/seed smoke test) is still To do and is not relied on here.

Each of those rows proved one feature in isolation, usually by mounting only that feature's
controllers. None of them shows the features working **together** through the application as it
actually boots. This task adds `apps/api/scripts/verify-sprint2-integration.ts`
(`pnpm db:verify:sprint2-flow`), which:

- boots the real `AppModule` (every module, global pipe, guard, filter and throttler), so a missing
  provider or module import fails the run;
- signs users in through the real auth endpoints: the tutor and student **register, verify their
  email and onboard over HTTP**, and the admin signs in with a password, as the product requires
  admins to be provisioned rather than self-registered;
- replaces only the two external providers at their outermost boundary: Resend (verification
  emails are captured, not sent) and the Supabase Storage client (an in-memory private bucket, so
  `StorageService` still validates the PDF signature, size and object path);
- uses random fixtures, so it can run repeatedly against the same disposable database.

## Happy path (one student, one tutor, one admin)

| #   | Actor           | Step (all over HTTP)                                                                                     | Checked outcome                                                                                                       |
| --- | --------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 1   | Tutor, student  | `POST /auth/register` → captured token → `POST /auth/verify-email` → `PUT /profiles/me/{tutor,student}`  | 201/200/200; the verification token is single-use (replay 400); the registered password logs in                       |
| 1   | Admin           | `POST /auth/login`                                                                                       | 200 with an access token                                                                                              |
| 2   | Tutor           | `POST /tutors/me/listings` (draft) → `POST …/publish`                                                    | Draft created; publish refused 403 while unverified; the draft is not discoverable                                    |
| 2   | Tutor           | `POST /tutors/me/availability` ×5 (Bangkok 17:00, days +3 to +7)                                         | 201 each                                                                                                              |
| 2   | Tutor → admin   | `POST /tutors/me/qualification-documents` (PDF) → `GET /admin/tutor-verifications` → `PATCH …/:id`       | Upload stored in the private bucket; document queued; a student's review is 403; admin approval returns `VERIFIED`    |
| 2   | Tutor           | `POST …/publish`                                                                                         | 200 once verified                                                                                                     |
| 3   | Anyone          | `GET /tutors?subject&grade&maxPrice=500&priority=earliest_availability`, `GET /tutors/:id`, availability | Exactly this tutor and listing, badged `VERIFIED`; `maxPrice=449.99` excludes a 450 listing; all 5 slots open         |
| 4   | Student ↔ tutor | `POST /conversations` (twice) → message → tutor list/history → `POST …/read` → reply                     | 201 then 200 with the same conversation; 2 messages; the student's question carries `readAt`; an admin's post is 403  |
| 5   | Student         | `GET /bookings/quote` → `POST /bookings`                                                                 | Net 450.00; `PENDING`; the slot leaves public availability; the tutor cannot book (403); tutor gets `BOOKING_CREATED` |
| 5   | Student → tutor | Mock payment on the pending booking → `POST /bookings/tutor/:id/confirm`                                 | Payment 400 while pending; confirm 200; student gets `BOOKING_CONFIRMED`                                              |
| 5   | Student         | `POST /bookings/me/:id/mock-payment` ×2                                                                  | First 200 `PAID`; second 409                                                                                          |
| 5   | Tutor → student | `PUT …/meeting-link` → `GET /bookings/:id/class-details`                                                 | The student reads the `https://` link                                                                                 |
| 5   | Tutor           | `PUT …/attendance` before and after the class ends                                                       | 409 before; 200 `COMPLETED` after; the student reads `COMPLETED`, `ATTENDED`, the link, and `PAID` on their booking   |

The class end is reached by moving that one slot into the past in the database, because the API
only accepts future slots. Nothing else is written directly except the catalog rows and the admin
account (no API creates either).

## Regression paths

| Path                      | Checked outcome                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cancellation (US5-1)      | A blank reason is 400. Cancelling a confirmed booking returns 200, the slot reappears in public availability, the tutor gets `BOOKING_CANCELED` and the student gets no self-notice. The same slot is booked again and the tutor rejects it: slot free again, student gets `BOOKING_REJECTED`                                                                                                             |
| Reschedule (US5-2)        | A second pending request is 409; a student cannot approve (403). The tutor rejects: the booking stays on its slot. A new request is approved: the booking moves, the old slot reopens, the new one is reserved. Student notices: `BOOKING_CONFIRMED`, `RESCHEDULE_REJECTED`, `RESCHEDULE_APPROVED`; tutor: `BOOKING_CREATED`, `RESCHEDULE_REQUESTED` ×2                                                   |
| Verification loss (US6-2) | With the listing still `PUBLISHED`, setting the tutor to `REJECTED` hides them from plain search and from all three ranking priorities, the public profile returns 404, booking a free slot returns 409 with no row written, and the student's existing confirmed booking stays readable. Re-verifying restores discovery. There is no revoke endpoint, so the status is written directly, as S2-T12 does |
| Final invariants          | Bookings end as 1 `COMPLETED`+`PAID`, 2 `CANCELED`, 1 `CONFIRMED`; every stored notification `eventKey` is unique per recipient; both inboxes mark all read                                                                                                                                                                                                                                               |

### The verifier detects integration regressions

Each mutation was applied to a scratch copy of the source, the verifier run, and the source
restored. All six were caught:

| Mutation                                                       | Caught at                   |
| -------------------------------------------------------------- | --------------------------- |
| Booking creation stops notifying the tutor                     | Step 5 notification types   |
| Shared public-tutor filter (`publicTutorWhere`) drops VERIFIED | Step 2, unverified publish  |
| Public availability hides every slot that ever had a booking   | Cancellation, released slot |
| Reschedule approval leaves the booking on its old slot         | Reschedule, slot swap       |
| Opening a chat never records read receipts                     | Step 4, read receipt        |
| Approving a document does not verify the tutor                 | Step 2, admin approval      |

Removing only the verification clause from the raw-SQL ranking prefilter is **not** observable,
and that is correct: the listing IDs it returns are re-filtered by the Prisma `where` that carries
`publicTutorWhere`, so the clause is defence in depth.

## Defects found

None. Every Sprint 2 feature worked together through the booted application.

## Observations (not changed)

1. **No notification for payment or completion.** The tutor is not told when a student pays, and
   the student is not told when attendance completes the class. US3-1 does not ask for either, so
   this is a candidate for Sprint 3 alongside the US3-2 reminders.
2. **Browser-level coverage still uses mocked APIs.** The web Playwright suites (including
   `s1-t26-flow.spec.ts`) intercept `/api/v1`. The live browser walk-through of this same flow is
   part of the S2-T40 demo rehearsal.
3. The S2-T37 findings (an unpaid class can be completed and then never paid; pending reschedule
   requests outlive completion) apply to this flow too and are carried into S2-T39.

## Verification

| Check                                                              | Result                              |
| ------------------------------------------------------------------ | ----------------------------------- |
| `pnpm db:verify:sprint2-flow` (disposable DB, opt-in)              | 9/9 checks passed on each of 4 runs |
| Same verifier against each of the six mutations above              | Failed every time, as expected      |
| `apps/api/test/unit/bookings/sprint2-integration-verifier.spec.ts` | 8 tests passed                      |
| ESLint, Prettier, `tsc -p scripts/tsconfig.json`                   | Passed                              |

## Reproduction

Create a new empty local database, apply all migrations without seeding, then:

```bash
HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 \
  DATABASE_URL='postgresql://postgres:disposable-local-only@127.0.0.1:55441/hktutor_integration_test' \
  pnpm db:verify:sprint2-flow
```

The runner pins every external credential (JWT secrets, Resend, Supabase) to test-only values
before `AppModule` loads, so a developer `.env` with real keys is never used, and it refuses any
database that is not a loopback `hktutor_*_test` database. Qualification audit rows are
append-only by design, so the runner leaves its random fixtures in place: discard the database
afterwards.
