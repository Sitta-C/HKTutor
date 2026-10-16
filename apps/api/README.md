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
- `POST /resend-verification` (signed flow cookie + `{ flowId }`)
- `GET /email-flow?purpose=verification|password-reset`
- `POST /forgot-password`
- `POST /resend-password-reset` (signed flow cookie + `{ flowId }`)
- `POST /reset-password`
- `POST /login`
- `POST /refresh`
- `POST /logout`
- `GET /me`

Registration/initial recovery return a signed HttpOnly email-flow cookie and a non-secret flow
view. Resends reject caller-provided email fields and resolve the original address from that cookie;
60-second cookie cooldowns and transaction-protected account cooldowns apply together. GET flow
status restores server-calculated remaining time without querying account existence. See
[root resend behavior](../../README.md#email-resend-behavior) for expiry, stale-tab protection,
error contracts, wrong-email recovery and coordinated web/API deployment. No new migration is needed.

Password recovery uses a separate `PasswordResetToken` table and the existing Resend sender.
See the [root recovery contract](../../README.md#password-recovery) for eligibility, generic
responses, cooldowns, token expiry, session revocation, delivery limitations, and migration rollout.
Concurrent reset issuance/redemption, email verification, and password-login session creation lock
the user row first. A login whose old password was verified before a concurrent reset cannot issue
a surviving session after that reset commits.

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

The API's PostgreSQL driver pool allows at most three connections per process, waits up to
10 seconds for a connection, and releases idle connections after 10 seconds. This limits pressure
on the shared Supabase session pool when dashboard requests run concurrently. Budget connections
across all API processes and database tools; a per-process limit cannot prevent other clients from
exhausting the shared pool. Restart the API after changing these settings. Disconnect unused database
tool sessions and stop duplicate development API processes when troubleshooting connection limits.
This pool configuration does not require a schema migration.

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

### Conversation history and read receipts (S2-T20)

`GET /api/v1/conversations/:conversationId/messages` keeps its original oldest-first forward
contract: no cursor starts at the beginning; `afterMessageId` is exclusive, and an empty forward
page keeps that cursor. `pageSize` remains 1–50, default 20. Participant authentication/authorization
and cross-conversation cursor validation apply to every mode. GET never marks messages read.

S2-T20 adds three mutually exclusive optional modes alongside `afterMessageId`:

- `latest=true` returns the newest page, ordered oldest first for display.
- `beforeMessageId` returns the immediately preceding page, also oldest first.
- `fromMessageId` reads inclusively from an existing message to refresh persisted read states,
  then the caller can follow `nextAfterMessageId` as usual for forward catch-up.

Backward pages add `nextBeforeMessageId`: the first returned message if older history remains,
otherwise null. Their `hasMore` describes older history; forward `hasMore` describes newer history.
Ordering uses `(sentAt, id)` for all comparisons, including equal timestamps. Mixed modes and
invalid cursor IDs/flags return 400. Existing forward response fields and semantics remain unchanged.

The web opens the latest 20 messages, loads one earlier page per click and polls every four seconds
while the thread/document is visible. Receipt refresh begins at the earliest loaded unread sent
message when it is at/before the cached GET boundary, so an acknowledged send cannot skip a
concurrent incoming message. Polling is serialized and catch-up is bounded to 200 pages/60 seconds;
older pages never replace the latest GET cursor.

`POST /api/v1/conversations/:conversationId/read` retains the S2-T19 recipient-only idempotent
contract. The web sends `upToMessageId` for the received boundary only at the latest reading
position in a visible open thread. Sent/Read display comes from persisted `readAt`. No schema or
migration changes are required. API HTTP tests use mocked persistence; browser tests intercept APIs,
so these checks do not certify a live database deployment.

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
and PNG with matching byte signatures and filename extensions (`.pdf`, `.jpg`/`.jpeg`, `.png`)
are accepted, with an inclusive maximum of 5 MiB
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
profile `verificationStatus` uses `UNVERIFIED | PENDING | VERIFIED | REJECTED`.
Registration and email verification do not create a tutor profile. Its first save creates an
`UNVERIFIED` profile, meaning no qualification document has been submitted. The first successful
upload moves it to `PENDING`; selecting a file or a failed upload does not change verification.
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
document is pending; otherwise `REJECTED` if documents exist, or `UNVERIFIED` without documents.
Rejecting another document cannot revoke existing
approved evidence. Uploads and reviews for the same tutor serialize on the profile lock. The response is
`{documentId,status,reviewedAt,reviewedBy,tutorVerificationStatus}`. Approval notes live in the
audit history; `rejectionReason` remains null on approved documents. Persistence failures roll
back the entire review and return a sanitized 503.

The two forward migrations `20261012100000_add_unverified_tutor_status` and
`20261012100100_default_tutor_status_unverified` add the enum value before using it, change the
profile default, and backfill only `PENDING` profiles with no `TutorDocument` rows. Completed
`VERIFIED`/`REJECTED` decisions are preserved, including provisioned demo tutors. Apply both
migrations before running the updated API against a database; `pnpm db:generate` only regenerates
the client and does not apply them. Document review statuses and admin queue filters retain their
existing contract. Only `VERIFIED` tutors can publish courses or appear in public discovery.

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
`20261006200000_qualification_upload_recovery` adds the original qualification cleanup queue and
reconciles existing tutor profile statuses from their document reviews. It preserves document and
audit evidence and leaves profiles without documents unchanged. Automatic background recovery is
currently deferred; pending intents remain available for explicit recovery or the future scheduler.
`20261006201000_protect_qualification_metadata` enables RLS on both qualification metadata tables
and that cleanup queue, then revokes direct access from `PUBLIC`, `anon`, and `authenticated`.
`20261006210000_add_user_avatar` adds avatar metadata and converts the qualification queue into the
shared `StorageCleanupIntent` table. Existing pending rows receive the
`QUALIFICATION_DOCUMENT` purpose; no queued cleanup work is discarded. Apply with qualification
writes paused, then start the updated API. Application authorization remains in Nest; Prisma
connects as the migration/table owner. Do not grant Supabase browser roles direct access to these
private metadata/audit/recovery tables.
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
boundaries, spoofed MIME signatures, filename extension mismatches, authorization, pagination,
audit failures, conditional review contention, and transactional failure propagation. Its
persistence double models rollback; it does not prove PostgreSQL locks or Supabase expiry against
live services. The SQL contract tests protect the migration invariants. Swagger and shared web wire
types describe the API; frontend upload and admin review screens remain the separate S2-T08 task.

The [S2-T09 QA record](../../tests/s2-t09-qa.md) lists the upload, authorization, expiry, privacy,
and review checks with exact commands, results, and live-environment limits.

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

## Tutor ranking request and explanation contract (S2-T13)

`GET /api/v1/tutors` accepts optional `priority=lowest_price`, `highest_rating`, or
`earliest_availability`. These select ascending hourly price, descending rating, or ascending next
availability in the existing sorter. Existing subject, grade, `maxPrice`, `minimumRating`, page and
page-size filters keep their meanings. Unknown priorities return 400. Omitting all sort parameters
preserves the published-date ordering. Individual sort priorities/directions remain supported, but
combining any of them with `priority` returns 400 rather than silently overriding the chosen mode.

Each result adds `recommendationTags`, an array of language-neutral codes for the UI to translate:

| Code                    | Rule                                                                   |
| ----------------------- | ---------------------------------------------------------------------- |
| `FITS_BUDGET`           | An explicit `maxPrice` is supplied and the actual hourly price fits.   |
| `LOWEST_PRICE`          | Under `lowest_price`, this is a minimum-price matching public listing. |
| `HIGHEST_RATED`         | Under `highest_rating`, this is a maximum known matching tutor rating. |
| `EARLIEST_AVAILABILITY` | Under `earliest_availability`, this is the earliest bookable slot.     |

Best-value tags use all matching published listings owned by verified, active, non-deleted tutor
accounts, before pagination. Every tie receives its applicable tag. Null ratings and no-slot tutors
never receive their respective best-value tag. Earliest-slot explanations exclude deleted, started,
and PENDING/CONFIRMED-reserved slots. No supplied budget means no `FITS_BUDGET` tag; missing data is
not treated as zero. Comparisons use the stored Decimal prices and ratings. An item with no applicable
explanation returns `recommendationTags: []`.

This contract addition delegates ordering and result pagination to the existing sorter. The mocked
API tests for it check the `orderBy`/SQL text a call is given, not that PostgreSQL actually orders
rows that way; see "Tutor ranking verification (S2-T15)" below for that evidence. Public-query
eligibility (which tutors and listings are visible at all) is S2-T10/S2-T12's own contract. The
ranking selector and translated result-card labels belong to S2-T14.

## Mock payment API (S2-T04)

`POST /api/v1/bookings/me/:bookingId/mock-payment` records the demo payment for one booking. It is
a demonstration flow only: the body carries `amount` and `reference` and nothing else, and the
global validation pipe rejects any card, bank or other unknown field.

Access is `JwtAuthGuard`, then `RolesGuard(STUDENT)`, then `ResourceOwnershipGuard`. The route
declares its own ownership bodies so a booking owned by another student answers 403
`BOOKING_NOT_OWNED` rather than the ownership-safe 404 used elsewhere.

`amount` is a fixed two-decimal string and is compared with the booking's stored `netAmount` only to
detect a stale client; the server amount is the one recorded, and the comparison is a `Decimal`
comparison rather than string equality. `reference` is trimmed, single-line, at most 64 characters
and globally unique across bookings. It accepts text in any language, Thai included; only control
and format characters are rejected, because no card asks the field to be ASCII and the rest of the
API keeps user-supplied text Unicode-aware.

Only a `CONFIRMED` and `UNPAID` booking can be paid. One transaction writes `paymentStatus=PAID`,
`paidAt` and `mockReference` through a conditional update whose `where` still requires
`paymentStatus=UNPAID`, so two concurrent payments cannot both succeed and a losing request reads
nothing back. Outcomes:

| Status | Code                                | Cause                                                        |
| ------ | ----------------------------------- | ------------------------------------------------------------ |
| 200    | —                                   | Payment recorded; returns the stored amount and UTC `paidAt` |
| 400    | `BOOKING_PAYMENT_AMOUNT_MISMATCH`   | Declared amount differs from the stored `netAmount`          |
| 400    | `BOOKING_NOT_PAYABLE`               | Booking is still pending                                     |
| 400    | `VALIDATION_FAILED`, `INVALID_UUID` | Blank or oversized reference, loose amount, unknown field    |
| 403    | `BOOKING_NOT_OWNED`                 | Booking belongs to another student                           |
| 404    | `BOOKING_NOT_FOUND`                 | No booking with this ID                                      |
| 409    | `BOOKING_NOT_PAYABLE`               | Booking is canceled, completed or expired                    |
| 409    | `BOOKING_ALREADY_PAID`              | Booking is already paid                                      |
| 409    | `MOCK_REFERENCE_TAKEN`              | Reference already recorded for another booking               |
| 409    | `BOOKING_PAYMENT_CONFLICT`          | A concurrent payment won the transition                      |

No state-changing error leaves a partial write: every rejection happens before the transaction or
inside it, where the transaction rolls back. `db:verify:bookings` proves this against PostgreSQL with
a temporary `AFTER UPDATE` trigger that fails once the row is already PAID; the booking must come back
CONFIRMED and UNPAID with a null `paidAt` and `mockReference`. The same check pays the booking once
and then reuses its reference on a second booking to prove the unique index surfaces as
`MOCK_REFERENCE_TAKEN`.

Two decisions worth stating, because the cards differ or the order is observable:

- **Amount mismatch answers 400, and the cards disagree about it.** Product Backlog US12-5 and the
  parent S2-T04 card say "Return 400 for amount mismatch/invalid reference"; the endpoint contract
  card lists the mismatch under 409. The acceptance criteria win, so the endpoint answers 400. Note
  the inconsistency this leaves inside this file: `assertBookableSlot` reports an already-started
  slot as 409 because a client acting on a stale view is a state conflict, which is the same shape
  of failure as a stale amount. That is a conflict between the cards rather than a defect in either
  code path, and moving the mismatch to 409 needs the backlog changed first. The body carries
  `BOOKING_PAYMENT_AMOUNT_MISMATCH` and `details.expectedAmount`, so a client can react to the
  specific cause whichever status the backlog settles on.
- **State is checked before the amount.** Paying a booking that is still PENDING answers 400
  `BOOKING_NOT_PAYABLE` even when the amount is also wrong, because an unconfirmed booking cannot be
  paid at any amount. This follows the US12-5 pending-booking acceptance criterion. Other
  non-payable states (CANCELED, COMPLETED, EXPIRED) retain 409. Clients must handle
  `BOOKING_NOT_PAYABLE` by refreshing booking state before retrying, even when its HTTP status is 400.

The student reads carry the recorded payment so a client never has to replay the POST to learn it:
`GET /api/v1/bookings/me` and `GET /api/v1/bookings/me/:bookingId` both return `paymentStatus`,
`paidAt` and `mockReference`. `paidAt` and `mockReference` are present and `null` while the booking
is unpaid, so a client branches on the value rather than on the key being absent. The tutor list
deliberately omits them: no card asks a tutor to see a student's payment reference, and the reads
select only the columns they return.

The field is `mockReference` here, matching the column, while the POST response calls the same value
`reference`; the POST answers about one payment, where the shorter name is unambiguous.

## Class attendance API (S2-T35)

`PUT /api/v1/bookings/tutor/:bookingId/attendance` accepts only
`{attendance:"ATTENDED"|"ABSENT"}`. JWT authentication, tutor role and booking ownership are
required. Unknown body fields and invalid UUIDs/attendance values return 400; missing/invalid
authentication returns 401, another role/tutor returns 403, and a missing booking returns 404.

The class end time must be at or before now. A first write requires a `CONFIRMED` booking with no
attendance record and atomically saves attendance, `attendanceMarkedAt` and `COMPLETED` status.
The 200 response is `{bookingId,attendance,attendanceMarkedAt,status:"COMPLETED",idempotentReplay}`
with a UTC ISO 8601 timestamp. `idempotentReplay` is false for the first write; a same-value retry
returns the original record and timestamp with true and performs no second write. A different-value
retry returns 409 `ATTENDANCE_ALREADY_RECORDED`. Pending/canceled/expired bookings, future classes
and completed bookings without a saved record return 409 without mutation.

The conditional database update requires `CONFIRMED`, null attendance fields and an ended slot.
When another recording wins, the losing request reads the saved record in the same transaction:
the same value is a replay, a different value is a conflict. Persistence failures roll back the
whole transaction. No schema migration or new configuration is needed.

Verification:

```bash
pnpm --filter @hktutor/api test --runInBand bookings
pnpm --filter @hktutor/api test:e2e --runInBand bookings-attendance
```

Unit tests cover the inclusive end-time boundary, replay/conflict and losing conditional updates.
The HTTP suite exercises real validation, authentication, role/ownership guards and service logic
with isolated persistence, including post-write failure rollback. These tests do not certify
PostgreSQL concurrency against a live database.

## Private availability range queries

`GET /api/v1/tutors/me/availability` accepts optional UTC `from` and `to` bounds. By default it
filters slot start times (`from <= startAtUtc < to`). Opt into `rangeMode=overlap` to include
slots spanning the range (`endAtUtc > from` and `startAtUtc < to`); omitted bounds are unrestricted.
This mode excludes slots ending exactly at `from` or starting exactly at `to`. It retains tutor
ownership, soft-delete filtering, and derived reservation states. The public availability endpoint
keeps its existing future-start behavior and does not accept `rangeMode`.

## Tutor booking transition verification (S2-T03)

`pnpm --filter @hktutor/api db:verify:tutor-transitions` exercises the real Nest HTTP pipeline and
Prisma transactions against PostgreSQL. Neither root `pnpm check` nor `pnpm test` runs this command.
The HTTP Jest suite uses persistence doubles; it checks routing, validation and failure propagation,
but cannot establish database atomicity.

Use Node.js 24.19.0, the repository pnpm version, installed dependencies, and Docker (or an empty
disposable PostgreSQL database). From the repository root, this example creates a new local target,
applies committed migrations without seeding, and runs the verifier:

```bash
nvm use 24.19.0
pnpm install --frozen-lockfile
docker run --detach --name hktutor-tutor-transitions-test \
  --publish 127.0.0.1:55434:5432 \
  --env POSTGRES_USER=postgres --env POSTGRES_PASSWORD=disposable-local-only \
  --env POSTGRES_DB=hktutor_transitions_test postgres:17
# Wait until this reports that PostgreSQL is accepting connections.
docker exec hktutor-tutor-transitions-test pg_isready -U postgres -d hktutor_transitions_test
export DATABASE_URL='postgresql://postgres:disposable-local-only@127.0.0.1:55434/hktutor_transitions_test'
pnpm db:generate
pnpm --filter @hktutor/api db:migrate:deploy
HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 pnpm --filter @hktutor/api db:verify:tutor-transitions
# Discard this example's container and its anonymous data volume, including after a failed run.
docker rm --force --volumes hktutor-tutor-transitions-test
unset DATABASE_URL
```

The approval flag and explicit `DATABASE_URL` are both required. The runner never loads `.env` or
uses `AppModule` to select a fallback database. It accepts loopback hosts (`localhost`, `127.0.0.1`,
IPv6 loopback) and database names starting with `hktutor_` or `hktutor-`; ports and users are configurable.
URL options, schema overrides, fragments, remote hosts, and omitted targets are refused. These gates
do not establish that a local database is disposable: choose an empty target that you own before
applying migrations or running either verifier. Preflight checks applied `_prisma_migrations`,
the active-slot partial unique index, and the cancellation constraint before creating fixtures.

The runner creates random actors, catalog entries, a DRAFT listing, slots and bookings itself; it
has no seed dependency. It verifies role/ownership errors and terminal states with persisted
booking/slot snapshots, successful reservation/release through the real private availability
projection, all four repeat/switch transitions, and all four concurrent action pairs. A read gate
holds both real service SELECTs after they observe PENDING, then releases them to contend through
the real database transaction. Text boundaries are 499/500/501 ASCII characters; inbox bounds use
one-millisecond neighbors of persisted timestamps and the DTO pagination limits. Timeout handling
and URL safety have separate unit tests (`tutor-transition-verifier.spec.ts`); these are test-runner
checks, not database atomicity evidence.

Compared with `db:verify:bookings` (`verify-booking-endpoint-concurrency.ts`), this runner adds the
synchronized four-pair decision matrix, full persisted snapshots, terminal/authorization decision
tables, and tutor inbox boundaries without requiring a seeded published listing. Keep the older
runner for booking creation/payment contention and its `probe_reject_rollback` trigger: it supplies
the separate real mid-transaction reject rollback evidence. The new runner does not replace that
trigger test. It removes only its invocation's random fixture IDs in `finally`; retain failures and
discard the disposable database afterward. Browser inbox tests intercept API responses and establish
UI behavior, rather than live browser-to-database integration.

## Booking cancellation verification (S2-T24)

`pnpm --filter @hktutor/api db:verify:cancellation` checks `POST /api/v1/bookings/:bookingId/cancel`
through the real Nest HTTP pipeline and Prisma transactions against PostgreSQL. Like the S2-T03
runner, it is not part of `pnpm check`, needs the approval flag and an explicit loopback `hktutor_`
or `hktutor-` `DATABASE_URL`, never loads `.env`, and creates and removes its own random fixtures.
Prepare the database as in the S2-T03 example (migrations, no seed), then run:

```bash
HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 pnpm --filter @hktutor/api db:verify:cancellation
```

- **Cutoff.** The runner freezes `new Date()` and `Date.now()` in its own process, so classes that
  start exactly 24 hours, 24 hours plus 1 second, and 24 hours minus 1 second away hit the boundary
  exactly against persisted timestamps. The first two cancel; the last returns 409 and changes nothing.
  Classes starting in 2 hours or already started also return 409.
- **Success.** Student and tutor cancellations, including a pending booking as the API allows,
  store the trimmed reason, the canceler and the cancel time, change no other booking or payment
  field, and free the slot in the private availability projection. A new booking can then take the
  slot, and cancelling the old booking again (409) leaves that booking holding it.
- **Failures.** A missing, blank or non-string reason (400), a booking paid through mock payment, a
  completed, canceled or expired booking (409), another student, another tutor, an admin (403), no
  token (401), and missing or malformed IDs leave full booking, payment and slot snapshots unchanged.
- **Races.** Student and tutor cancelling at once give one 200 and one 409. Cancellation racing mock
  payment runs in both commit orders: both requests read the unpaid booking first, and the second
  writer's update waits on the first's row lock, re-checks its guard and returns 409. A booking never
  ends both canceled and paid, and paying a canceled booking returns 409.

The frozen clock and the URL gate have unit tests in `cancellation-verifier.spec.ts`. The HTTP-level
contract, including the exact boundaries with a frozen clock, is also covered without a database in
`test/bookings-cancellation.e2e-spec.ts`.

## RescheduleRequest persistence (S2-DB04)

The forward migration `20261014120000_add_reschedule_request` implements the
[S2-DB04 card](https://trello.com/c/KS7mGzdM).
Field names follow the approved
[Data Model, row 13](https://docs.google.com/spreadsheets/d/17RMTjXa26ho7blv-TK5pbJFbHxVHJEBRPKCXk9x5AE0/edit#gid=1191524122&range=A13:D13):
`bookingId`, `requestedById`, `fromSlotId`, `requestedSlotId`, `reason`, `status`,
`reviewedById`, `requestedAt`, `decidedAt`, and `withdrawnAt`, plus a UUID `id`.
This resolves the card's alternative `requesterUserId`, `targetSlotId`, and `decisionByUserId`
wording in favor of its Data Model acceptance criterion. No existing migration or data is rewritten.

Prisma exposes `PENDING | APPROVED | REJECTED | WITHDRAWN`; PostgreSQL stores the corresponding
lowercase values. Timestamps use `TIMESTAMPTZ(3)` and remain UTC on the future API boundary.
`fromSlotId` retains the original slot after approval; both slot and both user relations restrict
hard deletion. Reasons must contain non-whitespace text, be trimmed, and contain 1–500 characters.

The partial unique index `RescheduleRequest_pending_booking_key` permits one pending request per
booking, while retaining any number of closed requests. Pending requests do not reserve targets:
several bookings may request the same target. The existing `Booking_active_slot_key` remains the
final guard against two active bookings taking that slot. Current/history queries use
`(bookingId, status, requestedAt, id)`; requester inboxes use
`(requestedById, status, requestedAt, id)`. Counterparty inboxes join through the existing
student/tutor Booking indexes. Slot/reviewer indexes support relations.

Database triggers require new requests to be pending, reference a confirmed booking's current
slot, name a different slot belonging to the same tutor, and identify a student/tutor participant
as requester. Creation locks the booking row. Decisions must identify the other participant;
pending/decided/withdrawn timestamp and reviewer combinations are checked together. Request identity,
reason and request time are immutable, and closed evidence cannot be modified or reopened.
Rejecting/withdrawing a request does not move a booking. RLS and revoked PUBLIC/Supabase browser-role
privileges keep this table behind the backend owner connection.

S2-T25 implements the authenticated create/current/approve/reject/withdraw endpoints in
`src/modules/reschedule-requests`. It enforces requester/counterparty ownership, active-account and
current-consent checks, and an inclusive cutoff: create and approve allow exactly 24 hours before
the current class and reject anything closer. A pending request never holds its target slot.

Creation locks the booking before reading eligibility. Approval locks the booking, re-reads the
request, then locks and reads the target slot before checking availability and changing either
record. If target deletion commits first, approval returns `409 RESCHEDULE_TARGET_UNAVAILABLE`
without closing the pending request or moving the booking. Request closure and the slot swap
commit together; a uniqueness or state conflict rolls both back. No schema migration is added by
these endpoint fixes.

Cancellation also compares the booking's current `slotId` with the slot used for its cutoff check.
If approval moves the booking after cancellation reads it, cancellation returns
`409 BOOKING_TRANSITION_CONFLICT` and preserves the rescheduled class. The client must refresh
before retrying, so the new class time is checked against the cancellation cutoff.

`GET /api/v1/bookings/:bookingId/reschedule-requests/current` advertises `APPROVE` only for an
eligible confirmed booking and a future, non-deleted, unreserved, non-overlapping target belonging
to the same tutor. If approval becomes unavailable, the counterparty can still `REJECT` and the
requester can still `WITHDRAW` while the request is pending.

Run the focused endpoint checks with:

```bash
pnpm --filter @hktutor/api test --runInBand reschedule-requests
pnpm --filter @hktutor/api test:e2e --runInBand reschedule-requests
```

The HTTP suite uses real controllers, guards and validation with isolated mocked persistence. It
checks exact-cutoff behavior, permitted actions, target deletion at the lock read, authorization,
validation and modeled rollback. It does not prove PostgreSQL lock contention. The database
verifier below tests the persistence protocol separately, not the production service or HTTP routes.

### Endpoint concurrency verification (S2-T25)

`pnpm --filter @hktutor/api db:verify:reschedule-endpoints` exercises the real Nest HTTP pipeline,
JWT sessions, production services and Prisma transactions against PostgreSQL. It does not load
`.env`, migrate or seed a database, and is not run by `pnpm check`. Use a newly created disposable
target that you own; the explicit opt-in, loopback host, `hktutor_*_test`/`hktutor-*-test` database
name, and lack of URL options/fragments are required. All committed migrations and the active-slot
and pending-request partial unique indexes are preflighted before fixtures are created.

For example, create a fresh isolated PostgreSQL 17 container, apply migrations without seeding,
and verify the endpoints:

```bash
docker run --detach --name hktutor-pr107-reschedule-test \
  --publish 127.0.0.1:55436:5432 \
  --env POSTGRES_USER=postgres --env POSTGRES_PASSWORD=disposable-local-only \
  --env POSTGRES_DB=hktutor_reschedule_endpoints_test postgres:17-alpine
docker exec hktutor-pr107-reschedule-test pg_isready -U postgres -d hktutor_reschedule_endpoints_test
# Continue only after PostgreSQL reports that it is accepting connections.
export DATABASE_URL='postgresql://postgres:disposable-local-only@127.0.0.1:55436/hktutor_reschedule_endpoints_test'
pnpm db:migrate:deploy
HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 pnpm --filter @hktutor/api db:verify:reschedule-endpoints
docker rm --force --volumes hktutor-pr107-reschedule-test
unset DATABASE_URL
```

The runner checks six scenarios: approval between cancellation's read and write, cancellation
winning first, duplicate pending creation, two requests approving the same target, two approvals
of the same request, and rollback after both actual request/booking writes. A separate control
connection holds a row lock until `pg_stat_activity` shows both real HTTP transactions waiting;
releasing it must produce one success and one 409. Snapshots verify that the loser keeps its
original booking and pending request, the winner alone reserves the target and releases its old
slot, and failure rolls back both writes. Prisma query extensions only pause a real cancellation
SELECT or inject a failure after a real swap UPDATE; no persistence results are mocked.
Only this invocation's randomly identified fixtures are deleted in `finally`.

On 2026-10-15, the cancellation regression failed against commit `2ffd56f` (200 instead of 409),
then all six real HTTP/PostgreSQL scenarios passed with the slot comparison fix. All 20 committed
migrations were applied to the new container; no project database or seed data was used.

### Verification and rollout

`pnpm check` and `pnpm verify:workspace` do not run the database verifier. Contract tests check
schema/migration invariants and verifier safety. For actual PostgreSQL constraints and transactions,
create a new disposable local target, apply all migrations without seeding, then run:

```bash
docker run --detach --name hktutor-s2-db04-test \
  --publish 127.0.0.1:55435:5432 \
  --env POSTGRES_USER=postgres --env POSTGRES_PASSWORD=disposable-local-only \
  --env POSTGRES_DB=hktutor_reschedule_test postgres:17-alpine
# Wait until PostgreSQL is accepting connections.
docker exec hktutor-s2-db04-test pg_isready -U postgres -d hktutor_reschedule_test
export DATABASE_URL='postgresql://postgres:disposable-local-only@127.0.0.1:55435/hktutor_reschedule_test'
pnpm db:migrate:deploy
HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 pnpm db:verify:reschedules
docker rm --force --volumes hktutor-s2-db04-test
unset DATABASE_URL
```

The verifier never loads `.env`. It requires the opt-in and an explicit PostgreSQL loopback URL
whose database name matches `hktutor_*_test` or `hktutor-*-test`; URL options and fragments are
refused. Choose an empty target you own: a loopback address alone does not prove disposability.
The script preflights both partial unique indexes, creates random synthetic fixtures and removes
only its own rows in `finally`. Discard the example container after success or failure.

It checks invalid participants/reviewers, wrong tutor/original slot, reason boundaries, lifecycle
metadata, immutable history, missing booking and restricted target deletion. Concurrent pending
inserts yield one winner. A read gate synchronizes two approval transactions targeting one slot;
the loser retains its original booking and pending request, while the winner releases its old slot.
A deleted target fails the swap and preserves both the pending request and original booking.
A forced PostgreSQL error after both request and booking writes verifies rollback by comparing
complete booking/request/slot snapshots. Two simultaneous decisions on one request also yield one
winner. These checks certify persistence behavior, not live S2-T25 endpoints or UI.

Apply the new migration to a separately confirmed deployment target before enabling S2-T25.
`pnpm db:generate` alone does not migrate that target. No new configuration, seed or API wire
types are required for this schema-only task.

Verification recorded on 2026-10-14:

| Command                                                                                  | Result                                                                                                               |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `pnpm db:validate`                                                                       | Passed; Prisma schema valid.                                                                                         |
| `node --test tests/booking-foundation.test.mjs tests/reschedule-request-schema.test.mjs` | 10 passed.                                                                                                           |
| `pnpm check`                                                                             | Passed formatting, all workspace lint, 865 API/268 web unit tests and both builds.                                   |
| `pnpm db:migrate:deploy` with the explicit disposable URL                                | All 20 migrations applied successfully to a new PostgreSQL 17 database; no seed.                                     |
| `HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 pnpm db:verify:reschedules` with that same URL     | Passed real constraints, concurrent pending/approval writes, deleted-target failure, slot release and full rollback. |
| `pnpm verify:workspace`                                                                  | 118 passed, 5 existing web source-contract assertions failed.                                                        |

The five workspace failures were reproduced from an isolated `git archive HEAD` snapshot:
two in `booking-flow-web.test.mjs`, one in `privacy-consent-foundation.test.mjs` and two in
`s1-t26-integration-flow.test.mjs`. They concern pre-existing booking-list, consent and route/role
source assertions. S2-DB04's new contract tests and the updated Booking foundation contract pass.
This task leaves those unrelated web assertions for their owning work.

## Reschedule rules verification (S2-T27)

`pnpm --filter @hktutor/api db:verify:reschedule-rules` checks the S2-T25 reschedule endpoints,
together with the booking API, through the real Nest HTTP pipeline, JWT sessions and Prisma
transactions against PostgreSQL. Like the S2-T24 runner, it is not part of `pnpm check`, needs the
approval flag and an explicit loopback `hktutor_` or `hktutor-` `DATABASE_URL`, never loads `.env`,
and creates and removes its own random fixtures. Prepare the database as in the S2-T25 example
(migrations, no seed), then run:

```bash
HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 pnpm --filter @hktutor/api db:verify:reschedule-rules
```

Every rejected action compares all of the run's bookings, slots and reschedule requests before and
after it.

- **Cutoff.** The runner freezes `new Date()` and `Date.now()` in its own process. Requesting and
  approving for a class exactly 24 hours or 24 hours plus 1 second away succeed; 24 hours minus
  1 second returns 409 `RESCHEDULE_CUTOFF_EXCEEDED`. Requests for a class 2 hours away or already
  started also return 409.
- **Target.** The booking's own slot, a past slot or another tutor's slot returns 400; a deleted
  slot or one held by a pending or confirmed booking returns 409; an unknown slot returns 404. A
  slot whose only booking was canceled is accepted. PostgreSQL refuses a second live slot of the
  same tutor that partly overlaps the booked one (`AvailabilitySlot_no_overlap_excl`), so the
  booking's own slot is the only overlap that can occur.
- **State.** Only a confirmed booking can be rescheduled; pending, canceled, completed and expired
  bookings return 409. A second request while one is pending returns 409, and a withdrawal or
  rejection makes room for a new one.
- **Authorization.** Another student, another tutor or an admin gets 403 for create, approve, reject
  and withdraw. The requester cannot approve or reject, and the other participant cannot withdraw
  (403). No token returns 401; unknown and malformed IDs return 404 and 400.
- **Decisions.** Approval moves only the booking's slot, closes the request once and frees the old
  slot, which another student can then book through the booking API. Rejection and withdrawal change
  nothing else, and a rejected target stays bookable. Any further action on a decided request
  returns 409. If another student books the target, or the target is deleted or starts, before
  approval, approval returns 409 or 400 and the original booking keeps its slot.
- **Race.** Approval and another student's booking compete for one target, in both orders. A control
  connection holds the target's row lock until `pg_stat_activity` shows the first request, then
  both, waiting on it. The first to lock wins (200 or 201), the other returns 409, and exactly one
  booking holds the target.

Two approvals for one target, competing creates and duplicate approvals are covered by
`db:verify:reschedule-endpoints` above. The frozen clock and the URL gate have unit tests in
`reschedule-rules-verifier.spec.ts`.

**Target-availability rule.** A target must be a live, future slot of the booking's tutor, other
than the booking's own slot, with no pending or confirmed booking. A pending request never holds its
target, so approval checks it again. Either participant may request and the other decides. A slot
held by another booking returns 409 `RESCHEDULE_TARGET_RESERVED`, and a rejected target stays
bookable.

## Tutor verification visibility verification (S2-T12)

`pnpm --filter @hktutor/api db:verify:tutor-verification` proves the S2-T10 publish gate
(`TutorListingsService.postPublishListing`) and the discovery query it shares with search and the
public tutor profile (`publicTutorWhere` in `public-tutor-access.ts`) against real PostgreSQL.
`tutors.service.spec.ts`, `public-tutors.service.spec.ts` and `tutor-listing-publish.e2e-spec.ts`
check the `where` clause a call receives against a mocked PrismaService; they cannot prove that
clause actually excludes a persisted row, or that an excluded row survives unmodified. Neither root
`pnpm check` nor `pnpm test` runs this command.

```bash
nvm use 24.19.0
pnpm install --frozen-lockfile
docker run --detach --name hktutor-verification-test \
  --publish 127.0.0.1:55439:5432 \
  --env POSTGRES_USER=postgres --env POSTGRES_PASSWORD=disposable-local-only \
  --env POSTGRES_DB=hktutor_verification_test postgres:17
docker exec hktutor-verification-test pg_isready -U postgres -d hktutor_verification_test
export DATABASE_URL='postgresql://postgres:disposable-local-only@127.0.0.1:55439/hktutor_verification_test'
pnpm db:generate
pnpm --filter @hktutor/api db:migrate:deploy
HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 pnpm --filter @hktutor/api db:verify:tutor-verification
docker rm --force --volumes hktutor-verification-test
unset DATABASE_URL
```

The approval flag and explicit `DATABASE_URL` are both required; the runner never loads `.env` or
falls back to a shared database. It accepts loopback hosts only, requires a database name matching
`hktutor_*_test` or `hktutor-*-test`, refuses URL options/fragments, and checks that every
committed migration under `prisma/migrations` is applied before creating fixtures. It creates its
own catalog, tutor and listing rows; it has no seed dependency.

**There is no admin "revoke verification" endpoint in this product.** A tutor's
`verificationStatus` is derived from their `TutorDocument.reviewStatus` rows by
`deriveTutorVerificationStatus`, and that derivation is sticky toward `VERIFIED`: it returns
`VERIFIED` if _any_ document was ever approved, regardless of later uploads or rejections, so no
reachable API call can walk a tutor back down once approved. The runner simulates the
"pending/rejected/revoked/verified" transitions the card asks for by writing
`TutorProfile.verificationStatus` directly -- the same write a future admin action would have to
perform -- and does not exercise the qualification-document upload/review flow itself; that surface
has its own disposable-database evidence (`db:verify:qualifications`). This gap (no product-facing
way to revoke an already-verified tutor) is a QA finding from this card, not something this test
task changes.

Sequence, on one subject tutor plus an unrelated control tutor that stays `VERIFIED` throughout so
an over-broad filter cannot pass by hiding everyone. The subject's first listing is forced straight
to `PUBLISHED` in the database before the status loop, because a `DRAFT` listing is already excluded
from discovery by `publicationStatus` alone: asserting exclusion against a `DRAFT` row would pass
even with the verification filter deleted outright, and the state that matters is the one a listing
is actually in once published and its tutor is later found ineligible. `UNVERIFIED` and `PENDING`
and `REJECTED` each block `postPublishListing` with `ForbiddenException` and leave the listing row
unchanged, compared in full before and after the rejection rather than only checked for `DRAFT`;
`VERIFIED` publishes two listings for the same tutor and both appear in `searchPublicTutors` and
`getPublicTutor`; simulated revocation back to `REJECTED` removes both already-`PUBLISHED` listings
from search and makes the profile 404, while the `TeachingListing` rows stay `PUBLISHED` with their
original `publishedAt` and a null `deletedAt` -- disappearance without deletion -- and a further
publish attempt on either listing is blocked again, proving the gate re-reads live status rather
than trusting the earlier success; re-verification restores both listings' visibility. The control
tutor's listing is checked after every step.

## Message pagination and read-receipt verification (S2-T21)

`pnpm --filter @hktutor/api db:verify:message-pagination` proves the forward `afterMessageId`
history walk and the mark-everything-read call of the S2-T19 message history/read-receipt contract
(`ConversationsService.getMessages`/`markMessagesRead`) against real PostgreSQL. The mocked-Prisma
suites (`conversations.service.spec.ts`,
`conversations.controller.spec.ts`, `conversations.e2e-spec.ts`) check the `where`/`orderBy` a call
is given and the raw SQL _text_ `markMessagesRead` sends; they hand `findMany` whatever rows the
test writes, so they can prove the service asks the right question but not that walking
`afterMessageId` across real inserted rows -- including two genuinely tied on `sentAt`, which only
the `id` half of the compound `(sentAt, id)` tie-break can place correctly across a page boundary --
is actually gap-free and duplicate-free; that the `readAt IS NULL` guard really makes a second
read-receipt call a no-op against a row Postgres has already written; or that a message sent with a
near-future `sentAt` doesn't trip `Message_read_time_check` (`readAt IS NULL OR readAt >= sentAt`)
once a real transaction tries to satisfy it. Neither root `pnpm check` nor `pnpm test` runs this
command.

```bash
nvm use 24.19.0
pnpm install --frozen-lockfile
docker run --detach --name hktutor-message-test \
  --publish 127.0.0.1:55441:5432 \
  --env POSTGRES_USER=postgres --env POSTGRES_PASSWORD=disposable-local-only \
  --env POSTGRES_DB=hktutor_message_test postgres:17
docker exec hktutor-message-test pg_isready -U postgres -d hktutor_message_test
export DATABASE_URL='postgresql://postgres:disposable-local-only@127.0.0.1:55441/hktutor_message_test'
pnpm db:generate
pnpm --filter @hktutor/api db:migrate:deploy
HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 pnpm --filter @hktutor/api db:verify:message-pagination
docker rm --force --volumes hktutor-message-test
unset DATABASE_URL
```

The approval flag and explicit `DATABASE_URL` are both required; the runner never loads `.env` or
falls back to a shared database. It accepts loopback hosts only, requires a database name matching
`hktutor_*_test` or `hktutor-*-test`, refuses URL options/fragments, and checks that every committed
migration under `prisma/migrations` is applied before creating fixtures. It creates its own tutor,
student, conversation and message rows and has no seed dependency; a `Message`/`Conversation`/`User`
row count taken before and after a run, including three deliberately failing runs while writing
this, confirmed zero rows left behind each time.

`pageSize`/cursor _format_ validation returning 400 is **not** re-proven here: `@Min`/`@Max`/
`@IsUUID` reject those before any query is built, so they are pure-pipe behavior already covered by
`conversations.dto.spec.ts` and, through the real HTTP validation pipe, by `conversations.e2e-spec.ts`.
A cursor that _is_ a well-formed UUID but belongs to a different, real, persisted conversation is a
genuine database question instead, and is covered below. The participant/role authorization the card
also asks for is a primary-key lookup followed by an in-memory comparison
(`assertParticipant` in `conversations.service.ts`), with no query shape for a mock to get wrong, so
it is left to the existing coverage (`conversations.service.spec.ts`, `conversations.e2e-spec.ts`)
rather than repeated here. This script does not exercise `getMessages`'s `latest`, `beforeMessageId`
or `fromMessageId` modes, or `markMessagesRead`'s `upToMessageId` bound -- all four remain covered
only by the mocked suites' SQL-text assertions, and `upToMessageId` in particular is the only read
path the shipped S2-T20 UI actually calls. Real-database coverage of it would be a worthwhile
follow-up.

Sequence, on one conversation plus an unrelated second conversation that stays untouched throughout
so an over-broad query cannot pass by reading or writing across conversations:

- A student sends exactly 35 messages, every one with a `sentAt` already a few minutes in the past
  (not "just now": every one of these 35 must already be behind the real wall clock once
  `markMessagesRead` reads it below, or a bug that used the stored `sentAt` directly instead of the
  database clock would be unable to produce a wrong answer), one second apart from each other --
  except the two straddling the `pageSize=20` boundary (messages 20 and 21, derived from `PAGE_SIZE`
  rather than hard-coded, so they track it if it ever changes), which are sent at the **identical
  instant** on purpose. Their expected order is derived by sorting the real rows Postgres returns on
  `(sentAt, id)`, the server's own tie-break, rather than assumed from send order, since whichever of
  the tied pair the database places second is only reachable from the other's cursor through the
  `id` half of that tie-break.
- The student immediately reopens their own conversation and calls the read-receipt endpoint as
  themselves: all 35 stay unread, because read receipts track the recipient, not the sender.
- The tutor (the recipient) pages forward with `afterMessageId`/`pageSize=20` until `hasMore` is
  `false`, collecting every returned ID; the walk takes exactly two requests and returns all 35
  exactly once, tied pair included, in the database's own order. The same walk is repeated with
  `pageSize=7`, an exact divisor of 35 that `20` cannot exercise: it is the one page size where the
  look-ahead fetch can return exactly `pageSize` rows on the true last page rather than fewer, so
  `hasMore` must still read `false` there rather than drifting true from an off-by-one on
  `rows.length > pageSize`. Polling the final cursor from the first walk again returns an empty page
  and the identical cursor back, which is what makes it safe for a client to re-poll.
- A well-formed `afterMessageId` that names a real message in the _other_ conversation is rejected,
  not silently accepted as "no cursor" and not found by coincidence.
- A 36th message is sent with `sentAt` 60 seconds in the **future**: a `sentAt` the database clock
  has not yet reached, which could arise from clock drift between hosts or a row written outside the
  normal `sendMessage` path, not from a client supplying its own `sentAt` (`sendMessage` never
  accepts one; the column default sets it). The tutor then marks every unread message read in one
  call: it marks all 36. This is checked entirely from database-returned values compared against
  each other, never against this script's own `Date.now()` -- bracketing with the Node clock while
  `readAt` comes from PostgreSQL, two different clocks under Docker, was tried first and left only a
  few milliseconds of slack, risking a false failure from ordinary drift. Instead: a single raw
  `UPDATE`'s `now()` is constant for the whole statement, so the 35 past-dated messages, which carry
  34 different `sentAt` values a second apart, must all be read back sharing the exact same `readAt`
  -- a bug that used each message's own `sentAt` would surface directly as more than one distinct
  value, with no clock comparison needed. The one future-dated message must instead be read back at
  a `readAt` equal to exactly its own `sentAt`, the only value that satisfies
  `Message_read_time_check` (`readAt IS NULL OR readAt >= sentAt`) for it. A "just use `sentAt`" bug
  would pass that second check and produce 34 distinct values in the first; a "just use `now()`" bug
  would pass the first and trip the real constraint on the second. Only `GREATEST(now(), sentAt)`
  satisfies both, which is why both are asserted together rather than either alone.
- Repeating that same call marks nothing (`updatedCount: 0`) and leaves every stored `readAt`
  byte-for-byte unchanged. Because the 35 messages now carry a real, recent database-clock `readAt`
  rather than their own distant `sentAt`, a regression that dropped the `readAt IS NULL` guard would
  re-run `GREATEST` with a later `now()` and genuinely move that timestamp forward, not just skip an
  already-equal value.
- The second conversation's one message is read back last and is still unread, confirming nothing
  above ever touched it.

Five regressions were deliberately reintroduced and reverted while writing this -- dropping the
`readAt IS NULL` idempotency guard, replacing `GREATEST(now(), "sentAt")` with a bare `now()` and
separately with a bare `"sentAt"`, dropping the sender-exclusion filter from the read-receipt
`UPDATE`, and dropping the `id` tie-break from the forward-pagination cursor -- and each broke
exactly the assertion it should, including a genuine `23514 Message_read_time_check` violation
raised by PostgreSQL itself for the `now()` case and a genuine dropped message for the cursor case.
A sixth, changing `hasMore`'s `>` to `>=`, passed every other check but failed the `pageSize=7` walk
exactly as intended, confirming that walk earns its place rather than duplicating the `pageSize=20`
one. Each mutation was reverted and confirmed byte-identical (`git diff`/checksum) before the next.

## Tutor ranking verification (S2-T15)

`pnpm --filter @hktutor/api db:verify:tutor-ranking` proves the S2-T13 ranking engine
(`TutorDirectoryService.searchPublicTutors`, `tutor-ranking.ts`) against real PostgreSQL. As the
S2-T13 section above already states, the mocked-Prisma suites (`tutor-ranking.spec.ts`,
`tutor-ranking-explanations.service.spec.ts`, `public-tutors.service.spec.ts`,
`tutor-ranking-contract.e2e-spec.ts`) check the `orderBy`/SQL text a call is given and the pure tag
function in isolation; none of them execute a query against a real engine, so none can certify that
the raw `$queryRaw` used for `earliest_availability` -- its `LEFT JOIN`, `NOT EXISTS` booking
subquery and `deletedAt` filter -- actually orders rows correctly; that a tutor with no bookable
future slot (no slot rows, only a past one, or only one blocked by a pending/confirmed booking)
truly sorts last while one blocked only by a _canceled_ booking does not; that the subject filter
survives on that same hand-written SQL path, not just the Prisma-built one; or that a real stored
`Decimal` price, not an in-memory one, is compared correctly against `maxPrice`. Only a real database
can. Neither root `pnpm check` nor `pnpm test` runs this command.

```bash
nvm use 24.19.0
pnpm install --frozen-lockfile
docker run --detach --name hktutor-ranking-test \
  --publish 127.0.0.1:55440:5432 \
  --env POSTGRES_USER=postgres --env POSTGRES_PASSWORD=disposable-local-only \
  --env POSTGRES_DB=hktutor_ranking_test postgres:17
docker exec hktutor-ranking-test pg_isready -U postgres -d hktutor_ranking_test
export DATABASE_URL='postgresql://postgres:disposable-local-only@127.0.0.1:55440/hktutor_ranking_test'
pnpm db:generate
pnpm --filter @hktutor/api db:migrate:deploy
HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 pnpm --filter @hktutor/api db:verify:tutor-ranking
docker rm --force --volumes hktutor-ranking-test
unset DATABASE_URL
```

The approval flag and explicit `DATABASE_URL` are both required; the runner never loads `.env` or
falls back to a shared database. It accepts loopback hosts only, requires a database name matching
`hktutor_*_test` or `hktutor-*-test`, refuses URL options/fragments, and checks that every committed
migration under `prisma/migrations` is applied before creating fixtures. It creates its own catalog,
tutor, listing, slot and booking rows, every one of them with a randomly generated name or code, so
a second run never collides with rows a crashed first run failed to clean up; it has no seed
dependency and was run twice back to back while writing this to confirm it leaves nothing behind.

`priority=<invalid>` returning 400 is **not** re-proven here: `resolveTutorRankingQuery` rejects an
unsupported priority, or one combined with an individual sort parameter, before any query is built,
so it is pure-function behavior already covered by `tutor-ranking.spec.ts` and, through the real HTTP
validation pipe, by `tutor-ranking-contract.e2e-spec.ts`. Fabricating database evidence for a path
that never reaches the database would not strengthen that proof. S2-T14's ranking selector and
result-card tags have since merged (PR #104); its own Playwright suite
(`apps/web/e2e/tutor-search-ui.spec.ts`) covers that changing the ranking preserves applied filters
and that the cards render the server's reasons, including `FITS_BUDGET` only when `maxPrice` is
sent. Ordering, the 400 response and the truth of each tag are all decided here, server-side, with
the UI only rendering what this endpoint returns, so this verification stays scoped to the API
contract those tags are read from.

Nine tutors, one listing each, created directly as already-`PUBLISHED` and `VERIFIED` (bypassing the
publish workflow, which is S2-T10/S2-T12's own contract) so the fixture is deterministic regardless
of execution speed:

- Two tutors genuinely **tied at the global-lowest price**, with different ratings and a
  `publishedAt` that deliberately disagrees with the rating order -- so a regression that fell back
  to the trailing `publishedAt` tie-break instead of the named price mode's own rating tie-break
  would rank them the wrong way round and be caught, rather than passing by coincidence. Both carry
  `LOWEST_PRICE`.
- One tutor **tied at the global-highest rating** with one of the two above, priced differently so
  it never collides with the price scenario; its more recent `publishedAt` must break that tie.
- One **unrated** tutor, to prove a null rating is never mistaken for a sortable zero and never
  carries `HIGHEST_RATED`.
- One tutor with a real future slot and one **otherwise identical in price and rating but with no
  bookable future slot at all** -- not because it has zero slot rows, but because its only two slot
  rows are, respectively, already reserved by a `CONFIRMED` booking and soft-deleted, at a timestamp
  chosen so that either slot leaking as "available" would land in a visibly wrong, middle position
  rather than coincidentally matching where it already sorts. Having any real slot must still
  outrank having none.
- One tutor whose **only slot is already in the past**, to prove a slot that merely exists is not
  enough: it must count as no bookable future slot at all, the same as the tutor above, not as an
  impossibly early one.
- One tutor whose one future slot carries a **`CANCELED`** booking, to prove a canceled booking does
  not block a slot the way a pending or confirmed one does -- it must be counted as available and
  sorted normally, not treated like the no-slot tutors above.
- One tutor on a **different subject** that would win every single priority on price, rating and
  availability alike, to prove a ranking change cannot widen or drop an existing subject filter --
  checked against both query paths: the shared Prisma `where` (`lowest_price`) and the hand-written
  raw SQL `WHERE` that only `earliest_availability` uses, where this tutor's slot is chronologically
  earliest of all and would otherwise win page 1 outright if the filter ever leaked there.
- One tutor priced **one satang above** the two lowest-price tutors, to prove a real stored
  `Decimal` column, not an in-memory one, is compared correctly: querying with `maxPrice` equal to
  the cheaper two's exact price must include and tag them both while excluding this one entirely.

Each of the three named priorities is run once, filtered to this subject, and asserted against the
exact ordering above (`lowest_price`, `highest_rating`, `earliest_availability`), together with each
item's full `recommendationTags` array -- not merely checked to include the expected tag, but
asserted equal to it, so an extra or leaked tag fails the same as a missing one. The price tie is
additionally walked one page at a time to confirm it splits across the boundary with no duplicate
and no skip, and the `maxPrice` boundary is checked as its own scenario.

Eight regressions were deliberately reintroduced and reverted while writing this -- dropping the
price-tie rating tie-break; sorting null ratings first instead of last; dropping the raw query's
`startAtUtc > now`, booking-status, and `deletedAt` filters independently; dropping the raw query's
subject filter; tagging every listing `FITS_BUDGET` unconditionally; and leaking the lowest-price
context into another priority's tags -- and each was caught by exactly the assertion it should break,
confirming the fixture is discriminating rather than accidentally passing. One of those regressions
(the booking-status filter) was not caught on the first attempt: the reserved slot's timestamp had
been chosen only to avoid colliding with `tiedHigh`'s, which left it landing in the same place
whether the filter worked or not. Moving it to a timestamp where leaking is visibly different from
being excluded restored the check.
