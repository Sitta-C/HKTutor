# S2-DB05 Notification persistence QA

Recorded on 2026-10-16 against `167b95e` plus this change, using Node.js 24.19.0,
pnpm 11.19.0 and PostgreSQL 17 in a new disposable Docker container.

## Scope and source

The [S2-DB05 card](https://trello.com/c/PRkMFAT7) governs implementation. The
[Data Model, row 17](https://docs.google.com/spreadsheets/d/17RMTjXa26ho7blv-TK5pbJFbHxVHJEBRPKCXk9x5AE0/edit#gid=1191524122&range=A17:I17)
provides the optional booking relation. The card's `eventType`, `title` and `body` take
precedence over `type`/`payloadJson`. The model contains no generic payload or URL fields.
API event writers, ownership checks and UI remain S2-T28/T29/T30 work; the database is
private behind the backend connection. No tracker cells, card status or assignments changed.

## Verification

| Command/check                                                                                                  | Result                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm db:validate`                                                                                             | Passed                                                                                                                                     |
| `node --test tests/notification-schema.test.mjs tests/booking-foundation.test.mjs`                             | 8 passed                                                                                                                                   |
| `pnpm lint:root` and `pnpm --filter @hktutor/api lint`                                                         | Passed                                                                                                                                     |
| `pnpm check`                                                                                                   | Passed: Prisma generation, formatting, all workspace lint, 310 web tests, 1,143 API tests, both production builds and API script typecheck |
| `pnpm db:migrate:deploy` against an empty disposable database                                                  | All 22 migrations applied successfully                                                                                                     |
| `HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 pnpm db:verify:notifications` with an explicit disposable `DATABASE_URL` | Passed on both clean/default-grant targets                                                                                                 |
| `pnpm verify:workspace`                                                                                        | 120 passed, 7 existing failures; see below                                                                                                 |
| `git diff --check`                                                                                             | Passed                                                                                                                                     |

The first sandboxed `pnpm check` could not bind Supertest sockets (`listen EPERM`). The
successful rerun allowed local port binding. Neither run migrated/seeded the configured
project database. The dedicated database runs explicitly targeted only the temporary
`127.0.0.1:55437` databases `hktutor_notification_test` and
`hktutor_notification_roles_test`, with synthetic fixtures and no seed.

The PostgreSQL verifier establishes:

- A second connection waits on the first uncommitted notification insert; after the first
  commits, the loser receives `23505 Notification_userId_eventKey_key`.
- A duplicate-safe retry inserts nothing and preserves previously saved content/read time.
  The same event can notify two recipients, and different events can notify the same user.
- Nullable booking links and unread defaults work; UTC timestamps round-trip as expected.
- Invalid recipients/bookings, blank metadata, and read time before creation are rejected.
  A referenced booking cannot be hard-deleted.
- All/unread queries isolate the recipient and `(createdAt, id)` pagination retains every
  row when timestamps tie.
- A failure after a booking transition and notification insert rolls back both writes.
- RLS is enabled and PUBLIC/browser-role grants are absent. A second empty database was
  migrated with simulated `anon`/`authenticated` roles and pre-existing default table
  grants; the new table's privileges were revoked successfully.

Reproduce with an explicitly disposable local PostgreSQL 17 database, no seed:

```bash
export DATABASE_URL='postgresql://postgres:disposable-local-only@127.0.0.1:55437/hktutor_notification_test'
pnpm db:migrate:deploy
HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 pnpm db:verify:notifications
```

The runner refuses missing opt-in/target, non-loopback hosts, names outside
`hktutor_*_test`/`hktutor-*-test`, URL options and fragments. It never loads `.env` and
removes its random fixtures. The temporary container was stopped/removed after the run.

## Existing workspace failures

The same seven failures reproduced from an untouched archive of HEAD `167b95e`:

- `tests/booking-flow-web.test.mjs`: student list/detail structural assertions and initial
  fetch-effect loading assertions.
- `tests/privacy-consent-foundation.test.mjs`: registration consent structural assertion.
- `tests/s1-t26-integration-flow.test.mjs`: private route/dashboard structure and public
  booking role-aware structure.
- `tests/tutor-search-web.test.mjs`: pagination-control and search-error structure.

The old booking-foundation assertion that prohibited a `Notification` model was updated
for S2-DB05; its other Sprint 1 checks remain intact. No new workspace failures remain.
This work verifies database persistence, rather than event production or HTTP authorization.

## Confirmed dev database rollout

On 2026-10-16, after the user explicitly confirmed that the configured database is dev
and authorized applying the migration, `pnpm db:migrate:status` identified only
`20261016130000_add_notification` as pending. `pnpm db:migrate:deploy` applied that
migration successfully. The follow-up `pnpm db:migrate:status` reported all 22 migrations
applied and `Database schema is up to date!`. No seed or disposable verification runner
was executed against this database.

## Final scope review before PR

Rechecked the live Trello card against the final diff on 2026-10-16. All requested fields,
recipient/event uniqueness, all/unread cursor indexes, minimal display metadata, relational
booking link, UTC timestamps, and database failure/conflict evidence are present. Server-only
table access is enforced by RLS and privilege revocation; no endpoint/UI changes apply to this
schema card. Event production and owner-only HTTP handlers remain the separate S2-T28/T29 tasks.

The final verifier clears PostgreSQL's transaction-local statistics snapshot before each lock
probe so polling can observe new contention. Focused contract tests (8), script lint and
formatting passed again. All 22 migrations and the updated PostgreSQL verifier passed against
the new disposable `hktutor_notification_review_test` database, including pre-existing default
browser-role grants. The review container was removed after verification. The migration already
applied to dev was not modified.
