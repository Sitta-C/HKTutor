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

- `src/modules/` contains runtime features: auth, avatars, bookings, health, profiles,
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

| Purpose  | Maximum bytes   | Allowed MIME types                           | Access                |
| -------- | --------------- | -------------------------------------------- | --------------------- |
| Avatar   | 2097152 (2 MiB) | `image/webp` (normalized)                    | Private (signed URLs) |
| Document | 5242880 (5 MiB) | `application/pdf`, `image/jpeg`, `image/png` | Private               |

Secret keys bypass RLS, so do not add broad anonymous/authenticated upload or document-read policies.
Review existing policies too. The document service checks its bucket privacy before upload/signing;
the avatar feature also requires a private avatar bucket before upload/signing. Public buckets are
rejected. SDK requests time out after 15 seconds.

Service methods:

- `uploadAvatar(ownerUserId, { buffer, mimeType })` and
  `uploadDocument(ownerUserId, { buffer, mimeType })`: reject empty/oversized files and unsupported
  or mismatched MIME signatures; return `{ objectPath, mimeType, sizeBytes }`. Paths are generated
  as `<user UUID>/<random UUID>.<detected extension>` with overwrites disabled. The caller can pass
  a multipart file's `buffer` and `mimetype`; never use its filename to construct the object path.
- `prepareAvatar(ownerUserId, file)` and `prepareDocument(ownerUserId, file)` validate and reserve
  a unique path without network I/O;
  `uploadPrepared(prepared)` uploads at that exact path. Each upload feature persists its
  recovery intent between these calls so ambiguous Storage failures remain recoverable.
- `remove('avatar' | 'document', objectPath)`: remove the specified object, including cleanup after
  a failed metadata write. This method does not check domain ownership.
- `getAvatarPublicUrl(objectPath)`: compute the public avatar URL. Use only when the avatar bucket
  is public; this method does not query Supabase or verify that the object exists.
- `createSignedUrl('avatar' | 'document', objectPath, expiresIn?)`: create a transient download URL
  after the feature has authorized access. Lifetime defaults to 300 seconds and must be 1–300.
  Anyone holding the URL can use it until expiry. This also supports private avatar buckets.

The byte-signature check detects file types; it does not fully parse files, strip image metadata,
resize images, or scan for malware. The avatar feature decodes/re-encodes images and restricts
multipart file count/size before buffering; document endpoints should apply
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

CI booking verification starts the full API against disposable PostgreSQL. Its workflow supplies
test-only Storage configuration (`storage.example.test`, a dummy secret key, and distinct dummy
bucket names) to satisfy startup validation; the booking probe does not call live Storage. Keep
real Supabase credentials out of this job.

## Student and tutor avatars

Avatar metadata is nullable directly on `User`: `avatarObjectPath`, `avatarMimeType`,
`avatarSizeBytes`, and `avatarUpdatedAt`. The forward migration
`20261006210000_add_user_avatar` adds these columns without changing existing account/profile data.
A check requires either all-null metadata or a positive, bounded WebP file owned by that user;
object paths are unique. Photo presence does not affect onboarding completeness or verification.
`StorageCleanupIntent` is the shared durable cleanup queue for avatars and qualification documents;
it is not file history. A `purpose` discriminator selects the reference check and private bucket,
while the composite key `(purpose, objectPath)` prevents collisions across buckets. Its table enables
RLS and revokes access from `PUBLIC` and Supabase browser roles; Prisma must use the owner/backend role.

| Method and route (under `/api/v1`) | Contract                                                                |
| ---------------------------------- | ----------------------------------------------------------------------- |
| `GET /profiles/me/avatar`          | Owner-only `{ avatar: { url, expiresAt, updatedAt } \| null }`          |
| `POST /profiles/me/avatar`         | One multipart `file`; 201 `{ avatarUpdatedAt }` after metadata commits  |
| `DELETE /profiles/me/avatar`       | 200 `{ avatarUpdatedAt: null }`; repeated removal succeeds              |
| `GET /tutors/:tutorId/avatar`      | Anonymous read only for tutors passing existing public visibility rules |

Owner routes require JWT authentication, student/tutor role, an active non-deleted account, and
current privacy consent. The user ID comes from the session; no body/query owner ID is accepted.
Uploads are available before the role-specific profile row is created. Admins cannot use these
owner routes, and there is no public student avatar endpoint. Public tutor reads use the same
verified/active/non-deleted/tutor-role filter as the directory. Private URL responses use
`Cache-Control: private, no-store`. Signing failure does not break profile or directory reads.

Upload accepts exactly one JPEG, PNG, or static WebP up to and including 2097152 bytes (2 MiB),
without extra multipart fields. Empty/missing, unsupported, MIME-mismatched, animated, undecodable,
and images above 16 megapixels return 400; oversized uploads return 413. Upload attempts are limited
to ten per minute per IP (429). Sharp applies EXIF orientation, centers/crops within 512×512 without
upscaling, and encodes WebP at quality 82 without retaining EXIF/location metadata. Original filenames
are not persisted or used in paths. Storage failures are sanitized 503s.

Set `SUPABASE_AVATAR_BUCKET` to a pre-created **private** bucket accepting `image/webp` with a
2097152-byte limit. Do not switch an existing public bucket blindly; use a separate private bucket
if its existing consumers require public access. No browser upload/read policies are needed.
URLs are signed for at most 300 seconds and remain bearer links until expiry; never persist them.
`GET /profiles/me`, tutor search, and tutor detail expose nullable `avatarUpdatedAt` as a version;
the web fetches signed URLs separately, deduplicates requests, renews before expiry/on visibility,
and shows initials if files are absent or fail to load. Photo mutations update the owner's in-memory
profile cache without overwriting unsaved profile fields. This version has no crop/zoom editor.

Uploads persist a unique cleanup intent before Storage I/O. Finalization serializes on the `User`
row, checks ownership/consent again, locks the intent, then installs the new reference and queues the
old path in one transaction. The new intent is consumed in that transaction. Deletion clears all
metadata and queues the former reference atomically. Concurrent writes cannot accidentally queue
the new current image for deletion. An ambiguous upload/metadata outcome retains its intent;
recovery checks references under the intent lock before deleting an object.

Mutations trigger one bounded recovery batch for due work. Abandoned uploads become eligible after
five minutes; failed cleanup becomes eligible again after one minute. Intents survive restarts.
Following the existing centralized-scheduler direction, API startup does not register a timer.
Operators (or a future scheduler) can run one batch of at most five objects:

```bash
pnpm storage:recover
```

The command uses configured backend database/Storage credentials and deletes only due, unreferenced
avatar or qualification-document objects. The purpose is mapped to a server-defined bucket; bucket
names never come from requests or queue rows. Repeat batches to drain the queue and monitor pending
age/attempts. The command returns a nonzero exit code on recovery failure. Logs never include
provider errors, object paths, URLs, or secrets.

Before starting the updated API, apply the new migration to a confirmed target using the established
migration process and configure the private bucket. Live bucket verification must use synthetic
files to check upload/sign/download/delete, refusal of a public bucket, blocked anonymous direct
reads, student privacy, and eligible tutor visibility. Unit/API/browser checks use mocked Storage
and are not evidence that the intended Supabase bucket is configured correctly.

The optional real PostgreSQL constraint/concurrency probe uses simulated Storage and requires an
explicitly opted-in disposable loopback database named `hktutor_*_test`, with migrations applied:

```bash
HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 pnpm db:verify:avatars
```

It creates and removes only its synthetic accounts/intents and checks concurrent upload/deletion,
metadata constraints, ambiguous uploads, reference protection, and cleanup retry. Never run it
against a shared or production database.

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

Uploads persist a qualification-document row in the shared `StorageCleanupIntent` queue before
Storage I/O. Metadata, the `UPLOADED` audit, aggregate profile state, and intent consumption share
one transaction. A failed metadata write
attempts immediate cleanup. Storage timeouts keep their intent for recovery because the remote
upload may have completed. Automatic background recovery is deferred until the centralized cron
scheduler is implemented: API startup does not register a timer or poll the recovery queue.
Immediate cleanup after metadata failure remains active. Persisted intents survive restarts;
abandoned uploads are retained until recovery is explicitly invoked. The shared cleanup service's
`recoverPending()` entry point handles up to five due intents per call for future scheduler/operator
use. New intents
become due after five minutes; a failed cleanup reschedules eligibility by one minute, but does not
schedule an automatic run. Monitor intent age/attempt counts and recovery error logs.
Recovery logs contain only a static message, `stage`, and a bounded diagnostic `code`. Stages
distinguish transaction startup/commit, intent claiming, reference checks, Storage removal, intent
deletion, and retry scheduling. Codes include Prisma codes (such as `P2028` for transaction errors),
allowlisted SQLSTATE values (such as `P2010/42P01` for a missing table), Storage HTTP statuses
(such as `STORAGE_HTTP_403`), and known timeout/network codes. Unknown failures use `UNKNOWN` or
`STORAGE_REQUEST_FAILED`; raw error messages, stacks, provider bodies, paths, and credentials are
never logged. Storage HTTP responses remain sanitized 503s. If retry scheduling also fails, both
failures are logged and the current batch stops; the durable intent remains for a later explicit
run. Recovery transactions explicitly allow up to
10 seconds to acquire a connection/start the transaction (`maxWait`), separately from the
25-second execution limit (`timeout`). This avoids Prisma 7's default 2-second acquisition limit
on a slow remote pooler without changing other API transaction settings. Startup timeouts log
`stage: transaction_start` with `code: P2028/START_TIMEOUT`. An empty recovery queue emits no error.
Cleanup locks each intent with `FOR UPDATE SKIP LOCKED`, then checks `User.avatarObjectPath` or
`TutorDocument.objectPath` according to its purpose before deleting from the mapped bucket.
Finalization locks the same composite intent, preventing deletion of committed files even if a
commit acknowledgement is lost. Paths stay server-side and are never logged.
PostgreSQL and Supabase cannot share an atomic transaction; objects orphaned before this recovery
mechanism or created outside the API still require operator reconciliation.

Every route validates query fields, including routes that accept no query parameters. Unknown
fields return 400. Unexpected errors return the same `{statusCode,error,message,code}` envelope
with a generic 500 message and static logging, without provider details.

### Migration and rollout

`20261006150000_qualification_document_api` is a new forward migration. It adds the partial unique
index for pending uploads and `TutorDocumentAudit` with foreign keys, bounded audit evidence,
one-review uniqueness, and an append-only trigger. It preserves previous migrations and data.
`20261006200000_qualification_upload_recovery` adds the shared `StorageCleanupIntent` queue and its
purpose enum, then reconciles existing tutor profile statuses from their document reviews. It
preserves document and audit evidence and leaves profiles without documents unchanged. Apply with
qualification writes paused, then start the updated API. Automatic background recovery is currently
deferred; pending intents remain available for explicit recovery or the future cron scheduler.
`20261006201000_protect_qualification_metadata` enables RLS on both qualification metadata tables
and the shared cleanup table, then revokes direct access from `PUBLIC`, `anon`, and `authenticated`.
Application authorization remains in Nest; Prisma connects as the migration/table owner. Do not
grant Supabase browser roles direct access to these private metadata/audit/recovery tables.
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
