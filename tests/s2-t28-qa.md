# S2-T28 notification event writes

Verified on 2026-10-17 with Node.js 24.19.0 and pnpm 11.19.0.

## Scope and traceability

The Sprint 2 Backlog row 29 and Product Backlog US3-1 require idempotent notifications to the
other participant for booking and reschedule actions. The existing S2-DB05 schema/contract in
`apps/api/README.md` governs persisted `eventType`, `title`, `body` and optional `bookingId`;
the older sheet's `type`/`payloadJson` is not the implemented schema.

`apps/api/src/modules/notifications/notification-events.service.ts` supplies a shared event writer
to `BookingsService` and `RescheduleRequestsService`. All eight mutation flows write through their
domain transaction. No new endpoint, schema change, backfill, notification inbox, scheduled job,
email or Storage integration is included. List/read and UI remain S2-T29/T30.

| Acceptance                                                                     | Evidence                                                                                                                                                                                  |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Correct recipient for create/confirm/reject/cancel and all reschedule outcomes | `apps/api/test/unit/notifications/notification-events.service.spec.ts`; real service/database verifier covers both cancellation actors and both reschedule requester roles                |
| No self-notification; actor must be a participant                              | Writer unit tests cover same-ID legacy participants and outsider rejection; production calls derive the actor from the existing authenticated mutation flow                               |
| Stable key, once per recipient/event; separate reschedule rounds               | PostgreSQL verifier covers simultaneous duplicate writes and three requests for one booking; keys use request ID for reschedules                                                          |
| Replay preserves saved content/read state                                      | Real duplicate write leaves original ID, title, body, createdAt and readAt unchanged                                                                                                      |
| Failed/unauthorized/repeated actions produce no false event                    | Real service verifier snapshots persisted data before invalid actions and proves the double-booking loser creates no extra event                                                          |
| Domain writes and event commit or roll back together                           | Verifier injects failure after a real Notification insert in each of all eight paths; full booking/request/slot/notification snapshots remain identical                                   |
| Competing reschedule decisions remain consistent                               | Real approve-versus-reject and approve-versus-withdraw checks yield one successful decision and one matching outcome notification; loser returns a domain conflict                        |
| HTTP behavior and authorization remain compatible                              | Existing booking/reschedule HTTP suites use persistence doubles and mocked event writers; all 164 cases pass                                                                              |
| Disposable verifier refuses unsafe targets                                     | `apps/api/test/unit/notifications/notification-event-verifier.spec.ts` checks explicit opt-in, target requirement, loopback hosts, database naming and rejection of URL options/fragments |

Reject and withdraw now use transactions and the same booking-before-request lock order as
approval. This avoids holding a request lock while waiting for the booking foreign-key lock
needed by notification insertion. Existing verifier cleanup removes notifications before its
own synthetic bookings so the new foreign-key relationship does not strand fixtures.

## Verification

| Check                                                                           | Result                                                                                                                                    |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                                                                    | Passed Prisma generation, formatting, all workspace lint, 1,176 API tests, 345 web tests, both production builds and API script typecheck |
| `pnpm --filter @hktutor/api test:e2e --runInBand bookings reschedule-requests`  | 6 suites / 164 cases passed; real HTTP with isolated persistence                                                                          |
| `pnpm db:verify:notification-events` with explicit disposable target and opt-in | 16 real PostgreSQL/service checks passed, including all eight post-insert rollback paths                                                  |
| Committed migrations on new disposable PostgreSQL 17                            | All 22 applied successfully, without seed                                                                                                 |
| API package lint                                                                | Passed after import ordering and Prisma generation completed                                                                              |
| `pnpm verify:workspace`                                                         | Remains failing in five existing suite files, described below                                                                             |
| Ad-hoc API `tsc --noEmit --incremental false` including test sources            | Remains failing with the same 21 diagnostic categories as the unmodified baseline; no new category                                        |

The initial sandboxed full API unit run could not bind Supertest ports. The successful `pnpm check`
run allowed those local sockets. An earlier lint invocation overlapped Prisma generation and saw
temporarily unresolved generated types; the completed API lint and root gate passed afterward.
No assertions were relaxed to make either run pass.

The optional workspace command still fails in `booking-flow-web.test.mjs`,
`privacy-consent-foundation.test.mjs`, `s1-t26-integration-flow.test.mjs`,
`tutor-search-web.test.mjs` and `code-quality-config.test.mjs`. These same files fail from an
isolated archive of the unmodified baseline; that archive also reports an environment-template
failure because its `git check-ignore` runs outside a Git repository. There are no new failing
suite files from this task.
The ad-hoc broad TypeScript check was compared after normalizing paths and line numbers; its
21 diagnostic categories are identical on the baseline and this patch. Production/API-script
typechecking in the supported build gate passes.

## Reproduction and limits

Use the API README's new empty disposable PostgreSQL workflow. Apply migrations with an explicit
local target, then run:

```bash
HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 \
  DATABASE_URL='postgresql://postgres:disposable-local-only@127.0.0.1:55438/hktutor_notification_events_test' \
  pnpm db:verify:notification-events
```

The database verifier runs actual feature services and PostgreSQL without HTTP or external
services. Its failure injection throws only after a real notification insert and demonstrates
transaction rollback rather than simulating persistence. Competing operations and event retries
use real transactions. The runner removes its own random fixtures; discard the database after
success or failure. It never loads `.env`, migrates, seeds or selects a fallback target.

The final fixture check reported zero users, bookings, reschedule requests, notifications and
availability slots. The temporary container and its data were removed after verification.
Only that newly created temporary database was migrated. No shared database,
Google Sheet or Trello status was changed. Stored title/body are static English fallback text;
future bilingual inbox presentation can translate event types. End-user notification display
and live deployment rollout remain outside this event-write task.
