# S2-T31 notification retry and access QA

Verified on 2026-10-17 by Kin with pnpm 11.19.0 and Node.js 22.22.0 (the repo pins 24.19.0, which was not available in the verification sandbox) against a new disposable PostgreSQL 16 database
with all 22 committed migrations applied and no seed.

## Scope and traceability

Sprint 2 Backlog row S2-T31 (US3-1) asks QA to test retries, failed double booking,
self-notification and cross-user notification access, depending on S2-T28 (event writes) and
S2-T29 (owner-only list/read API). Done means: no duplicate, false or self notifications, and
users cannot access another inbox.

Existing evidence was strong at each layer on its own: the S2-T28 verifier exercises services and
PostgreSQL without HTTP, and the S2-T29 HTTP suite uses mocked persistence. Neither checked what a
recipient actually sees after a real HTTP action. This task adds
`apps/api/scripts/verify-notification-access.ts` (`pnpm db:verify:notification-access`), which serves
the real `BookingsController` and `NotificationsController` with real `JwtAuthGuard`, `RolesGuard`,
`ResourceOwnershipGuard`, signed JWTs backed by real `AuthSession` rows, real services and
PostgreSQL. No production code changed.

| Acceptance                                   | Evidence (all via HTTP unless noted)                                                                                                                                                                                                                                  |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Retried request creates no duplicate         | Same student re-POSTs the same slot: 409, notification table byte-identical, tutor inbox has exactly one `BOOKING_CREATED`                                                                                                                                            |
| Failed double booking creates no false event | Second student POSTs a taken slot: 409, no rows change, both students' inboxes stay empty. Concurrent A/B POSTs on one slot: one 201, one 409, one booking, one tutor notification for the winner only                                                                |
| Repeated / competing tutor decisions         | Confirm again and reject-after-confirm both return 409 with no new rows. Concurrent confirm/reject/confirm: exactly one 200, two 409, and one notification matching the committed status                                                                              |
| Repeated cancellation                        | Second cancel returns 409; the counterparty keeps exactly one `BOOKING_CANCELED`                                                                                                                                                                                      |
| Replayed event write is a no-op              | Three concurrent `NotificationEventsService.write` replays of an existing event (service + PostgreSQL) leave rows and the tutor's paginated inbox unchanged; every key is `<eventType>:<bookingId>`                                                                   |
| No self-notification, no outsider recipient  | Every persisted row is checked against its booking: created → tutor, confirmed/rejected → student, canceled → never `canceledById`; a second tutor and an admin have empty inboxes                                                                                    |
| Cannot list another inbox                    | `?userId=` / `?recipientId=` are 400; a `nextCursor` copied from the tutor's inbox returns nothing to another tutor; every listed item has only the six public fields                                                                                                 |
| Cannot mark another user's notification      | Other student, other tutor, admin and the booking's own counterparty get 403 on PATCH; the error body echoes no title, event type or booking ID; unknown ID is 404; outsiders' read-all returns `{updatedCount: 0, readAt: null}`; database rows unchanged throughout |
| Own reads are idempotent and scoped          | Two concurrent PATCHes by the owner return the same `readAt`; tutor read-all zeroes only the tutor's unread count and leaves the student's untouched; student B's read-all updates exactly B's unread rows                                                            |
| Session checks                               | Revoked session, a token whose `sub` does not match its session, and no token all return 401                                                                                                                                                                          |
| Verifier refuses unsafe databases            | `apps/api/test/unit/notifications/notification-access-verifier.spec.ts` (opt-in, loopback host, `hktutor_*_test` name, no URL options/fragments)                                                                                                                      |

### The verifier detects regressions

To confirm these checks would fail on a real defect, each mutation below was applied to a scratch
copy of the source, the verifier run, and the source restored. All five were caught:

| Mutation                                                    | Result |
| ----------------------------------------------------------- | ------ |
| `markRead` SQL without the `userId` filter                  | Failed |
| `list` without the recipient `userId` filter                | Failed |
| Event writer notifies the actor instead of the counterparty | Failed |
| Random suffix on `eventKey` (no dedup key)                  | Failed |
| `skipDuplicates: false` (replay throws instead of no-op)    | Failed |

## Verification

| Check                                                                       | Result                                                             |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `pnpm db:verify:notification-access` (disposable DB, opt-in)                | 12/12 checks passed on each of 7 runs, no flakes                   |
| `pnpm db:verify:notification-events` on the same database (S2-T28 baseline) | 16/16 passed                                                       |
| `jest test/unit/notifications`                                              | 4 suites / 62 tests passed                                         |
| ESLint on new files, `tsc -p scripts/tsconfig.json`, Prettier               | Passed                                                             |
| `node --test tests/*.test.mjs` (`pnpm verify:workspace`)                    | 120 pass / 7 fail, identical to unmodified `main`; no new failures |
| Root and API ESLint, full API unit suite                                    | Passed; 64 suites / 1,217 tests                                    |
| Fixture cleanup                                                             | 0 users, bookings, slots, sessions, notifications left             |

## Findings (no blocking defects)

1. **Retried booking POST returns 409 to the student who already owns the booking.** There is no
   idempotency key on `POST /bookings`, so a client retrying after a lost response is told the
   slot is taken even though its booking succeeded. Notifications stay correct (no duplicate), but
   the web client should refetch `GET /bookings/me` on a 409 before showing an error. Suggest a
   follow-up item rather than a change in this task.
2. **403 versus 404 on `PATCH /notifications/:id/read` reveals that a foreign ID exists.** This is
   the documented S2-T29 contract and IDs are random UUIDv4, so enumeration is impractical; no
   content or recipient leaks. Recorded for awareness only.
3. **HTTP retries never reach the dedup key.** Domain state transitions reject every HTTP retry
   first, so `eventKey` + `skipDuplicates` is a second line of defence that only replays (or a
   future background retry) exercise. The verifier therefore replays the writer directly.

## Reproduction

Create a new empty local database, apply all migrations without seeding, then:

```bash
HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 \
  DATABASE_URL='postgresql://postgres:disposable-local-only@127.0.0.1:55439/hktutor_notification_access_test' \
  pnpm db:verify:notification-access
```

The runner never loads `.env`, migrates or seeds; it creates random fixtures and removes them in a
`finally` block. Discard the database afterwards. Prisma's migration engine could not be
downloaded in the verification sandbox, so the 22 migration SQL files were applied in order with
`psql` and recorded in `_prisma_migrations`; the verifier checks that every committed migration is
recorded as finished before it runs.
