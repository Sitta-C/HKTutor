# S3-T03 chat verification

The implemented scope follows S3-T03 with the later product decisions to remove manual Refresh
buttons and visible connection labels. Connection transitions remain available to screen readers
through a bilingual live region. Error recovery still offers Try again.

## Behavior and evidence

| Requirement                                                                      | Implementation / executable evidence                                                                                                                                                                                  |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current memory-only JWT, refresh, logout, room lifecycle                         | `src/lib/use-conversation-socket.ts`, `conversation-realtime.ts`; transport unit tests and the live JWT-expiry/logout cases                                                                                           |
| Fixed T01/T02 event schemas                                                      | `conversation-socket-events.ts`; UUID, UTC instant, text and read-batch boundary tests                                                                                                                                |
| REST authority, deduplication, oldest-first order and irreversible read receipts | `conversation-model.ts`, `api/conversations.ts`; merge/API tests and replay of reversed/duplicated real server frames                                                                                                 |
| Rejoin before catch-up; drain missed pages                                       | Live network outage commits 65 messages through the real REST API, then forwards a real join acknowledgement before releasing history reads; assertions require continuing and final forward pages and 65 unique rows |
| Four-second fallback; no routine healthy polling                                 | Responsive browser tests and live healthy/outage cases; closing/hidden threads stop reads and subscriptions                                                                                                           |
| Uncertain POST never resends automatically                                       | Browser test commits the POST but drops its response, holds an older GET and the new catch-up separately, and proves Send stays blocked until the new catch-up succeeds                                               |
| Draft, scroll, history and permissions                                           | Responsive fixtures plus live hidden/switch/logout flow; live PostgreSQL-backed REST rejects foreign/missing conversations with 403/404                                                                               |
| Global unread invalidation                                                       | Notify the existing unread-count consumer after newly reconciled incoming messages and successful persisted read acknowledgements; never infer totals from partial inbox pages                                        |

The normal browser suite intercepts REST/Socket.IO for deterministic failures, timers and responsive
checks. The separate live suite runs two independent browser contexts against the actual Nest API,
Socket.IO gateway, authentication/session rotation, Prisma and a migrated local PostgreSQL database.
Its network control forwards real server frames; it only closes, delays, duplicates or reorders them.
It does not fabricate messages or replace REST responses. Live traces are disabled so credentials
are not written to trace artifacts. Screenshots contain synthetic fixtures only.

## Reproduce the live suite

Stop any API build/watch using this checkout before building its API, because Nest's build clears
`apps/api/dist`. Normal dev ports 3000/3001 are separate from live-test ports 3100/3301/3102.
PostgreSQL must be a disposable loopback database named `hktutor_*_test`; both the fixture script
and live Playwright config reject remote databases, schema URL overrides and missing explicit opt-in.
Never point these commands at the project's shared database.

One local Unix example, from the repository root:

```bash
chat_test_root=$(mktemp -d /tmp/hktutor-chat-XXXXXX)
initdb -D "$chat_test_root/pg" --username=hktutor_chat_test --auth=trust --no-locale --encoding=UTF8
pg_ctl -D "$chat_test_root/pg" -l "$chat_test_root/postgres.log" \
  -o "-h 127.0.0.1 -p 55439 -k $chat_test_root" -w start
createdb -h 127.0.0.1 -p 55439 -U hktutor_chat_test hktutor_s3_t03_browser_test
export DATABASE_URL=postgresql://hktutor_chat_test@127.0.0.1:55439/hktutor_s3_t03_browser_test
export HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1
pnpm install --frozen-lockfile
pnpm --filter @hktutor/api build
pnpm --filter @hktutor/api db:migrate:deploy
pnpm --filter @hktutor/api exec ts-node -r tsconfig-paths/register scripts/prepare-chat-browser-fixtures.ts
pnpm --filter @hktutor/web build
pnpm --filter @hktutor/web test:e2e:chat-live
pg_ctl -D "$chat_test_root/pg" -m fast -w stop
```

Re-run fixture preparation before each live run. It resets only the four fixed synthetic accounts'
sessions/messages and prepares three owned conversations in the opted-in disposable database.
The harness starts/stops its API, production standalone web server and same-origin proxy itself.
The launcher copies built static assets into standalone output and uses no dev-server instance.
Use a different free PostgreSQL port if 55439 is already occupied; do not stop another server.

Run the deterministic checks separately:

```bash
pnpm --filter @hktutor/web test
pnpm --filter @hktutor/web lint
pnpm --filter @hktutor/web build
pnpm --filter @hktutor/api typecheck:scripts
pnpm --filter @hktutor/web test:e2e conversations-ui.spec.ts --project=chromium --project=tablet-chromium --project=mobile-chromium
pnpm verify:workspace
```

## Recorded execution

Verified on 2026-10-31 using pnpm 11.19.0, Node 24.20.0 and a fresh PostgreSQL 14.20 cluster.
The repository's pinned Node version is 24.19.0; the local run emitted the patch-version engine warning.
All migrations were applied only to the newly created disposable cluster. No project seed, shared
database migration, external email, payment or storage write was used.

| Command / check                                                        | Actual result                                                  |
| ---------------------------------------------------------------------- | -------------------------------------------------------------- |
| `pnpm --filter @hktutor/web test`                                      | 37 files, 478 tests passed                                     |
| `pnpm --filter @hktutor/web lint`                                      | Passed, zero warnings                                          |
| `pnpm --filter @hktutor/web build`                                     | Production compilation, TypeScript and route generation passed |
| `pnpm --filter @hktutor/api typecheck:scripts`                         | Passed                                                         |
| API fixture and standalone launcher ESLint                             | Passed, zero warnings                                          |
| Targeted `test:e2e conversations-ui.spec.ts` across all three projects | 129 passed                                                     |
| `pnpm --filter @hktutor/web test:e2e:chat-live`                        | 5 passed against real services, final run 35.7 seconds         |
| `pnpm verify:workspace`                                                | 128 passed                                                     |
| Prettier on changed sources, tests, config and docs                    | Passed                                                         |

The live run includes sender exclusion, persisted read receipts, real 403/404 boundaries,
65-message multi-page recovery, reversed/duplicate frames, stopped healthy polling, real JWT expiry
and rotation, REST fallback, hidden-tab cleanup, preserved draft/scroll, room switching and logout.
Its final run uses the production standalone launcher. The deterministic suite separately proves
that an older in-flight GET cannot unlock an uncertain-send retry.

This verifies local feature behavior, not a production ingress deployment or cross-process fanout.
The temporary PostgreSQL service was stopped after verification; the ordinary dev service was
left running and its API/through-web health endpoints were checked again.
