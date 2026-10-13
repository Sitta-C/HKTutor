# S2-T09 tutor verification QA

These checks cover tutor document uploads, access control, signed previews, and admin review.
The API HTTP tests use synthetic files, isolated persistence, and a mocked Supabase transport.
Browser tests intercept API responses. No production data or credentials were used.

## Coverage

- **Uploads:** `apps/api/test/qualification-documents.e2e-spec.ts` rejects 0-byte files,
  files above 5 MiB, and requests above the Multer hard limit without creating document,
  audit, or Storage work. Exactly 5 MiB and valid PDF, JPEG, and PNG files are accepted.
  Unsupported MIME types, invalid signatures, and filename-extension mismatches are rejected.
- **Access and privacy:** The HTTP suite checks missing or invalid sessions, wrong roles,
  tutor ownership, and admin-only review. Upload, list, detail, signing, and error responses
  are checked for private object paths and service keys. Unauthorized preview requests do
  not reach Storage signing.
- **Signed previews:** API tests assert a 300-second signed URL request and audit records
  without URL tokens. Web unit tests use fixed UTC times for expired, invalid, and
  near-expiry links; browser tests cover denied previews and requesting a fresh link.
- **Review:** Both APPROVED and REJECTED decisions are checked for reviewer ID, UTC review
  time, reason, document and tutor status, and audit history. All same-decision and
  cross-decision retries return 409 `DOCUMENT_ALREADY_REVIEWED` without changing those
  records. Isolated persistence tests check rollback on failure.
- **UI and contracts:** Browser tests cover upload and review conflicts, ambiguous responses,
  and selection changes during review without stale optimistic state. Repository tests
  cover database schema and status values; Swagger and API wire contracts are unchanged.
  Web unit and browser tests cover Thai/English copy, and a component test covers
  Asia/Bangkok display. API timestamps remain UTC ISO strings.

The follow-up fixed an invalid REJECTED duplicate-review test that previously returned 400
before reaching the conflict check. It also aligned the web's 500-character review-note
limit with the API's Unicode code-point count: 500 emoji are accepted and 501 are rejected.

## Verification

Run from the repository root. These results were recorded on 2026-10-12 with Node.js
24.19.0 and pnpm 11.19.0. On Windows, `pnpm.cmd` avoids the blocked PowerShell shim.

```powershell
pnpm.cmd install --frozen-lockfile
pnpm.cmd db:generate
pnpm.cmd --filter @hktutor/api test:e2e --runInBand qualification-documents
pnpm.cmd --filter @hktutor/web exec vitest run test/qualification-model.test.ts test/qualification-components.test.ts test/qualification-api.test.ts
node --test tests/qualification-document-api-schema.test.mjs tests/tutor-document-schema.test.mjs tests/tutor-verification-status.test.mjs
pnpm.cmd --filter @hktutor/api lint
pnpm.cmd --filter @hktutor/web lint
pnpm.cmd --filter @hktutor/api build
pnpm.cmd --filter @hktutor/web build
pnpm.cmd lint:root
```

Install, Prisma generation, lint, and builds passed. The API HTTP suite passed 83/83,
web unit tests 11/11, and qualification contract tests 12/12. The web build required
network access for Google Fonts.

Playwright passed 36/36 on desktop, tablet, and mobile Chromium using the existing
Playwright configuration against a production web build. The server was started in a
separate terminal and stopped afterward:

```powershell
pnpm.cmd --filter @hktutor/web start
pnpm.cmd --filter @hktutor/web exec playwright test e2e/qualification-verification-ui.spec.ts
```

The configured `pnpm dev` server was tried first but repeatedly failed to fetch Google
Fonts in this restricted network environment. The browser tests use mocked API responses.

The four changed files passed the targeted formatting check and `git diff --check`:

```powershell
pnpm.cmd exec prettier --check apps/api/test/qualification-documents.e2e-spec.ts apps/web/src/components/qualifications/qualification-model.ts apps/web/test/qualification-model.test.ts tests/s2-t09-qa.md
git diff --check
```

The broader `pnpm.cmd format:check` run failed on 418 files in this Windows checkout.
An earlier `pnpm.cmd verify:workspace` run failed in unrelated booking, registration,
dashboard, and search contracts; it was not rerun after this documentation edit.
The qualification contract tests passed separately.

## Limits

The isolated suites do not prove private-bucket upload or signed URL expiry against
Supabase, or transaction locking under concurrent PostgreSQL requests. Those checks
require a confirmed safe test environment. No migration, seed, or data reset was run.
The change stays within S2-T09 QA and the review-note validation fix. No Trello Status,
Owner, or member assignment was changed.
