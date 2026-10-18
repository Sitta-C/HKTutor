# S2-T39 API documentation, QA traceability and acceptance-criteria resolutions

Recorded on 2026-10-18 by Kin with pnpm 11.19.0 and Node.js 22.22.0 (the repo pins 24.19.0,
which was not available in the verification sandbox) against disposable PostgreSQL 16 databases
with all 22 committed migrations applied.

Sprint 2 Backlog row S2-T39 (US0-2) asks for complete API documentation, QA traceability, and
resolution of the conflicting acceptance criteria it names: US2-2 unauthenticated 401/403, US5-2
target availability, confirmation as non-terminal per the Data Model, and the attendance/completion
mapping. This record covers all three parts. The Product Backlog and Data Model sheets are not
edited from here; section 1 gives the replacement wording for the team to apply.

## 1. Acceptance-criteria resolutions

### Status-code rule used for every decision

The repository already follows one rule, and both the S2-T06 payment fix and the decisions below
apply it:

| Status | Meaning                                                                                                     |
| ------ | ----------------------------------------------------------------------------------------------------------- |
| 400    | The request is invalid, **or** the booking has not reached the state the action needs yet (still `PENDING`) |
| 401    | No valid access token or backing session (always checked before anything else)                              |
| 403    | Authenticated, but the role or ownership does not allow the action                                          |
| 404    | The resource does not exist (a student's foreign booking is also answered as missing, to avoid disclosure)  |
| 409    | The action conflicts with recorded state: a terminal status, a duplicate, a time cutoff, or a lost race     |

### R1. US2-2: an unauthenticated caller gets 401, not 403

| Source                               | Says                                                                               |
| ------------------------------------ | ---------------------------------------------------------------------------------- |
| US2-2 invalid AC (Product Backlog)   | "Given an unauthenticated participant requests history. Then the API returns 403." |
| US11-1 invalid AC                    | "Given a signed-out client calls a protected API. Then the API returns 401"        |
| US2-1 invalid AC, S2-T18 Done output | Unauthenticated 401, non-participant/admin 403                                     |
| Implementation                       | Global `JwtAuthGuard` returns 401 `UNAUTHENTICATED` before any conversation lookup |

**Decision: 401.** Authentication is a single global guard; answering one route with 403 would
contradict US11-1 and every other protected endpoint. Evidence: `apps/api/test/conversations.e2e-spec.ts`
("returns 401 without an access token" for history), Swagger (asserted by
`apps/api/test/unit/api-documentation.spec.ts`, R1). **No code change.**

Replacement wording for US2-2: _"Given an unauthenticated request for c-10 history. Then the API
returns 401. Given an authenticated user who is not a participant of c-10. Then the API returns
403."_

### R2. US5-2: target-slot availability

The story says a reserved target is "403/409", a past or overlapping target is "400", and, after a
rejection, that "sl-120 stays unavailable". The Data Model says the target "is not held and is
revalidated on approval". S2-T27 asked for this to be clarified. The implemented and verified rule
(S2-T27 `db:verify:reschedule-rules`, 64 checks, re-run green for this record):

| Target slot at request or approval time          | Result                           |
| ------------------------------------------------ | -------------------------------- |
| Live, future slot of the same tutor, not booked  | Accepted                         |
| Booked by another pending or confirmed booking   | 409 `RESCHEDULE_TARGET_RESERVED` |
| Deleted slot                                     | 409                              |
| In the past or already started                   | 400                              |
| The booking's own slot, or another tutor's slot  | 400                              |
| Unknown slot ID                                  | 404                              |
| Class starts in less than 24 hours (either step) | 409 `RESCHEDULE_CUTOFF_EXCEEDED` |
| Another tutor, student or admin acts             | 403                              |

A pending request never reserves its target, so after a **rejection** (or withdrawal) the target is
exactly as bookable as it was before. "Stays unavailable" in the story is the error. A partial
overlap with another slot of the same tutor cannot exist: PostgreSQL's
`AvailabilitySlot_no_overlap_excl` refuses it, so "overlaps an existing booking" can only mean the
booking's own slot, which is 400.

**Decision: keep the implementation; amend the story.** Replacement wording for the rejection
criterion: _"Given s-202 requests available sl-120 and t-101 rejects it. Then b-501 stays on
sl-100, sl-120 remains bookable by anyone (a pending request never holds its target), and s-202 is
notified."_ And for the invalid criterion: _"Given sl-120 is booked by someone else, deleted, or
inside the 24-hour cutoff, then 409; given a past slot, the booking's own slot or another tutor's
slot, then 400."_ **No code change.** Swagger now says this on the reject endpoint (asserted, R2).

### R3. Confirmation is non-terminal (Data Model)

US12-4's note and S2-T01's Done output already say confirmation is non-terminal; the Data Model's
Booking row lists `pending | confirmed | completed | canceled`. The implemented transitions, each
verified against PostgreSQL:

| From        | Action (endpoint)                               | To                     | Evidence                                   |
| ----------- | ----------------------------------------------- | ---------------------- | ------------------------------------------ |
| —           | Student books (`POST /bookings`)                | `PENDING`              | S2-T38 flow, S1 booking verifier           |
| `PENDING`   | Tutor confirms (`…/confirm`)                    | `CONFIRMED`            | S2-T03 `db:verify:tutor-transitions` (72)  |
| `PENDING`   | Tutor rejects (`…/reject`)                      | `CANCELED`, slot freed | S2-T03, S2-T38                             |
| `PENDING`   | Either participant cancels ≥24 h before, unpaid | `CANCELED`, slot freed | S2-T24 `db:verify:cancellation` (29)       |
| `CONFIRMED` | Either participant cancels ≥24 h before, unpaid | `CANCELED`, slot freed | S2-T24, S2-T38                             |
| `CONFIRMED` | Approved reschedule                             | `CONFIRMED`, new slot  | S2-T27, S2-T38                             |
| `CONFIRMED` | Student pays (`…/mock-payment`)                 | `CONFIRMED` + `PAID`   | S2-T06, S2-T38                             |
| `CONFIRMED` | Tutor records attendance after the class ends   | `COMPLETED`            | S2-T37 `db:verify:attendance` (12), S2-T38 |
| any other   | Confirm or reject again                         | 409, unchanged         | S2-T03                                     |

`COMPLETED` and `CANCELED` are terminal. **Decision: confirmed by the implementation; no change.**
Swagger now documents the non-terminal rule on the confirm endpoint (asserted, R3).

### R4. Attendance and completion mapping

| Question                                  | Decision                                                                                                                                                                     |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What makes a booking `COMPLETED`?         | The tutor's first attendance record after the class end time, whichever value: `ATTENDED` and `ABSENT` both complete it. `COMPLETED` means "class finalized", not "attended" |
| Can attendance change?                    | No. The same value again is an idempotent 200 (`idempotentReplay: true`, original timestamp, no write); a different value is 409 `ATTENDANCE_ALREADY_RECORDED`               |
| Pending booking                           | **400** `BOOKING_NOT_CONFIRMED_OR_COMPLETED`, as US4-2 states (see below)                                                                                                    |
| Future class, canceled or expired booking | 409                                                                                                                                                                          |
| Does completion require payment?          | No (current behaviour). See open item O2                                                                                                                                     |

The pending case was a real conflict: US4-2 says 400, while the API, Swagger, README and UI used
409 (S2-T37 finding 1). The team resolved the identical US12-5 conflict for payments in favour of the
story (S2-T06), so this record does the same. **Code changed:**

- `apps/api/src/modules/bookings/bookings.service.ts`: a `PENDING` booking now returns 400 with the
  unchanged `BOOKING_NOT_CONFIRMED_OR_COMPLETED` code; canceled and expired stay 409.
- Swagger (`bookings.swagger.ts`), the S2-T35 README section, the unit and HTTP suites, and the
  S2-T37 live verifier were updated to match.
- `apps/web/src/components/bookings/attendance-form.tsx` shows the same "unavailable" explanation for
  the 400 as for the 409, with a new Playwright case in `apps/web/e2e/attendance-ui.spec.ts`.

Replacement wording for US4-2: _"Re-submitting the same value is idempotent (200, no change);
submitting a different value after recording returns 409. Recording either value completes the
booking."_

### R5. US12-5: already paid and reused reference (carried from S2-T06)

US12-5 says an already-paid booking and a used `mockReference` return 400. The API returns 409
(`BOOKING_ALREADY_PAID`, `MOCK_REFERENCE_TAKEN`); S2-T06 kept these deliberately and fixed only the
pending case. Both are conflicts with recorded state under the rule above. **Decision: keep 409;
amend the story** to "_already paid or reference already used → 409; empty reference → 400_".

### Open items for the team (not changed)

| #   | Item                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| O1  | **Booking a past slot is 409, US12-3 says 400** (Sprint 1 behaviour). A past reschedule target is 400 per US5-2. One rule should apply to both; changing either affects the web booking flow, so it is left for Sprint 3 planning.         |
| O2  | **An unpaid class can be completed and then never paid** (S2-T37 finding 2). Either require `PAID` before attendance, or allow payment of a `COMPLETED`/`UNPAID` booking. US7-1 revenue already counts only paid completed classes.        |
| O3  | **`ABSENT` counts as completed.** For US7-1 that is intended (completion rate = completed / (completed + canceled)). For US8-1, a student marked absent could review the class; Sprint 3 should decide whether reviews require `ATTENDED`. |
| O4  | **Pending reschedule requests outlive their class** (S2-T37 finding 3). They can no longer be approved, but stay `PENDING` until withdrawn.                                                                                                |
| O5  | **Student-side double booking is not checked.** Nothing stops a student from holding two classes with different tutors at the same time, at booking or reschedule time. No story asks for it.                                              |

### Data Model sheet drift (proposed sheet updates)

| Entity            | Sheet says                         | Code says                                                                                                  |
| ----------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| TutorProfile      | `pending \| verified \| rejected`  | Also `unverified` (no documents yet), added in PR #92                                                      |
| Booking           | No `expired` status                | `EXPIRED` exists in the enum and is handled by every endpoint, but nothing sets it yet                     |
| RescheduleRequest | "reason required"                  | Optional on the API; a blank reason stores a default text. A rejection reason is logged only, never stored |
| Notification      | `type`, `payloadJson?`             | `eventType`, `title`, `body`                                                                               |
| AuditLog          | Covers booking and payment changes | Not implemented; only `TutorDocumentAudit` exists. S2-DB06 (It, To do) owns the audit coverage check       |

## 2. Sprint 2 QA traceability

Every Sprint 2 story, the rows that prove it, and what was re-run for this record. "Re-run" means
executed in this session against a fresh disposable database; ✓ = passed.

| Story  | Acceptance focus                                                         | Evidence (API · UI)                                                                                                                                                         | Re-run                     |
| ------ | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| US12-4 | Owner-only confirm/reject; reject frees slot; repeated/final 409         | S2-T03 `db:verify:tutor-transitions`; `bookings-tutor-actions.e2e-spec.ts` · `tutor-booking-inbox-ui.spec.ts`                                                               | ✓ 72 checks                |
| US12-5 | Confirmed+unpaid only; amount; unique reference; no card data            | S2-T06 (`tests/s2-t06-qa.md`); `bookings-mock-payment.e2e-spec.ts` · `student-mock-payment-ui.spec.ts`                                                                      | ✓ via S2-T37/T38 races     |
| US6-1  | Private PDF/JPG/PNG ≤5 MB; admin-only review; both outcomes              | S2-T09 (`tests/s2-t09-qa.md`); `db:verify:qualifications`; `qualification-documents.e2e-spec.ts` · `qualification-verification-ui.spec.ts`                                  | ✓                          |
| US6-2  | Verified-only publish; badge; revocation hides listings                  | S2-T12 `db:verify:tutor-verification`; S2-T38 verification-loss path · `public-tutor-detail-ui.spec.ts`, `tutor-search-ui.spec.ts`                                          | ✓                          |
| US1-2  | Deterministic ranking, tie-breaks, tags, invalid priority 400            | S2-T15 `db:verify:tutor-ranking`; `tutor-ranking-contract.e2e-spec.ts` · `tutor-search-ui.spec.ts`                                                                          | ✓                          |
| US2-1  | Participant-only send; 1–2,000 chars; 404/401/403                        | S2-T18 `conversations.e2e-spec.ts`; S2-T38 chat step · `conversations-ui.spec.ts`                                                                                           | ✓ S2-T38                   |
| US2-2  | Cursor pagination; recipient-only read receipts; **401** (R1)            | S2-T21 `db:verify:message-pagination` · `conversations-ui.spec.ts`                                                                                                          | ✓ 8 checks (UTC database)  |
| US5-1  | Inclusive 24 h cutoff; reason; paid/completed 409; slot release          | S2-T24 `db:verify:cancellation`; S2-T38 cancellation path · `booking-cancellation-ui.spec.ts`                                                                               | ✓ 29 checks                |
| US5-2  | One pending request; cutoff; target rules (R2); atomic swap              | S2-T25 `db:verify:reschedule-endpoints`; S2-T27 `db:verify:reschedule-rules`; S2-DB04 `db:verify:reschedules`; S2-T38 · `booking-reschedule-ui.spec.ts`                     | ✓ 6 + 64 checks; ✓ DB04    |
| US3-1  | One notice per event and recipient; no self/false/duplicate notices      | S2-DB05, S2-T28, S2-T29, S2-T31 (`tests/s2-*-qa.md`); `db:verify:notifications`, `…:notification-events`, `…:notification-access`; S2-T38 · `notification-inbox-ui.spec.ts` | ✓ 16 + 12 checks; ✓ DB05   |
| US4-1  | Owner-only https link; participant-only details; state rules             | S2-T34 `db:verify:meeting-links` (`tests/s2-t34-qa.md`) · `classroom-details-ui.spec.ts`                                                                                    | ✓ 10 checks                |
| US4-2  | Ended classes only; attended/absent; idempotent repeat; pending 400 (R4) | S2-T37 `db:verify:attendance` (`tests/s2-t37-qa.md`); `bookings-attendance.e2e-spec.ts` · `attendance-ui.spec.ts`                                                           | ✓ 12 checks; ✓ 32 UI cases |
| US0-1  | Cross-role flow and regressions                                          | S2-T38 `db:verify:sprint2-flow` (`tests/s2-t38-qa.md`)                                                                                                                      | ✓ 9 checks                 |
| US0-2  | Swagger contract and automated checks                                    | This record; `apps/api/test/unit/api-documentation.spec.ts`                                                                                                                 | ✓ 10 tests                 |

`db:verify:message-pagination` failed one check when the disposable PostgreSQL ran in the
`Asia/Bangkok` time zone and passed once the database used UTC. That is an environment finding,
recorded and handled in the S2-T40 runbook, not a pagination defect.

## 3. API documentation

### What changed

- Every one of the 66 mounted operations now has a summary, a description, a tag and a success
  response. 40 descriptions were added: the Sprint 2 booking, chat, reschedule and qualification
  endpoints, and the Sprint 1 auth, profile, avatar, catalog, listing and availability endpoints.
- Missing responses were filled in: `POST /auth/consent` now documents 400; the qualification
  endpoints' 401, 404 and 503 responses now say when they happen.
- The attendance, confirm and reschedule-reject descriptions record R2–R4.

### How it is kept complete

`apps/api/test/unit/api-documentation.spec.ts` generates the OpenAPI document from the real
`AppModule` (no database connection) and fails `pnpm check` when any mounted operation lacks a
summary, description, tag or 2xx response; when a JWT route lacks 401; when a path-parameter route
lacks 400 or 404; when a body route lacks 400; or when any error response has no description. It
also pins the R1–R4 wording that clients rely on. Removing one description makes it fail with the
operation's name.

### Documented statuses match observed behaviour

Every response returned during this session's live verifier runs (S2-T37, S2-T38, S2-T34, S2-T27,
S2-T25, S2-T24, S2-T03, S2-T31, S2-T28, S2-T21, S2-T15, S2-T12) was recorded as method, route and
status by a response hook and compared with the generated document: **670 requests, 97 distinct
route/status pairs across 40 of the 66 operations, all documented.** The only other status seen was
a 500 from `POST /reschedule-requests/:requestId/approve`, which the S2-T25 verifier provokes on
purpose with a failure trigger to prove rollback.

## Verification

| Check                                                              | Result                                                                                                   |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @hktutor/api test` (full unit suite)                | 68 suites / 1,277 tests passed                                                                           |
| `jest --config ./test/jest-e2e.json --runInBand` (all HTTP suites) | 21 of 22 suites passed; `app.e2e-spec.ts` needs a `.env` and fails identically on `main` in this sandbox |
| `pnpm --filter @hktutor/web exec vitest run`                       | 35 files / 436 tests passed                                                                              |
| Playwright `attendance-ui.spec.ts` (chromium)                      | 32 passed, including the new 400 case                                                                    |
| `pnpm db:verify:attendance` after the R4 change                    | 12/12 passed                                                                                             |
| Live verifiers listed in section 2                                 | All passed                                                                                               |
| ESLint, Prettier                                                   | Passed                                                                                                   |
