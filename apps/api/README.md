# HKTutor API

NestJS 11 API using Prisma/PostgreSQL, local email/password authentication, JWT access tokens,
rotating refresh sessions, and Resend verification email.

Run commands from the repository root:

```bash
pnpm --filter @hktutor/api dev
pnpm --filter @hktutor/api test
pnpm --filter @hktutor/api build
```

All controller routes receive the global `/api/v1` prefix. Authentication endpoints are under
`/api/v1/auth`:

- `POST /register`
- `POST /verify-email`
- `POST /resend-verification`
- `POST /login`
- `POST /refresh`
- `POST /logout`
- `GET /me`

## Source layout

- `src/modules/` contains runtime features: auth, bookings, health, profiles,
  qualification-documents, and tutors.
- `src/infrastructure/` contains technical adapters shared by features: database, email, and storage.
- `src/common/` and `src/config/` contain cross-feature utilities and configuration.
- `src/generated/` contains generated Prisma code and must not be edited manually.
- `docs/examples/` contains documentation-only NestJS examples that are not registered at runtime.
- `scripts/` contains operational scripts that are type-checked separately from the Nest build.

Use the matching absolute alias when importing application code: `@app/*`, `@modules/*`,
`@infrastructure/*`, `@common/*`, `@config/*`, `@generated/*`, or `@examples/*`. Keep each feature
directory flat until its size makes a further split clearly useful.

Access tokens are Bearer JWTs. Refresh tokens are never returned in JSON; they are stored in an
HttpOnly cookie and rotated against hashed `AuthSession` records.

Protect an endpoint and restrict its roles by running authentication before authorization:

```ts
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Get('admin-only')
readAdminResource(@CurrentUser() user: AuthenticatedUser) {
  return { userId: user.id, role: user.role };
}
```

`JwtAuthGuard` verifies the token and active session first. `RolesGuard` then compares the latest
database-backed role attached to `request.auth`. A missing login returns 401; a logged-in user with
the wrong role returns 403. Routes without `@Roles(...)` are not role-restricted.

Configure the API through the root `.env.example`. Startup rejects missing or placeholder JWT,
Resend, and sender values outside the test environment. The access and refresh secrets must be
different and at least 32 characters.

## Database

Generate and validate the Prisma schema without changing a database:

```bash
pnpm db:generate
pnpm db:validate
```

The local-auth migration is a one-shot demo migration that deletes existing identity-owned demo
records before replacing the external identity fields. Do not apply it to a database containing
data that must be retained.

Tutor qualification uploads persist only private-storage metadata in `TutorDocument`; file bytes
remain outside PostgreSQL. The database accepts PDF, JPEG, or PNG metadata up to 5 MiB, keeps the
private object path unique, and permits only an administrator to move a pending review to verified
or rejected. Public or signed download URLs must remain transient and are never stored in this
table.

Chat persistence uses `Conversation` and `Message` with canonical `User.id` references for the
student, tutor, and sender. The database enforces one conversation per student-tutor pair, rejects
non-participant senders, and de-duplicates retries by sender and `clientMessageId`. Message cursor
indexes support both ID and UTC `sentAt` ordering; API handlers must still perform participant
authorization and map expected uniqueness conflicts to the appropriate HTTP response.

After confirming the target is disposable and filling the seed email/password values:

```bash
pnpm db:migrate:status
pnpm db:migrate:deploy
pnpm db:seed
```

The optional `db:verify:sprint1` command runs only against an explicitly approved local disposable
database; see the repository README for its safety gate.

## Storage service

`StorageModule` in `src/infrastructure/storage` exports an injectable `StorageService` for feature
modules. Import `StorageModule` in each module that needs storage. The infrastructure service does
not expose HTTP endpoints or persist database records; controllers and feature services must check
JWT authentication, roles, ownership, current privacy consent, and allowed domain state before
calling it. Pass the authenticated user's UUID to uploads, never an untrusted body/query user ID.

Configure these server-only values in the root `.env` (also forwarded only to the API by Compose):

- `SUPABASE_URL`: HTTPS project origin; HTTP is accepted only for loopback local Supabase.
- `SUPABASE_SECRET_KEY`: backend `sb_secret_` key. The SDK runs without persisted Auth sessions.
- `SUPABASE_AVATAR_BUCKET` and `SUPABASE_DOCUMENT_BUCKET`: different bucket names, using lowercase
  letters, digits, hyphens or underscores, at most 63 characters. Startup rejects missing values,
  placeholders, invalid origins, non-secret keys, and duplicate bucket names.

Create/configure the buckets beforehand; application startup does not create buckets or change
Storage policies. Set the global Storage file limit to at least 5 MiB and bucket limits as follows:

| Purpose  | Maximum bytes   | Allowed MIME types                           | Access                          |
| -------- | --------------- | -------------------------------------------- | ------------------------------- |
| Avatar   | 2097152 (2 MiB) | `image/jpeg`, `image/png`, `image/webp`      | Public only for public profiles |
| Document | 5242880 (5 MiB) | `application/pdf`, `image/jpeg`, `image/png` | Private                         |

Secret keys bypass RLS, so do not add broad anonymous/authenticated upload or document-read policies.
Review existing policies too. The service checks document bucket privacy before uploading or
signing a document URL and refuses a public bucket. SDK requests time out after 15 seconds.

Service methods:

- `uploadAvatar(ownerUserId, { buffer, mimeType })` and
  `uploadDocument(ownerUserId, { buffer, mimeType })`: reject empty/oversized files and unsupported
  or mismatched MIME signatures; return `{ objectPath, mimeType, sizeBytes }`. Paths are generated
  as `<user UUID>/<random UUID>.<detected extension>` with overwrites disabled. The caller can pass
  a multipart file's `buffer` and `mimetype`; never use its filename to construct the object path.
- `prepareDocument(ownerUserId, file)` validates and reserves a unique path without network I/O;
  `uploadPrepared(prepared)` uploads at that exact path. The qualification feature persists its
  recovery intent between these calls so ambiguous Storage failures remain recoverable.
- `remove('avatar' | 'document', objectPath)`: remove the specified object, including cleanup after
  a failed metadata write. This method does not check domain ownership.
- `getAvatarPublicUrl(objectPath)`: compute the public avatar URL. Use only when the avatar bucket
  is public; this method does not query Supabase or verify that the object exists.
- `createSignedUrl('avatar' | 'document', objectPath, expiresIn?)`: create a transient download URL
  after the feature has authorized access. Lifetime defaults to 300 seconds and must be 1–300.
  Anyone holding the URL can use it until expiry. This also supports private avatar buckets.

The byte-signature check detects file types; it does not fully parse files, strip image metadata,
resize images, or scan for malware. A future avatar endpoint should decode/re-encode images as
needed and restrict multipart file count/size before buffering; document endpoints should apply
their own review and retention rules. Original names remain feature metadata. Storage provider
errors and network exceptions become sanitized 503 responses; invalid files/paths produce 400
and oversized buffers produce 413.

Persist object paths and file metadata, not signed URLs. Storage and Prisma writes are not one
transaction: if metadata persistence fails after upload, delete the newly uploaded object and
arrange retries for cleanup failures. For avatar replacement, save the new reference before
deleting the old object. No avatar/database schema or upload/review endpoints are added by this
infrastructure module. `TutorDocument` currently models tutor qualification documents; broader
identity-verification requirements need their own domain/schema decision.

Unit tests exercise the real SDK against a mocked HTTP transport; they do not call live buckets.
Before releasing an upload feature, use synthetic files in the intended Supabase environment to
verify upload/download/delete, bucket restrictions, blocked unauthenticated document access, and
short-lived signed downloads.

## Qualification document API (S2-T07)

The `qualification-documents` feature imports the shared Storage service. It implements the parent
[S2-T07 card](https://trello.com/c/9sRBSvot) and its seven endpoint cards:

| Card                                    | Method and route (all under `/api/v1`)                          | Access       |
| --------------------------------------- | --------------------------------------------------------------- | ------------ |
| [API-01](https://trello.com/c/1GvPZaue) | `POST /tutors/me/qualification-documents`                       | TUTOR        |
| [API-02](https://trello.com/c/TBGIYMnx) | `GET /tutors/me/qualification-documents`                        | TUTOR        |
| [API-03](https://trello.com/c/NESH78DY) | `GET /tutors/me/qualification-documents/:documentId/signed-url` | Owning TUTOR |
| [API-04](https://trello.com/c/0KvS9Aw1) | `GET /admin/tutor-verifications`                                | ADMIN        |
| [API-05](https://trello.com/c/oUj5OkTe) | `GET /admin/tutor-verifications/:documentId`                    | ADMIN        |
| [API-06](https://trello.com/c/JUPjBjwD) | `GET /admin/tutor-verifications/:documentId/signed-url`         | ADMIN        |
| [API-07](https://trello.com/c/EmD1McpO) | `PATCH /admin/tutor-verifications/:documentId`                  | ADMIN        |

JWT authentication runs before role and ownership checks. Tutor operations require an active tutor
profile and the current privacy policy consent. Records belonging to deleted, inactive, or no
longer tutor accounts are excluded. Tutor IDs and reviewer IDs come from the authenticated user.

Upload uses multipart fields `file` and `documentType`. The initial allowed types are `DEGREE` and
`CERTIFICATE`, matching the qualification form's degree/certificate categories. Only PDF, JPEG,
and PNG with matching byte signatures are accepted, with an inclusive maximum of 5 MiB
(5242880 bytes). Empty files, unsupported types, excess bytes, unknown fields, multiple files,
and invalid document types return 400. The API maps the infrastructure's oversize 413 to this
card's 400 contract. Stored paths contain generated UUIDs, never original filenames. One pending
document per tutor and document type is allowed; a competing upload returns 409. After a completed
review, that type may be uploaded again. UTF-8 filenames, including Thai, are preserved. Uploads
recompute the aggregate profile state using the same rule as reviews.

The 201 upload response is `{documentId,status,fileName,mimeType,size,createdAt}`. Lists contain
`{items}` with exactly `documentId,type,status,reviewedAt,rejectionReason` per item. The admin queue
and detail additionally include safe file metadata.
The tutor list supports optional `status`. All qualification status filters and responses use
`PENDING | APPROVED | REJECTED`; `APPROVED` maps to the existing database `VERIFIED` enum. Tutor
profile `verificationStatus` retains its existing `PENDING | VERIFIED | REJECTED` contract.
Legacy document category strings remain readable; new uploads accept only the two types above.
Metadata responses never contain `objectPath`, public download URLs, or service credentials.

The admin queue supports `status`, `cursor`, and `limit`, returning `{items,nextCursor}`. It defaults
to `PENDING` and 20 rows, accepts limits 1–100, and orders by descending `createdAt`, then `id`.
Pass the returned cursor unchanged with the same status filter; invalid or mismatched cursors
return 400. This is keyset pagination rather than a snapshot of a changing review queue. Each
item's tutor data is limited to `userId`, `displayName`, and `verificationStatus`. Detail returns
`{document,tutor,reviewHistory}`; completed reviews predating the audit table use their existing
immutable reviewer/time/rejection fields as historical evidence.

Signed URL endpoints return `{url,expiresAt}`, use `Cache-Control: no-store`, and request a
300-second Storage lifetime. Times are UTC ISO 8601. `expiresAt` is measured before the Storage
request so it is conservative. Issuing a URL writes a `SIGNED_URL_ISSUED` audit event containing
the document, actor, issue time, and expiry; the URL is returned only after auditing succeeds.
Audit rows never persist the URL/token. Wrong tutor ownership returns 403, missing records 404,
and invalid UUIDs 400. A URL holder can access the document until Storage expiry; do not persist,
log, or share signed URLs. Issuance is audited; subsequent downloads from Supabase are not API
access events.

Review body is `{decision: "APPROVED" | "REJECTED", reason?: string}`. A rejection requires a
trimmed reason of 1–500 characters; an approval may include a note of the same length. A completed
document cannot be reviewed again (409). A transaction locks the tutor profile row, conditionally
updates the pending document, updates tutor verification, and inserts one immutable `REVIEWED`
audit event. The profile is `VERIFIED` when any document is approved; otherwise `PENDING` when any
document is pending; otherwise `REJECTED`. Rejecting another document cannot revoke existing
approved evidence. Uploads and reviews for the same tutor serialize on the profile lock. The response is
`{documentId,status,reviewedAt,reviewedBy,tutorVerificationStatus}`. Approval notes live in the
audit history; `rejectionReason` remains null on approved documents. Persistence failures roll
back the entire review and return a sanitized 503.

Uploads persist a `QualificationUploadIntent` before Storage I/O. Metadata, the `UPLOADED` audit,
aggregate profile state, and intent consumption share one transaction. A failed metadata write
attempts immediate cleanup. Storage timeouts keep their intent for recovery because the remote
upload may have completed. A background worker checks up to five intents each minute, starting
five minutes after an abandoned upload, and retries failed cleanup each minute. Work survives API
restarts; monitor intent age/attempt counts and static recovery error logs for persistent outages.
The worker locks each intent with `FOR UPDATE SKIP LOCKED`, checks document references, and only
deletes unreferenced objects. Finalization locks the same intent, preventing deletion of committed
files even if a commit acknowledgement is lost. Paths stay server-side and are never logged.
PostgreSQL and Supabase cannot share an atomic transaction; objects orphaned before this recovery
mechanism or created outside the API still require operator reconciliation.

Every route validates query fields, including routes that accept no query parameters. Unknown
fields return 400. Unexpected errors return the same `{statusCode,error,message,code}` envelope
with a generic 500 message and static logging, without provider details.

### Migration and rollout

`20261006150000_qualification_document_api` is a new forward migration. It adds the partial unique
index for pending uploads and `TutorDocumentAudit` with foreign keys, bounded audit evidence,
one-review uniqueness, and an append-only trigger. It preserves previous migrations and data.
`20261006200000_qualification_upload_recovery` adds the durable upload intent table and reconciles
existing tutor profile statuses from their document reviews. It preserves document and audit
evidence, and leaves profiles without documents unchanged. Apply with qualification writes paused,
then start the updated API so the background worker can recover abandoned uploads.
`20261006201000_protect_qualification_metadata` enables RLS on all three qualification tables
and revokes direct access from `PUBLIC`, `anon`, and `authenticated`. Application authorization
remains in Nest; Prisma connects as the migration/table owner. Do not grant Supabase browser roles
direct access to these private metadata/audit/recovery tables.
Before deploying, inspect duplicate pending types with this read-only query and resolve them
deliberately; the migration fails rather than deleting records automatically:

```sql
SELECT "tutorUserId", "documentType", COUNT(*)
FROM "TutorDocument"
WHERE "reviewStatus" = 'pending'
GROUP BY "tutorUserId", "documentType"
HAVING COUNT(*) > 1;
```

Apply the pending migration to the confirmed target before starting this API version, using the
repository's established migration deployment process. No new environment variables are needed.
The document bucket must be private with the exact MIME allowlist and size limit above. After
deployment, verify synthetic uploads, tutor ownership, admin preview/review, and signed URL
expiry in the intended environment. Do not run the seed against retained data.

### Verification

```bash
pnpm --filter @hktutor/api test --runInBand qualification-documents
pnpm --filter @hktutor/api test:e2e --runInBand qualification-documents
pnpm verify:workspace
pnpm check
```

The HTTP suite runs real validation, JWT/session/role/ownership guards, feature services, and the
Storage SDK with isolated database and HTTP transports. It covers the seven contracts, byte-size
boundaries, spoofed MIME signatures, authorization, pagination, audit failures, conditional review
contention, and transactional failure propagation. Its persistence double models rollback; it does
not prove PostgreSQL locks or Supabase expiry against live services. The SQL contract tests protect
the migration invariants. Swagger and shared web wire types describe the API; frontend upload and
admin review screens remain the separate S2-T08 task.

For PostgreSQL concurrency and rollback verification, create an empty disposable loopback database
whose name matches `hktutor_*_test`, apply migrations, then run:

```bash
HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 pnpm db:verify:qualifications
```

Set `DATABASE_URL` explicitly to that disposable database for both commands. The script refuses
remote hosts and lacks any seed dependency. It tests real upload/review contention, aggregate
status, audit-trigger rollback, cleanup retries, reference protection, worker locking, and migration reconciliation with a
simulated Storage transport. It inserts test actors/documents and retains immutable audit evidence;
discard the test database afterward. It does not test live Supabase URL expiry.

## Private availability range queries

`GET /api/v1/tutors/me/availability` accepts optional UTC `from` and `to` bounds. By default it
filters slot start times (`from <= startAtUtc < to`). Opt into `rangeMode=overlap` to include
slots spanning the range (`endAtUtc > from` and `startAtUtc < to`); omitted bounds are unrestricted.
This mode excludes slots ending exactly at `from` or starting exactly at `to`. It retains tutor
ownership, soft-delete filtering, and derived reservation states. The public availability endpoint
keeps its existing future-start behavior and does not accept `rangeMode`.
