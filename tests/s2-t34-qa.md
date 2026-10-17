# S2-T34 meeting link and class details QA

Verified on 2026-10-17 by Kin with pnpm 11.19.0 and Node.js 22.22.0 (the repo pins 24.19.0,
which was not available in the verification sandbox) against a new disposable PostgreSQL 16
database with all 22 committed migrations applied and no seed.

## Scope and traceability

Sprint 2 Backlog row S2-T34 (US4-1) asks QA to test URL scheme, missing link, booking state and
participant/owner access for S2-T32 (API) and S2-T33 (UI). Done means: reject
`javascript:`/`http:`/`ftp:` URLs and unauthorized writes/reads, with no link leakage. Product
Backlog US4-1: only the owning tutor may set `meetingUrl`, only `https://` URLs, and the link stays
visible to participants after completion.

The S2-T32 HTTP suite covers these rules with isolated persistence and notes that PostgreSQL
behaviour needs separate evidence. This task adds
`apps/api/scripts/verify-meeting-link-access.ts` (`pnpm db:verify:meeting-links`), which serves the
real `BookingsController`, `RescheduleRequestsController` and `NotificationsController` with real
guards, signed JWTs backed by real `AuthSession` rows, real services and PostgreSQL.

| Acceptance                        | Evidence (all via HTTP)                                                                                                                                                                                                                                                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Missing link                      | A confirmed booking with no link returns 200 to both participants with `meetingUrl: null`, a parseable `startAt` and the listing subject                                                                                                                                                                                                          |
| URL scheme and shape              | 34 inputs return 400 with the stored row unchanged: `javascript:` (mixed case, leading space, `javascript://`), `data:`, `vbscript:`, `file:`, `http:`/`HTTP:`, `ftp:`, `ws:`, scheme-relative, bare host, `https:/`, `https:`, `https://`, edge whitespace, CR/LF injection, U+2028, the inputs fixed below, `''`, `null`, a number and an array |
| Owner write, participant read     | The owning tutor saves and replaces an `https://` link (case-insensitive scheme accepted); student and tutor both read the saved value                                                                                                                                                                                                            |
| Unauthorized write                | The booking's own student, another student, another tutor and an admin get 403 on PUT, with no link in the body; anonymous PUT/GET are 401; unknown booking is 404; the row is unchanged                                                                                                                                                          |
| Unauthorized read                 | Another student, another tutor and an admin get 403 on class details with no link in the body, for both confirmed and completed classes                                                                                                                                                                                                           |
| Booking state                     | Pending: PUT 409, nothing stored. Canceled: the link is retained in the database but class details return `null` to both participants and PUT is 409. Expired (legacy row carrying a link): hidden and PUT 409. Completed: link remains visible to both participants                                                                              |
| No link leakage on other surfaces | For canceled, expired and race bookings, nine participant reads (class details ×2, `/bookings/me`, `/bookings/me/:id`, `/bookings/tutor`, current reschedule request ×2, both inboxes) never contain the URL; confirmed links also never appear on list/inbox responses or any outsider read                                                      |
| Save racing a cancellation        | Five concurrent PUT-versus-cancel rounds: cancel always 200, PUT 200 or 409, never 5xx; the stored link matches the PUT outcome and is never visible afterwards                                                                                                                                                                                   |
| Verifier refuses unsafe databases | `apps/api/test/unit/bookings/meeting-link-verifier.spec.ts`                                                                                                                                                                                                                                                                                       |

### The verifier detects regressions

Each mutation was applied to a scratch copy of the source, the verifier run, and the source
restored. All five were caught:

| Mutation                                             | Result |
| ---------------------------------------------------- | ------ |
| Validator from `main` before this task's fix         | Failed |
| Class details return the stored link in every status | Failed |
| Validator accepts `http:`                            | Failed |
| `@RequireOwnership` removed from the PUT route       | Failed |
| Status gate removed from the write                   | Failed |

## Defects found and fixed

Exploratory HTTP probes against the real database found that `isValidMeetingUrl` accepted more than
the contract and the web client allow. The fix is a separate commit,
`fix(bookings): reject control characters and credentials in meeting links`, in
`apps/api/src/modules/bookings/bookings.service.ts`; it only narrows validation and keeps the
existing 400 `INVALID_URL` response.

| Input                                         | Before                                                 | After |
| --------------------------------------------- | ------------------------------------------------------ | ----- |
| `https://meet.example.com/a\u0000b` (NUL)     | **500 Internal Server Error** (PostgreSQL rejects NUL) | 400   |
| `https://meet.example.com/a\u0001b` (control) | 200, stored                                            | 400   |
| `https://meet.example.com/a b`, `…/a\tb`      | 200, stored                                            | 400   |
| `https://meet.example.com/‮gpj.exe` (RTL)     | 200, stored; renders reversed (`exe.jpg`)              | 400   |
| `https://meet.google.com@evil.example/class`  | 200, stored; reads as Google, opens `evil.example`     | 400   |
| `https://user:secret@meet.example.com/class`  | 200, stored                                            | 400   |

The web client's `isSafeMeetingUrl` already rejects whitespace and credentials, so before the fix
participants saw the "invalid link" note for such rows rather than a clickable link; the API now
enforces the same rule for every client. Unit tests add these nine rejections plus six
real-world links that must stay valid (Zoom with `?pwd=` and fragment, Teams with percent-encoding,
`%20`, upper-case scheme/host, explicit port, Thai path). The nine new rejections fail on the
pre-fix code; the positive cases pass before and after.

## Remaining findings (not changed)

1. **No length limit.** A 90 KB `https://` URL is accepted (only Express's 100 KB body limit
   applies). The web tests deliberately mirror this, so it looks intentional; consider a cap such as
   2,048 characters in a later task.
2. **Database check is looser than the API.** `Booking_meeting_url_https_check` permits whitespace
   and control characters in the path (PostgreSQL `.` also matches newlines). The API is now the
   effective gate; a follow-up migration could tighten the constraint if rows are ever written
   outside the service.
3. **Canceled bookings keep their link in the database.** It is hidden from every read surface
   checked above, which meets "no link leakage". Clearing it on cancellation would be a product
   decision.

## Verification

| Check                                                                | Result                                                           |
| -------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `pnpm db:verify:meeting-links` (disposable DB, opt-in), with the fix | 10/10 checks passed on each of 5 runs, no flakes                 |
| Same verifier against `main`'s validator                             | Fails on the NUL input (500), as expected                        |
| `pnpm --filter @hktutor/api test` (full unit suite)                  | 64 suites / 1,232 tests passed                                   |
| `jest --config ./test/jest-e2e.json --runInBand bookings`            | 6 suites / 186 tests passed, including 3 new class-details cases |
| ESLint, Prettier, `tsc -p scripts/tsconfig.json`                     | Passed                                                           |
| Fixture cleanup                                                      | 0 users, bookings, slots, sessions, notifications left           |

## Reproduction

Create a new empty local database, apply all migrations without seeding, then:

```bash
HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 \
  DATABASE_URL='postgresql://postgres:disposable-local-only@127.0.0.1:55441/hktutor_meeting_link_test' \
  pnpm db:verify:meeting-links
```

The runner never loads `.env`, migrates or seeds; it creates random fixtures and removes them in a
`finally` block. Discard the database afterwards. Prisma's migration engine could not be downloaded
in the verification sandbox, so the 22 migration SQL files were applied in order with `psql` and
recorded in `_prisma_migrations`; the verifier checks that every committed migration is recorded as
finished before it runs.
