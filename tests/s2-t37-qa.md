# S2-T37 attendance QA

Verified on 2026-10-18 by Kin with pnpm 11.19.0 and Node.js 22.22.0 (the repo pins 24.19.0,
which was not available in the verification sandbox) against a new disposable PostgreSQL 16
database with all 22 committed migrations applied and no seed.

## Scope and traceability

Sprint 2 Backlog row S2-T37 (US4-2) asks QA to test future, pending and canceled classes, invalid
attendance, the wrong tutor and repeat submission for S2-T35 (API) and S2-T36 (UI). Done means:
invalid submissions do not mutate the booking, and a repeated identical submission succeeds safely.
Product Backlog US4-2: attendance is stored on `Booking`; only attended/absent are accepted;
re-marking is idempotent; future classes, other tutors and pending bookings are rejected.

The S2-T35 HTTP suite (`apps/api/test/bookings-attendance.e2e-spec.ts`) covers these rules with
isolated persistence and states that PostgreSQL concurrency needs separate evidence. The S2-T36
UI rules are covered by `apps/web/test/class-details.test.ts` (the `attendanceEligibility` state
table) and `apps/web/e2e/attendance-ui.spec.ts`. This task adds
`apps/api/scripts/verify-attendance-rules.ts` (`pnpm db:verify:attendance`), which serves the real
`BookingsController`, `BookingRescheduleRequestsController` and `RescheduleRequestsController`
with real guards, signed JWTs backed by real `AuthSession` rows, real services and PostgreSQL.

"Unchanged" below means the booking's `status`, `attendance`, `attendanceMarkedAt`,
`paymentStatus`, `paidAt`, `slotId`, `canceledAt`, `meetingUrl` **and `updatedAt`** are identical
before and after the request, so even a no-op write would be detected.

| Acceptance                         | Evidence (all via HTTP)                                                                                                                                                                                                                                                                                               |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Future class                       | A confirmed class in 2099 returns 409 `CLASS_NOT_ENDED` for both values; unchanged                                                                                                                                                                                                                                    |
| In-progress class                  | A class that started 30 minutes ago and ends in 30 minutes returns 409 `CLASS_NOT_ENDED` for both values; unchanged                                                                                                                                                                                                   |
| Pending class                      | An ended pending booking returns 400 `BOOKING_NOT_CONFIRMED_OR_COMPLETED` for both values; unchanged (409 when first verified; aligned to US4-2 by S2-T39, see finding 1)                                                                                                                                             |
| Canceled class                     | An ended booking rejected by the tutor, and one canceled by the student, both return 409 `BOOKING_NOT_CONFIRMED_OR_COMPLETED`; unchanged. A legacy `EXPIRED` row behaves the same                                                                                                                                     |
| Invalid attendance                 | 17 bodies return 400 unchanged: lower-case `attended`/`absent`, the story's `late-ish`, `LATE`, `COMPLETED`, leading/trailing space, `''`, `null`, number, boolean, array, object, missing field, and extra `status`, `attendanceMarkedAt` or `tutorId` fields. A `text/plain` body and a non-UUID ID also return 400 |
| Wrong tutor and other callers      | Another tutor gets 403 `BOOKING_NOT_OWNED`; the booking's own student, another student and an admin get 403; anonymous, a malformed bearer token and the owner's revoked session get 401; an unknown booking ID gets 404. All unchanged, and the owner's write still succeeds afterwards                              |
| First write                        | The owner's first `ATTENDED` returns 200 with `idempotentReplay: false`, `status: COMPLETED` and a server-generated UTC `attendanceMarkedAt`; the stored row matches the response                                                                                                                                     |
| Repeat submission (same value)     | Three identical repeats each return 200 with the original timestamp and `idempotentReplay: true`; the row (including `updatedAt`) is unchanged, so no second write happened. Repeated for `ABSENT` on a second booking                                                                                                |
| Repeat submission (other value)    | `ABSENT` after `ATTENDED`, and `ATTENDED` after `ABSENT`, return 409 `ATTENDANCE_ALREADY_RECORDED`; the original record is kept. A lower-case replay is still 400, and another tutor's replay is 403 without the saved timestamp in the body                                                                          |
| Saved record is readable           | Student and tutor class details both return `COMPLETED` with the saved value and timestamp; the student's booking detail is `COMPLETED`                                                                                                                                                                               |
| Completion closes the booking      | After completion, student cancel returns 409 `BOOKING_ALREADY_COMPLETED` and a mock payment returns 409 `BOOKING_NOT_PAYABLE`; unchanged (see finding 2)                                                                                                                                                              |
| Concurrent identical submissions   | Three rounds of eight simultaneous `ATTENDED` requests: all 200, exactly one `idempotentReplay: false`, one timestamp shared by every response and the row                                                                                                                                                            |
| Concurrent conflicting submissions | Three rounds of four `ATTENDED` against four `ABSENT`: one value is stored, every request for it is 200 with the stored timestamp, every request for the other value is 409 `ATTENDANCE_ALREADY_RECORDED`, exactly one first write, no 5xx                                                                            |
| Attendance racing a mock payment   | Five rounds: attendance always 200; payment 200 or 409; the row is `COMPLETED` and `PAID` with `paidAt` only when the payment returned 200                                                                                                                                                                            |
| Rescheduled class                  | After an approved reschedule, ending the **old** slot still returns 409 `CLASS_NOT_ENDED`; attendance succeeds only once the new slot has ended                                                                                                                                                                       |
| Stale reschedule after completion  | A request created while the class was eligible, then left pending past the class end: attendance completes the class, the later approval returns 409, the class stays on its slot and the target slot stays free (see finding 3)                                                                                      |
| Verifier refuses unsafe databases  | `apps/api/test/unit/bookings/attendance-verifier.spec.ts`                                                                                                                                                                                                                                                             |

Ended classes are reached by moving a booked slot into the past, because the booking API only
accepts future slots. Each moved window is distinct so the per-tutor no-overlap exclusion holds.

### The verifier detects regressions

Each mutation was applied to a scratch copy of the source, the verifier run, and the source
restored. All eight were caught:

| Mutation                                                                         | Result |
| -------------------------------------------------------------------------------- | ------ |
| Pending bookings pass the status gate                                            | Failed |
| Class-end check removed                                                          | Failed |
| In-progress class accepted (end compared one hour early, in check and predicate) | Failed |
| Same-value replay reports `idempotentReplay: false`                              | Failed |
| A different value is returned as a replay instead of 409                         | Failed |
| Conditional write drops its `CONFIRMED` and unset-attendance guards              | Failed |
| Service ownership check and route `@RequireOwnership` both removed               | Failed |
| DTO accepts any string instead of the `AttendanceStatus` enum                    | Failed |

## Defects found

None. Every rule in the S2-T35 contract held against PostgreSQL, including under contention.

## Findings for S2-T39

1. **Pending booking returned 409, the story says 400.** US4-2's invalid criterion reads "Given
   b-501 is still 'pending'. When attendance is submitted. Then the API returns 400." The API,
   Swagger, the S2-T35 README and the S2-T36 UI treated it as a 409 state conflict.
   **Resolved in S2-T39** (`tests/s2-t39-qa.md`, R4): following the S2-T06 precedent for US12-5,
   a still-pending booking now returns 400 with the same `BOOKING_NOT_CONFIRMED_OR_COMPLETED`
   code; canceled and expired bookings stay 409. The verifier above was updated to expect 400.
2. **An unpaid class can be completed, and can then never be paid.** Attendance does not require
   `paymentStatus=PAID`, and mock payment only accepts `CONFIRMED`. A tutor who records attendance
   first leaves the booking `COMPLETED`/`UNPAID` permanently. US7-1 revenue counts only paid
   completed classes, so the figure stays correct, but the student has no way to settle. This is
   the "attendance/completion mapping" item in S2-T39.
3. **A pending reschedule request is not closed when the class completes.** It can no longer be
   approved (409), so data stays consistent, but it remains `PENDING` until the student withdraws
   it. The same is true of any request left pending past the 24-hour cutoff. Consider expiring
   pending requests when the booking leaves `CONFIRMED`.
4. **Error copy.** `CLASS_NOT_ENDED` reads "Only ended class to be updated the attendance" and the
   status conflict reads "can be updated attendance". The web client shows its own bilingual copy
   keyed by status code, so users do not see these strings, but API consumers do.

## Verification

| Check                                                     | Result                                  |
| --------------------------------------------------------- | --------------------------------------- |
| `pnpm db:verify:attendance` (disposable DB, opt-in)       | 12/12 checks passed on each of 4 runs   |
| Same verifier against each of the eight mutations above   | Failed every time, as expected          |
| `pnpm --filter @hktutor/api test` (full unit suite)       | 66 suites / 1,259 tests passed          |
| `jest --config ./test/jest-e2e.json --runInBand bookings` | 6 suites / 188 tests passed             |
| ESLint, Prettier, `tsc -p scripts/tsconfig.json`          | Passed                                  |
| Fixture cleanup                                           | 0 users, bookings, slots, sessions left |

## Reproduction

Create a new empty local database, apply all migrations without seeding, then:

```bash
HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 \
  DATABASE_URL='postgresql://postgres:disposable-local-only@127.0.0.1:55441/hktutor_attendance_test' \
  pnpm db:verify:attendance
```

The runner never loads `.env`, migrates or seeds; it creates random fixtures and removes them in a
`finally` block. Discard the database afterwards. Prisma's engines could not be downloaded in the
verification sandbox, so the client was generated with `PRISMA_SCHEMA_ENGINE_BINARY` pointing at a
stub and the 22 migration SQL files were applied in order with `psql` and recorded in
`_prisma_migrations`; the verifier checks that every committed migration is recorded as finished
before it runs.
