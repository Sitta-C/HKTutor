# S3-T04 chat delivery QA

Executed on 2026-11-01 (Asia/Bangkok), starting from `8cab77514c83217b62ac107f17066f19faad6af4`.
Source: [Sprint 3 Backlog, row 5](https://docs.google.com/spreadsheets/d/17RMTjXa26ho7blv-TK5pbJFbHxVHJEBRPKCXk9x5AE0/edit?gid=504754817#gid=504754817).
The current implementation, rather than the card's older baseline, is under test.

## Environment and boundaries

- Windows, Node **24.19.0**, pnpm **11.19.0**, Playwright Chromium.
- New container `hktutor-s3-t04-chat-20261101`, PostgreSQL **16 Alpine**, UTC database,
  loopback port **55448**, database **hktutor_s3_t04_test**. PostgreSQL 17's registry pull
  failed; the cached PostgreSQL 16 image was used. All **23 migrations** applied successfully.
- Production Nest API at `127.0.0.1:3301`, production standalone Next.js at `127.0.0.1:3100`,
  actual same-origin HTTP/WebSocket proxy at **http://127.0.0.1:3102**.
- Separate student/tutor browser contexts and independent REST helper sessions. Extra outsider
  and admin contexts test authorization with native browser WebSocket handshakes and REST.
- Only synthetic fixtures were written. No project seed, shared database, deployment, email,
  payment or storage provider write. Wire timestamps are UTC ISO 8601; screenshots show Bangkok time.
- The live suite uses real REST responses and server events. Its network routes close, hold,
  reorder or repeat real frames; they never fabricate message contents or successful REST responses.
  Both WebSocket and HTTP Socket.IO transports are blocked for the REST-only case.
- Traces are off for live tests. The five saved screenshots contain synthetic names, invalid-domain
  fixture emails and synthetic messages only; credentials, cookies and handshake frames are absent.

This certifies this local browser/proxy/API/PostgreSQL path. Production ingress, remote TLS and
cross-process fanout were not tested and are not certified by these results.

All five sanitized screenshots are attached in the
[PR #138 evidence comment](https://github.com/Sitta-C/HKTutor/pull/138#issuecomment-6559046547).
Screenshots are intentionally excluded from Git; the evidence links below point to the actual
GitHub attachments. Local copies remain in `tests/evidence/s3-t04`.

## Fixture identities

| Fixture                                  | Persisted ID                           |
| ---------------------------------------- | -------------------------------------- |
| Browser Student                          | `11111111-1111-4111-8111-111111111111` |
| Browser Tutor                            | `22222222-2222-4222-8222-222222222222` |
| Second Tutor                             | `33333333-3333-4333-8333-333333333333` |
| Other Student (unauthorized for primary) | `44444444-4444-4444-8444-444444444444` |
| Browser Admin                            | `55555555-5555-4555-8555-555555555555` |
| Primary student/tutor conversation       | `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa` |
| Student/second-tutor conversation        | `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb` |
| Other-student/tutor conversation         | `cccccccc-cccc-4ccc-8ccc-cccccccccccc` |
| Missing conversation probe               | `dddddddd-dddd-4ddd-8ddd-dddddddddddd` |
| Concurrent send intent                   | `eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee` |

Auth sessions and message UUIDs are generated per run. Direct SQL readback after the successful run:

| Message                    | Persisted message ID                   | UTC sent / read                                         |
| -------------------------- | -------------------------------------- | ------------------------------------------------------- |
| Live student message       | `0f1a5d97-a34d-495d-a2cb-c1e542998e5c` | `2026-11-01T13:09:15.299Z` / `2026-11-01T13:09:15.388Z` |
| One concurrent intent      | `be0c16f9-571a-45c4-a89b-7aa3a2c4a743` | `2026-11-01T13:10:17.178Z` / `2026-11-01T13:10:17.306Z` |
| Delivered by REST fallback | `4c03c9bb-a9e7-441b-8646-113841d3add3` | `2026-11-01T13:11:15.109Z` / `2026-11-01T13:11:19.344Z` |

SQL also returned **65** `Missed live` rows and **one** row for the tutor/concurrent-intent key.

## Expected versus actual

Live command: `pnpm.cmd --filter @hktutor/web test:e2e:chat-live --output test-results-chat-live/run2`.
Actual result: **8 passed (2.8m)**, no skips or retries.

| Case                                             | Expected                                                                                                                                                                                                                                          | Actual evidence                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Connect, join and committed delivery             | One student REST POST, one receiver event and one matching messageId rendered per browser; no sender event. Read acknowledgement emits only to original sender and persists readAt.                                                               | Passed; exact POST/event/receipt counters, matching DOM IDs, REST persisted history and SQL readback. [Student receipt](https://github.com/user-attachments/assets/f2d5f26b-83a0-4155-adc1-87a9bcc0f01c), [tutor receiver](https://github.com/user-attachments/assets/aa4e2170-9b80-4854-8732-fb26a99b8d22). |
| Outsider/admin and access boundaries             | Outsider socket connects but primary join is forbidden; admin handshake forbidden. Both roles receive 403 for history/send/read; foreign student history is 403 and missing history is 404. No private message fields leak.                       | Passed using real browser WebSockets and real REST guards against persisted users/conversations. Rejected writes never render. Gateway integration tests additionally assert no persistence or broadcast.                                                                                                    |
| Concurrent duplicate prevention                  | Three REST POSTs using one clientMessageId return one messageId, one recipient event and one rendered row. Changed text using the same key returns 409.                                                                                           | Passed; SQL sender/key count is one.                                                                                                                                                                                                                                                                         |
| Network loss and reconnect                       | With the student offline and REST history blocked, 65 committed messages remain unseen. A new acknowledged join releases catch-up, which drains continuing and final history pages with unique IDs.                                               | Passed; all 65 recovered once. [Reconnected history](https://github.com/user-attachments/assets/cd68a38b-6920-43fd-8bcd-02e7ce07d8a6).                                                                                                                                                                       |
| Duplicate/reordered delivery and healthy polling | Replay two real events in reverse order, repeat one, keep one row per ID in chronological order. No history polling over a 4.5-second healthy window after credential rotation.                                                                   | Passed; unique ordered DOM rows, persisted read acknowledgements and unchanged history-request counter.                                                                                                                                                                                                      |
| Expired JWT                                      | Real 20-second access expiry triggers refresh and another room join; subsequent committed messages still render once.                                                                                                                             | Passed; refresh/join counters advance and the post-expiry message is delivered. Integration tests also reject expired handshake/session credentials and disconnect idle expired sockets.                                                                                                                     |
| Session revocation                               | Server-side logout disconnects an open tutor browser. A freshly issued JWT for that revoked session fails both a new WebSocket handshake and REST with 401; another tutor session remains valid.                                                  | Passed; zero open tutor sockets, redirect to sign-in and no subsequent delivery. [Revoked session](https://github.com/user-attachments/assets/4bdcad12-dcd1-482d-af0c-314c566d92fb).                                                                                                                         |
| Fallback, hidden tabs, switch, close and logout  | REST alone delivers while both socket transports are blocked. Hidden tabs stop history requests and retain draft/scroll. Switching rooms prevents old-room delivery; closing stops sockets, joins and history requests; logout closes the socket. | Passed; [REST-only delivery](https://github.com/user-attachments/assets/8f0ac9b5-0f27-4563-ba86-d01e89ab55ba). Lifecycle unit tests assert zero retry timers, removed listeners/token subscription and ignored late acknowledgements after close/switch.                                                     |

## Exact commands and check results

Commands ran from the repository root. On this machine, PowerShell's script policy blocks `pnpm.ps1`,
so commands use `pnpm.cmd`. A temporary downloaded Node runtime supplied the pinned version:

```powershell
$env:Path = (Join-Path $env:TEMP 'hktutor-s3-t04-node') + ';' + $env:Path
pnpm.cmd install --frozen-lockfile
docker run --name hktutor-s3-t04-chat-20261101 --detach --publish 127.0.0.1:55448:5432 --env POSTGRES_USER=postgres --env POSTGRES_PASSWORD=disposable-local-only --env POSTGRES_DB=hktutor_s3_t04_test postgres:16-alpine
$env:DATABASE_URL = 'postgresql://postgres:disposable-local-only@127.0.0.1:55448/hktutor_s3_t04_test'
$env:HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY = '1'
pnpm.cmd --filter @hktutor/api build
pnpm.cmd --filter @hktutor/api db:migrate:deploy
pnpm.cmd --filter @hktutor/api exec ts-node -r tsconfig-paths/register scripts/prepare-chat-browser-fixtures.ts
pnpm.cmd --filter @hktutor/web build
pnpm.cmd --filter @hktutor/web exec playwright install chromium
$env:PWTEST_CACHE_DIR = Join-Path $env:TEMP 'hktutor-s3-t04-playwright-elevated'
pnpm.cmd --filter @hktutor/web test:e2e:chat-live --output test-results-chat-live/run2
```

Fixture preparation deletes sessions/messages only for its fixed synthetic fixtures; rerun it before
each complete live suite. Both the script and config require the disposable DB opt-in and reject
remote hosts, unsafe database names and URL query/schema overrides. The live suite honors login
`Retry-After` because six synthetic sessions share the real five-logins/minute loopback limit.
Concurrent helper requests share a single refresh so the test does not revoke itself through reuse.

The responsive suite uses an existing standalone server to avoid another application's port 3000:

```powershell
# Terminal A, after the production build:
node scripts/start-chat-browser-web.mjs
# Terminal B:
$env:PLAYWRIGHT_BASE_URL = 'http://127.0.0.1:3100'
$env:PWTEST_CACHE_DIR = Join-Path $env:TEMP 'hktutor-s3-t04-ui-playwright'
pnpm.cmd --filter @hktutor/web test:e2e conversations-ui.spec.ts --project=chromium --project=tablet-chromium --project=mobile-chromium
```

`PLAYWRIGHT_BASE_URL` changes the UI suite's base URL and reuse probe; its default remains port 3000.
Start the selected server first when overriding it. Live tests retain their separate fixed proxy origin.
The chat fixture cookie follows that base URL, and screenshots use Playwright's per-test output
directory rather than an operating-system-specific absolute path.

The complete check used a separate temporary directory to avoid sharing sandbox-owned Jest caches:

```powershell
$chatRuntime = Join-Path $env:TEMP 'hktutor-s3-t04-node'
$chatCheckTemp = Join-Path $env:TEMP 'hktutor-s3-t04-check'
New-Item -ItemType Directory -Force -Path $chatCheckTemp | Out-Null
$env:Path = $chatRuntime + ';' + $env:Path
$env:TEMP = $chatCheckTemp
$env:TMP = $chatCheckTemp
pnpm.cmd check
```

| Command                                                                                                                                                                      | Actual result                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `pnpm.cmd --filter @hktutor/api test --runInBand test/unit/conversations test/unit/auth`                                                                                     | 18 suites, 313 passed                                        |
| `pnpm.cmd --filter @hktutor/api test:e2e --runInBand --runTestsByPath test/conversations-socket.e2e-spec.ts test/conversations.e2e-spec.ts test/auth-controller.e2e-spec.ts` | 3 suites, 139 passed                                         |
| `pnpm.cmd --filter @hktutor/web test`                                                                                                                                        | 37 files, 473 passed                                         |
| `pnpm.cmd --filter @hktutor/api lint`                                                                                                                                        | Passed                                                       |
| `pnpm.cmd --filter @hktutor/web lint`                                                                                                                                        | Passed, including final harness changes                      |
| `pnpm.cmd --filter @hktutor/api build`                                                                                                                                       | Passed, including Prisma generation and script types         |
| `pnpm.cmd --filter @hktutor/web build`                                                                                                                                       | Passed, including TypeScript and route generation            |
| Responsive chat Playwright command above                                                                                                                                     | 141 passed (1.7m), desktop/tablet/mobile                     |
| `pnpm.cmd check`                                                                                                                                                             | Passed: format, lint, 1,405 API + 473 web tests, both builds |
| `pnpm.cmd verify:workspace`                                                                                                                                                  | 128 passed after local LF normalization                      |

Initial environment-only failures: the sandbox blocked Google Fonts during the first web build;
the network-enabled rerun passed. Windows checkout CRLF caused formatting warnings and one contract
failure; local line endings were normalized to the repository's LF policy without content changes.
The first extended live run exposed concurrent refresh in the REST test helper; the corrected run
passed all eight cases. Its sandboxed Windows teardown left test servers running; only those
inspected task processes were stopped before the final run with an isolated Playwright cache.
The first responsive run used a cookie for another host; the fixture now follows the configured
origin. A subsequent run passed 138 cases but three screenshot saves failed at a macOS-only path;
using `testInfo.outputPath` resolved those failures, and all 141 passed in the final run.
The first complete check reached unit tests but could not write the earlier sandbox's Jest cache;
the isolated-temp command above was then used for the final check.
That cold-cache run passed 74 API suites but timed out in the existing five-second auth Swagger
setup hook. After the browser workloads stopped, the warm-cache rerun passed all 75 API suites
(1,405 tests) and all 37 web files (473 tests), without changing that hook or its timeout.
No failed or unexecuted run is counted as a pass above.

The task's test servers and disposable database container were stopped after verification.
The stopped container retains only the synthetic fixtures for optional inspection. No unrelated
running application or database container was changed.
