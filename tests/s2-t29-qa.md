# S2-T29 notification inbox API evidence

Verified on 2026-10-17 with Node.js 24.19.0 and pnpm 11.19.0.

## Scope

Implements the three S2-T29 Trello endpoint contracts using the existing S2-DB05 Notification
table and S2-T28 module. No migration, UI, event-writer change or external delivery is included.

| Contract                                                            | Evidence                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authenticated owner-only list, mark-one and mark-all                | `apps/api/test/notifications.e2e-spec.ts` uses the real JWT guard, validation pipe, controller and service with mocked persistence; caller identity comes from the session                                                                   |
| Bounded cursor, unread filter/count and UTC wire values             | New service unit tests verify scoped filters, both timestamp/ID boundary fields, lookahead, final-page behavior, snapshot isolation option and date mapping; HTTP tests validate defaults, true/false conversion and malformed/unknown input |
| Reject wrong-recipient/missing IDs without content disclosure       | Unit and HTTP cases cover 403 versus 404; the service checks existence only after an owner-scoped update matches nothing                                                                                                                     |
| Preserve first read time and restrict bulk reads to own unread rows | The implementation uses parameterized SQL, COALESCE for mark-one, and userId/readAt predicates for mark-all; tests verify bindings and response mapping, including a bulk no-op                                                              |
| Swagger response contracts                                          | HTTP test reads the generated OpenAPI document and verifies all three paths and response schema references                                                                                                                                   |
| Shared module registration                                          | Temporary isolated-review smoke test compiled BookingsModule, RescheduleRequestsModule and NotificationsModule together, with persistence/guards replaced, and resolved the new controller and service                                       |

The notification unit suites passed 50 cases, including 26 new inbox-service/cursor cases. The
new HTTP suite passed 35 cases. These persistence doubles do not execute SQL or prove database
receipt preservation, snapshot isolation, or concurrent-read behavior. A new real-PostgreSQL
concurrent-read check was explicitly skipped as requested. No database was migrated or seeded.

## Verification results

| Check                                              | Result                                                                                                                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`                                       | Passed Prisma generation, formatting, all lint, 63 API unit suites / 1,202 cases, 32 web test files / 345 cases, both production builds and API script typechecking |
| `pnpm --filter @hktutor/api test:e2e --runInBand`  | All 21 suites / 433 cases passed, including the new 35-case notification suite                                                                                      |
| Isolated review snapshot                           | Reran the 26 new service/cursor cases, one temporary module-registration test and the cursor-range regression reproducer: 28 passed                                 |
| `git diff --check`                                 | Passed                                                                                                                                                              |
| `pnpm verify:workspace`                            | 24 files passed; the same five existing files remain failing, described below                                                                                       |
| Ad-hoc API TypeScript check including test sources | Still fails in existing tests; no diagnostic names a new notification file. Supported production/script builds pass                                                 |

The first lint run identified four unused validation-only controller parameters. These were
fixed before the successful full check. No lint rule or test assertion was weakened.

## Existing failures and review limits

The repository contract runner still fails in `booking-flow-web.test.mjs`,
`privacy-consent-foundation.test.mjs`, `s1-t26-integration-flow.test.mjs`,
`tutor-search-web.test.mjs` and `code-quality-config.test.mjs`. The same five files failed before
T29. Their previously inspected failures concern older UI source-pattern expectations and lint
subprocess behavior; T29 changes neither those tests nor their failing UI/configuration files.
This runner is separate from `pnpm check`; its failure is not an API HTTP-test failure.

Preliminary self-review used an immutable patch in a separate temporary Git worktree, then removed
the worktree. Review covered JWT-derived identity, every recipient predicate, SQL parameterization,
403/404 information disclosure, read-time constraints, repeated-read semantics, cursor decoding,
timestamp ties, field selection and module wiring. Review first reproduced a forged cursor with
an extreme BC date being accepted by the decoder. Such a date is outside PostgreSQL's timestamp
range and could otherwise reach persistence instead of returning a validation error. The fix
accepts only canonical UTC boundaries with years 0001–9999; unit and HTTP regression cases pass.
See the [PostgreSQL timestamp ranges](https://www.postgresql.org/docs/17/datatype-datetime.html).
No further confirmed blocking issue was found. This is not a substitute for independent PR review
or real-database verification.

Implementation choices where the cards give no exact value: list defaults to 20 with a maximum
of 50; ordering is newest-first; cursors encode both immutable sort fields and need no existing
anchor row; unreadCount covers the whole inbox; mark-all returns readAt=null when it updates no
row. These choices are documented in the API README and Swagger. All authenticated roles can
access only their own inbox; there is no administrator override.
