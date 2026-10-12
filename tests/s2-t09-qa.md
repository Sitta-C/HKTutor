# S2-T09 qualification verification QA

Checked on 2026-10-12. The HTTP suite exercises Nest validation, JWT/session/role/ownership
guards, the qualification service, and the Supabase Storage SDK with isolated database and HTTP
transports. Browser tests intercept API responses. They do not verify a live private bucket or real
PostgreSQL transaction locks.

## Coverage

| Requirement                                              | Evidence                                                                                                                                                                                                                                    |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 bytes; exactly 5 MiB; one byte over; PDF/JPEG/PNG      | HTTP upload tests assert status, persisted size, upload audit, and no persistence on rejection.                                                                                                                                             |
| Unsupported MIME, byte signature, and filename extension | HTTP tests reject WebP/SVG, spoofed content, and mismatched or unsupported extensions; web unit/browser tests reject mismatched extensions before POST.                                                                                     |
| Tutor ownership and admin-only review                    | HTTP route matrix checks missing/invalid sessions and wrong roles before database or Storage work; foreign tutor preview returns 403 before signing.                                                                                        |
| Expired signed URL                                       | HTTP test checks UTC `expiresAt`, 300-second signing request, and expiry audit without URL/token persistence. Web unit/browser tests reject expired links and request a fresh URL. Actual Supabase expiry remains a live-environment check. |
| Private metadata and service key                         | Upload, list, queue, detail, and signing responses are checked for object paths/service keys; signed URLs are returned only to authorized callers and are not written to audit records.                                                     |
| Approve/reject and conflicts                             | HTTP tests check document/profile/audit fields and later detail for both decisions, 409 on second review, and rollback on persistence failure. Browser tests check both decision flows and stale-state reconciliation.                      |
| UTC/Bangkok                                              | HTTP assertions require UTC ISO timestamps. Existing web component test checks Bangkok display of review time.                                                                                                                              |

## Commands and results

Run from the repository root on Windows. `pnpm.cmd` is used because PowerShell script execution
blocks `pnpm.ps1` on this machine.

| Command                                                                                                                                                | Result                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm.cmd --filter @hktutor/api test:e2e --runInBand qualification-documents`                                                                          | Passed: 81/81 tests.                                                                                                                                  |
| `pnpm.cmd --filter @hktutor/web exec vitest run test/qualification-model.test.ts test/qualification-components.test.ts test/qualification-api.test.ts` | Passed: 9/9 tests.                                                                                                                                    |
| `node --test tests/qualification-document-api-schema.test.mjs tests/tutor-document-schema.test.mjs tests/tutor-verification-status.test.mjs`           | Passed: 12/12 tests.                                                                                                                                  |
| `pnpm.cmd --filter @hktutor/web start` followed by `pnpm.cmd --filter @hktutor/web exec playwright test e2e/qualification-verification-ui.spec.ts`     | Passed: 36/36 across desktop, tablet, and mobile Chromium; server stopped afterward.                                                                  |
| `pnpm.cmd --filter @hktutor/api lint` and `pnpm.cmd --filter @hktutor/web lint`                                                                        | Both passed.                                                                                                                                          |
| `pnpm.cmd --filter @hktutor/api build` and `pnpm.cmd --filter @hktutor/web build`                                                                      | Both passed; web build needed network access for Google Fonts.                                                                                        |
| `pnpm.cmd exec prettier --check` on the nine changed code/documentation files                                                                          | Passed.                                                                                                                                               |
| `pnpm.cmd format:check`                                                                                                                                | Failed on 421 files in this Windows checkout; the nine changed files pass a targeted check.                                                           |
| `pnpm.cmd verify:workspace`                                                                                                                            | 111 passed, 7 failed in unrelated booking, registration, dashboard, search, and CI contract tests. The three qualification contract files above pass. |

The exact targeted formatting command was:

```powershell
pnpm.cmd exec prettier --check apps/api/README.md apps/api/src/modules/qualification-documents/qualification-documents.service.ts apps/api/src/modules/qualification-documents/qualification-documents.swagger.ts apps/api/test/qualification-documents.e2e-spec.ts apps/web/src/components/qualifications/qualification-copy.ts apps/web/src/components/qualifications/qualification-model.ts apps/web/test/qualification-model.test.ts apps/web/e2e/qualification-verification-ui.spec.ts tests/s2-t09-qa.md
```

It passed. The local runtime is Node.js 22.18.0; the repository specifies Node.js 24.19.0. No real Supabase
bucket or disposable PostgreSQL target was configured after the fresh checkout, so live Storage
expiry and database-backed concurrency checks were not run. Use synthetic files and a confirmed
safe target for those checks; do not run seed against retained data.
