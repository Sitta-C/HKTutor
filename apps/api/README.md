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

### Message retry keys

`POST /api/v1/conversations/:conversationId/messages` accepts `{ text, clientMessageId? }`.
The optional key is a UUID normalized to lowercase, scoped to the authenticated sender using the
existing database unique constraint. Concurrent retries with the same key, conversation and trimmed
text return the same persisted message with 201 and no duplicate event. Changed text/conversation
returns a generic 409 CONFLICT without exposing the original message. Authorization and current
consent are checked before retry lookup. Missing keys preserve the existing fresh-message behavior.
No migration is required; deploy this additive API change before the updated composer.

### Chat socket connection and rooms (S3-T01)

Socket.IO uses namespace `/chat` and transport path `/api/v1/socket.io`. The HTTP global prefix
does not automatically prefix a gateway. Connect to the browser's origin with
`io('/chat', { path: '/api/v1/socket.io', auth: { accessToken } })`; obtain the access token from
the existing in-memory auth flow. Do not put credentials in query strings or browser storage.
The standard Socket.IO `connect` event exposes `socket.id`; this is not an HTTP JSON endpoint.
There is no automatic conversation membership.

The gateway and `JwtAuthGuard` share `verifyAccessSession`. Signature, issuer, audience, access
token type, expiry and active session checks stay common. REST routes opt into current consent
with `@RequireCurrentConsent()`; the S3-T02 send/read writes below require it. Chat requires the
latest STUDENT/TUTOR role, an active, verified, non-deleted account and acceptance of the current
privacy policy.
`connect_error.data.code` is `UNAUTHENTICATED` for missing/invalid/expired/revoked credentials and
`FORBIDDEN` for chat-ineligible accounts or consent. A supplied Origin must equal `WEB_ORIGIN`
(default `http://localhost:3000`), including WebSocket Upgrade. Non-browser clients without an
Origin still require the same JWT/session checks. The handshake accepts only `auth.accessToken`.

| Event                | Payload                        | Success acknowledgement        |
| -------------------- | ------------------------------ | ------------------------------ |
| `conversation_join`  | `{ conversationId: '<uuid>' }` | `{ ok: true, conversationId }` |
| `conversation_leave` | `{ conversationId: '<uuid>' }` | `{ ok: true, conversationId }` |

Both events require exactly one valid UUID; extra `roomName`, `userId`, `role` or other fields
fail. Every join and leave rechecks the session, current role/account/consent and existing
`ConversationsService.assertParticipant` authorization. UUID case is normalized. The only room
joined is the server-derived `conversation:<conversationId>:user:<authenticatedUserId>`; repeated
authorized joins/leaves are safe and no participant list is returned. Failures acknowledge
`{ ok: false, error: { code, message } }` with `VALIDATION_FAILED`, `UNAUTHENTICATED`, `FORBIDDEN`
or `NOT_FOUND`. Additional protection limits return `RATE_LIMITED`; unexpected failures return
generic `INTERNAL_ERROR` without persistence details. WS errors do not include HTTP status codes.
A failed session, role, account or consent check also disconnects the socket; a `FORBIDDEN` or
`NOT_FOUND` conversation fails only that event and keeps existing memberships.

Limits are 8 KiB per transport payload, 4,096 characters per access token, five connected sockets
per user, ten conversation rooms per socket, 30 join/leave attempts per ten seconds per socket,
and 30 namespace handshake attempts per ten seconds per verified user. Handshakes are counted after
JWT/session verification, so users behind one proxy address do not share a limit and invalid
credentials do not consume anyone's. A socket exceeding its event rate is disconnected.

Sockets disconnect at the earlier JWT/session expiry and lose all memberships on disconnect.
Committed logout, refresh-reuse revocation and password reset notify socket cleanup in this API
process. Idle sockets recheck persistence every five seconds for changes from another process.
`forAuthorizedRecipient` revalidates session/account/consent and conversation membership for each
receiving tab immediately before protected dispatch; callers must use this boundary rather than
broadcast directly to cached rooms. A revoked recipient cannot receive through that boundary even
before the idle sweep. No Redis, message store, UI subscription or automatic reconnect/rejoin is
added here. Message and read events are described under S3-T02 below; the UI remains S3-T03/T04.

#### Same-origin development and deployment proxy

Keep the existing web/API ports (3000/3001). Start the API with `WEB_ORIGIN=http://localhost:3002`
(PowerShell: `$env:WEB_ORIGIN='http://localhost:3002'` before `pnpm dev`). In a second terminal run
`pnpm dev:socket-proxy`, then open **http://localhost:3002**. The proxy routes `/api/v1/*` to the
API, everything else to the web server, and tunnels `/api/v1/socket.io/` Upgrade requests to the
API without rewriting the URI. Other Upgrade requests, such as Next.js hot reload, are tunneled to
the web server. It supports HTTP long-polling and WebSocket. Optional
`CHAT_PROXY_PORT`, `WEB_INTERNAL_URL` and `API_INTERNAL_URL` change those upstreams/port; the
API's `WEB_ORIGIN` must still match the browser origin exactly. This proxy is for local development.

`deploy/nginx-chat.conf` supplies a production reverse-proxy configuration behind the existing TLS
ingress. The optional `compose.chat.yaml` overlay makes it the published entrypoint and removes
the web service's direct port: `docker compose -f compose.yaml -f compose.chat.yaml up --build`
(Compose 2.24+). It uses the existing `api:3001` and `web:3000` services; no migration/seed is run.
Set API `WEB_ORIGIN` to the
public HTTPS origin, and preserve the complete `/api/v1/socket.io/` URI, HTTP/1.1 Upgrade and
Connection headers, Origin, and a read timeout longer than the Socket.IO heartbeat. Route polling
and Upgrade to the same API process; multiple replicas require a deployment decision beyond T01.
The existing Next.js REST rewrite alone is not the WebSocket proxy contract. No deployment is
performed by this change; the target ingress must be checked with polling and Upgrade after rollout.

Focused checks use real signed JWTs, Nest/Socket.IO servers, clients and loopback proxy, with only
persistence mocked. They do not certify PostgreSQL execution or the production ingress:

```bash
pnpm --filter @hktutor/api test --runInBand test/unit/auth test/unit/conversations
pnpm --filter @hktutor/api test:e2e --runInBand --runTestsByPath test/conversations-socket.e2e-spec.ts test/conversations.e2e-spec.ts test/auth-controller.e2e-spec.ts
pnpm --filter @hktutor/api lint
pnpm --filter @hktutor/api build
```

The Compose test only parses the chat overlay; it does not run Nginx or a container.

### Chat message and read events (S3-T02)

REST remains the only write path; there is no socket command to send or read messages, and the
REST request and response JSON fields are unchanged. After `POST /api/v1/conversations/:conversationId/messages`
or `POST /api/v1/conversations/:conversationId/read` has saved its change, `ConversationsService`
publishes an in-process `ConversationEvents` event. `ConversationsGateway` delivers it through
`forAuthorizedRecipient` to the other participant's joined tabs only.

Both POST routes require a valid access session, STUDENT/TUTOR role, conversation participation
and current privacy consent. Missing `consentAcceptedAt` or a missing/outdated `policyVersion`
returns `403 FORBIDDEN` before conversation access, persistence or event publication. Invalid,
expired or revoked authentication still returns `401 UNAUTHENTICATED`. Consent is checked from
the same database-backed session lookup as authentication; other REST routes keep their existing
consent policy. Successful send/read responses, including a zero-row read, use
`Cache-Control: no-store`.

| Event             | Sent when                              | Recipient                    | Payload                                                                                 |
| ----------------- | -------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------- |
| `message_created` | `POST …/messages` stored a message     | The other participant        | Exactly the `201` body: `{ messageId, conversationId, senderId, text, sentAt, readAt }` |
| `messages_read`   | `POST …/read` changed at least one row | The sender of those messages | `{ conversationId, messageIds, readByUserId, readAt }`                                  |

`messageIds` lists only the rows that call changed, oldest first by `(sentAt, id)`, returned by the
same `UPDATE` statement; `readAt` equals the REST response's `readAt`. More than 100 changed IDs are
split into several events of at most 100 IDs. A repeat read that changes nothing
(`updatedCount: 0`) sends no event.

Each user has their own receiving room, so neither the sender nor the reader gets an echo, including
on their other tabs. A failed write publishes nothing. Delivery runs in the background after the
write and never changes the REST result; a failure is logged as
`Chat <event> delivery failed (<ErrorClass>)` without message text or user IDs. Delivery is best
effort: a disconnected tab, an API restart or a second API process can miss an event, so clients
deduplicate by `messageId` and reconcile through `GET …/messages` after reconnecting (S3-T03).

The S3-T01 focused checks above also cover these events. Unit tests prove publish-after-save
ordering, recipients, batching and failure handling; the socket e2e suite runs the real REST
controller and guards with real Socket.IO clients and mocked persistence. The changed read-receipt
statement runs against PostgreSQL in `pnpm db:verify:message-pagination` (S2-T21) on a disposable
database.

### Unread message total

`GET /api/v1/conversations/unread-count` requires JWT authentication and STUDENT/TUTOR role. It
returns `{ unreadCount }` with `Cache-Control: no-store`, counting messages across all conversations
belonging to the authenticated caller where `readAt` is null and `senderUserId` differs from the
caller. This total is independent of inbox pagination. The caller's identity and role come only
from the session; the route accepts no alternate owner. Guests/invalid sessions receive 401 and
admins receive 403. This GET does not modify read state or return message content.

Student and tutor sidebar badges use this total. Visible tabs refresh every 15 seconds, on focus
and route changes, and immediately after a successful read acknowledgement changes unread state.
Hidden tabs abort active reads and pause polling. Failures show an unavailable count rather than
zero; the next refresh can recover. Empty totals hide the badge. Collapsed desktop navigation shows
up to `99+` visually while retaining the full accessible count. No schema migration is required.

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
The job overrides both `OMISE_SECRET_KEY` and `OMISE_WEBHOOK_SECRET` with empty strings so
the copied `.env.example` placeholders do not fail startup validation. Payments stay disabled
throughout the workspace checks and booking probe; payment tests use their own mocked configuration.
The booking probe checks that the retired mock-payment endpoint returns 410 to its owner without
changing booking or payment-attempt state. CI then runs `db:verify:payments` against the same
disposable PostgreSQL service with a fake Omise adapter to verify the current payment races,
callback replay, recovery and rollback without contacting Omise.

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
| `HIGHEST_RATED`         | Under `highest_rating`, this is a maximum unrounded review average.    |
| `EARLIEST_AVAILABILITY` | Under `earliest_availability`, this is the earliest bookable slot.     |

Best-value tags use all matching published listings owned by verified, active, non-deleted tutor
accounts, before pagination. Every tie receives its applicable tag. Null ratings and no-slot tutors
never receive their respective best-value tag. Earliest-slot explanations exclude deleted, started,
and PENDING/CONFIRMED-reserved slots. No supplied budget means no `FITS_BUDGET` tag; missing data is
not treated as zero. Comparisons use the stored Decimal prices and, since S3-T19, unrounded averages of
stored reviews (see "Tutor search review ratings (S3-T19)" below). An item with no applicable
explanation returns `recommendationTags: []`.

This contract addition delegates ordering and result pagination to the existing sorter. The mocked
API tests for it check the `orderBy`/SQL text a call is given, not that PostgreSQL actually orders
rows that way; see "Tutor ranking verification (S2-T15)" below for that evidence. Public-query
eligibility (which tutors and listings are visible at all) is S2-T10/S2-T12's own contract. The
ranking selector and translated result-card labels belong to S2-T14.

`GET /api/v1/bookings/tutor` includes `paymentStatus` (UNPAID/PAID) and `paymentPending` on
all rows. Results are ordered by lesson start (`slot.startAtUtc`) ascending before pagination,
with `createdAt` descending then `id` descending as deterministic tie-breakers. This applies to
every status filter, including ALL. The tutor inbox displays a separate bilingual payment badge and disables cancellation
for paid bookings or active payment attempts. Booking confirmation alone does not unlock classroom
links or attendance; payment must complete first.

## Meeting links and class details (S2-T32)

`PUT /api/v1/bookings/tutor/:bookingId/meeting-link` accepts `{ meetingUrl }` from the booking's
owning tutor only. The URL must be an absolute HTTPS URL; HTTP, FTP, JavaScript, malformed URLs,
embedded `user:password@` credentials, whitespace, control characters (including NUL), bidirectional
override characters, missing values and unknown body fields return 400 `INVALID_URL` or a validation
error. A successful update returns
`200 { bookingId, meetingUrl, updatedAt }`. Both `CONFIRMED` and `COMPLETED` bookings allow edits only when `paymentStatus=PAID`;
unpaid edits return 409 `BOOKING_NOT_PAID`;
`PENDING`, `CANCELED` and `EXPIRED` return 409 `BOOKING_NOT_CONFIRMED_OR_COMPLETED`. The transaction
updates only the URL and the automatic audit timestamp, with an eligibility condition on the write.
A concurrent transition to an ineligible state returns 409 `BOOKING_TRANSITION_CONFLICT` without
writing the URL. Existing authentication, tutor-role and booking-ownership guards apply: no valid
session returns 401, a wrong role/owner returns 403 and a missing booking returns 404.

`GET /api/v1/bookings/:bookingId/class-details` is available only to the student or tutor participant.
It returns `200 { bookingId, status, paymentStatus, startAt, endAt, subject, meetingUrl, attendance, attendanceMarkedAt, participants }`
for every booking state. `subject` is `{ id, name }` from the booking's teaching listing.
`meetingUrl` contains the stored URL only for `CONFIRMED`/`COMPLETED`; it is explicitly `null` for
`PENDING`/`CANCELED`/`EXPIRED`, even when a URL remains stored. No link set is also a valid `null`
state. Only paid confirmed/completed classes expose their saved meeting link, for both participants.
Unpaid classes, including historical completed classes, return `meetingUrl: null`.
Completed classes retain their saved attendance. `attendanceMarkedAt`
is the original UTC ISO 8601 recording time, or `null` when no timestamp was recorded; clients
read the saved receipt through this GET without replaying an attendance PUT. Reads never change the
booking. Student details contain only `firstName`, `lastName`, `nickname`, `school`, `gradeLevel`
and `phone`; database profile IDs/timestamps are not serialized inside `detail`.

Both routes validate the UUID and use the shared `{ statusCode, error, message, code }` error
envelope. The GET returns 401 without a valid session, 403 for nonparticipants (including admins)
and 404 for a missing booking. An absent student profile retains the existing 400 validation
response. Timestamps are UTC ISO 8601; clients convert them to `Asia/Bangkok` for display. No schema
migration or new environment setting is required.

Verification commands from the repository root:

```bash
pnpm --filter @hktutor/api test --runInBand
pnpm --filter @hktutor/api test:e2e --runInBand --runTestsByPath test/bookings-class-details.e2e-spec.ts
pnpm --filter @hktutor/api lint
pnpm --filter @hktutor/api build
```

The focused HTTP suite runs the real controller, service, role/ownership guards, validation and
error filter against isolated Prisma/session/token-verifier fixtures. It covers all booking states
for both participants, subject and UTC timestamps, nullable/hidden links, rejection without data
leakage, input validation, persisted-value reads, concurrent cancellation and rollback after a
post-write failure. It does not certify PostgreSQL locking or rollback against a live database.

S2-T34 QA adds that live-database evidence over HTTP. The runner serves the real booking,
reschedule and notification controllers, guards, services and signed JWT sessions against a new
disposable PostgreSQL database with all migrations applied, and checks URL scheme/shape rejection,
the missing-link state, owner-only writes, participant-only reads, every booking state, five
save-versus-cancel races, and that a stored link never appears on list, reschedule or notification
responses or to outsiders:

```bash
HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 \
  DATABASE_URL='postgresql://postgres:disposable-local-only@127.0.0.1:55441/hktutor_meeting_link_test' \
  pnpm db:verify:meeting-links
```

It follows the same safety rules as the other disposable verifiers (explicit opt-in, loopback
`hktutor_*_test` target, no URL options, never loads `.env`, migrates or seeds, removes its own
fixtures). Evidence and findings are in `tests/s2-t34-qa.md`.

## PromptPay test payments

This integration supports **Omise PromptPay Test Mode only**. Public-key browser SDKs and card
entry are not used. The API creates the source and charge together with its test secret key.
Live keys and live-mode charge/event responses are rejected.

### Setup

1. Set these server-only values in the repository-root ignored `.env`:

   ```dotenv
   OMISE_SECRET_KEY="skey_test_REPLACE_ME"
   OMISE_WEBHOOK_SECRET="[BASE64_WEBHOOK_SECRET_FROM_OMISE]"
   ```

   Obtain the test API secret under Omise Dashboard → Keys. Obtain the Base64 signing secret
   under Test Mode → Webhooks. It is a different credential; do not invent a random replacement.
   Both values may be absent to run the rest of the application with payments disabled (503).
   Partial configuration, placeholders, live keys and invalid signing secrets fail startup.
   `PAYMENT_PROVIDER` may be omitted or set to `omise`; other providers are rejected.
   This implementation has one provider and one method.

2. Review and apply the additive `20261019120000_add_promptpay_payments` migration through the
   normal deployment workflow, then generate Prisma Client and restart the API. Do not rewrite the
   shared Sprint 2 migration. The new migration preserves legacy mock references and permits a
   gateway charge reference instead. This repository task does not apply migrations to `.env`'s DB.
3. Run the API and expose its webhook through a public HTTPS origin. For local development a
   tunnel may forward to port 3001; `https://localhost:3001` is not reachable by Omise.
4. Set the Test Dashboard webhook endpoint to
   `https://<public-origin>/api/v1/payments/omise/webhook`. A frontend/gateway origin must forward
   `/api/v1` to NestJS without modifying the request body. Update the Dashboard if the tunnel URL
   changes. The API needs outbound HTTPS access to `api.omise.co`.
5. Confirm that PromptPay is available on the test account. The API reports a definitive provider
   rejection if the channel/account configuration is unavailable; this is not a successful payment.

### HTTP contract

| Method | Path                                                | Behavior                                                                                      |
| ------ | --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| POST   | `/api/v1/bookings/me/:bookingId/payments/promptpay` | Empty body; create or resume one test attempt. Returns 200 with the persisted status/QR.      |
| GET    | `/api/v1/bookings/me/:bookingId/payments/current`   | Reconcile an active attempt with Omise and return current status. Never creates a charge.     |
| POST   | `/api/v1/payments/omise/webhook`                    | Signed test events; no user JWT. Verify signature and retrieve the charge before applying it. |
| POST   | `/api/v1/bookings/me/:bookingId/mock-payment`       | Retired: 410 for an authenticated student owner. Never writes payment state.                  |

Student endpoints require JWT with current privacy consent, STUDENT role and booking ownership,
in that order. They return
401 unauthenticated, 403 wrong role/owner, 404 missing booking, 400 invalid UUID/nonempty create
body, 409 non-payable state/unsupported amount/mismatched charge, and 503 unavailable or uncertain
provider result. Responses use `Cache-Control: no-store`.

The response contains `bookingId`, `paymentStatus` (UNPAID/PAID), `paymentPending`, `paidAt`,
`reference`, and nullable `attempt`. An attempt contains `id`, `status`, fixed-decimal `amount`,
`currency`, nullable `chargeId`, `qrCodeUrl`, `expiresAt`, and `failureCode`. Its states are
CREATING, PENDING, SUCCESSFUL, FAILED and EXPIRED. QR URLs are exposed only while PENDING.
Booking reads also expose `paymentPending` and `paymentReference`; `mockReference` remains for
historical demo receipts. New successful payments use `paymentReference` and leave `mockReference`
null. All timestamps are UTC; the UI displays Bangkok time.

### Consistency and recovery

- The server takes the amount/currency from the booking, uses Decimal to convert to integer satang,
  and enforces the documented PromptPay THB 20–150,000 range. QR expiry is requested at 15 minutes.
- A conditional booking update claims payment inside a transaction. PostgreSQL partial unique
  indexes enforce one active and one successful attempt per booking. Duplicate requests reuse the
  active attempt or return the paid receipt. A paid booking cannot create another charge.
- Claiming payment and canceling contend on the same booking row. Cancellation requires
  `paymentPending=false`; no booking can be canceled while an active or uncertain QR exists.
  FAILED/EXPIRED provider results release the claim atomically. Expiry is verified with Omise,
  never inferred solely from a browser countdown. A 409 `PAYMENT_IN_PROGRESS` requires a status read.
- Network calls happen outside transactions. A timeout/5xx/malformed response after POST leaves
  CREATING locked, since Omise may already have created the charge. The API never automatically
  retries a charge POST. After 15 seconds, a status read can recover by `metadata.attemptId` from
  charge history (up to 500 charges since the attempt); `charge.create` events can also recover it.
  A missing result never clears this lock or permits a new charge. If recovery stays CREATING,
  an operator must inspect Omise test charges/Events using the attempt ID and replay/reconcile the
  matching charge. Do not manually reset `paymentPending` merely because the UI timed out. If the
  process stopped before POST, verify absence with the provider before any reviewed DB repair.
- Webhooks use HMAC-SHA256 over `<timestamp>.<raw-body>` with the Base64-decoded Dashboard secret.
  Requests require `Omise-Signature` and `Omise-Signature-Timestamp`, a five-minute timestamp
  window, and a constant-time match. Multiple comma-separated signatures support key rotation.
  Never put an API key in the webhook URL. A missing/invalid signature returns 401 before any
  provider or persistence operation.
- A verified webhook independently retrieves the charge and checks test mode, PromptPay method,
  charge ID, attempt/booking metadata, amount, currency, and captured successful status. Updates
  lock the booking row, and terminal attempts cannot be downgraded by duplicate/older events.
  State idempotency makes event replay safe without storing raw webhook payloads or secrets.
- The web UI reads the current attempt on reload, polls every five seconds while active, pauses
  polling in hidden tabs, and stops at terminal results/unmount. Manual status refresh also
  reconciles a missed webhook. Errors block another create until a successful status read.
  Background reconciliation requires a caller; this implementation does not add a scheduled job.
- Classroom links require PAID payment status and CONFIRMED/COMPLETED booking status;
  the paid-booking cancellation prohibition remains.
  Attendance recording is also blocked while a payment is active so a class cannot become
  completed before the pending charge is reconciled.
  Refunds, payouts and live payments are outside this feature. PromptPay refunds are not available
  through Omise's API; do not promise a refund flow from this integration.

### Demo and validation

Create a confirmed unpaid booking, open its detail, select **Create test QR**, and find the charge
in Omise **Test Mode**. Use **Actions → Successful / Failed** to simulate its result; do not use a
banking app or transfer real money. Verify the receipt after reload. FAILED/EXPIRED allows a new
attempt. Test with an HTTPS webhook endpoint for callback delivery; manual refresh independently
retrieves the result if no webhook arrives.

Automated gateway, domain and HTTP tests use test doubles and do not certify the account's
configuration or actual callback delivery. Run `pnpm --filter @hktutor/api test`, the payment HTTP
suite, and `pnpm --filter @hktutor/web exec playwright test student-promptpay-payment-ui.spec.ts`.
For database verification, apply migrations to a disposable local database, then run:

```bash
HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 DATABASE_URL="postgresql://postgres@127.0.0.1:5432/hktutor_payment_test" pnpm db:verify:payments
```

The verifier rejects non-loopback hosts and names without the `hktutor-`/`hktutor_` prefix.
It creates/removes its own fixtures and briefly installs a rollback-probe trigger; never run it
against shared data. It covers concurrent claims, duplicate callbacks, timeout recovery, retry,
payment/cancellation races, and transaction rollback.

References: [PromptPay](https://docs.omise.co/promptpay),
[webhook signature and event verification](https://docs.omise.co/api-webhooks),
[charge API and metadata](https://docs.omise.co/charges-api).

## Class attendance API (S2-T35)

`PUT /api/v1/bookings/tutor/:bookingId/attendance` accepts only
`{attendance:"ATTENDED"|"ABSENT"}`. JWT authentication, tutor role and booking ownership are
required. Unknown body fields and invalid UUIDs/attendance values return 400; missing/invalid
authentication returns 401, another role/tutor returns 403, and a missing booking returns 404.

The class end time must be at or before now. A first write requires a `PAID`, `CONFIRMED` booking with no
attendance record and atomically saves attendance, `attendanceMarkedAt` and `COMPLETED` status.
The 200 response is `{bookingId,attendance,attendanceMarkedAt,status:"COMPLETED",idempotentReplay}`
with a UTC ISO 8601 timestamp. `idempotentReplay` is false for the first write; a same-value retry
returns the original record and timestamp with true and performs no second write. A different-value
retry returns 409 `ATTENDANCE_ALREADY_RECORDED`. A still-pending booking returns 400
`BOOKING_NOT_CONFIRMED_OR_COMPLETED` (Product Backlog US4-2, aligned in S2-T39 with the US12-5
payment rule); canceled/expired bookings, future classes and completed bookings without a saved
record return 409. None of these rejections mutate the booking.

Unpaid attendance writes return 409 `BOOKING_NOT_PAID`, including replays against historical unpaid
completed bookings. Active payments still return 409 `PAYMENT_IN_PROGRESS`.
The conditional database update requires `PAID`, `CONFIRMED`, null attendance fields and an ended slot.
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

S2-T37 QA adds that live-database evidence over HTTP. The runner serves the real booking and both
reschedule controllers, guards, services and signed JWT sessions against a new disposable
PostgreSQL database with all migrations applied. It checks future, in-progress, pending, rejected,
canceled and expired classes, 19 invalid bodies and IDs, every wrong caller, same-value replays,
different-value conflicts, concurrent identical and conflicting submissions, attendance racing a
mock payment, eligibility after an approved reschedule, and a stale reschedule approval after
completion. Every refused request must leave the booking row unchanged, including `updatedAt`:

```bash
HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 \
  DATABASE_URL='postgresql://postgres:disposable-local-only@127.0.0.1:55441/hktutor_attendance_test' \
  pnpm db:verify:attendance
```

Ended classes are reached by moving a booked slot into the past, because bookings can only be made
for future slots. The runner follows the same safety rules as the other disposable verifiers and
removes its own fixtures. Evidence and findings are in `tests/s2-t37-qa.md`.

## Sprint 2 cross-role integration (S2-T38)

`pnpm db:verify:sprint2-flow` boots the real `AppModule` against a disposable PostgreSQL database
and walks one tutor, one student and one admin through the whole Sprint 2 product over HTTP:
registration with email verification, qualification upload and admin approval, verified-only
publishing and discovery, chat with read receipts, booking, confirmation, mock payment, meeting
link and attendance. It then replays the cancellation, reschedule and verification-loss paths and
checks the notifications each party receives. Only Resend and the Supabase Storage client are
replaced, at their outermost boundary:

```bash
HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 \
  DATABASE_URL='postgresql://postgres:disposable-local-only@127.0.0.1:55441/hktutor_integration_test' \
  pnpm db:verify:sprint2-flow
```

The runner pins JWT, Resend and Supabase settings to test-only values before `AppModule` loads,
so a local `.env` is never used, and accepts only a loopback `hktutor_*_test` database. It uses
random fixtures and leaves them in place (qualification audit rows are append-only), so discard the
database afterwards. Evidence is in `tests/s2-t38-qa.md`.

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

## Notification persistence (S2-DB05)

The forward migration `20261016130000_add_notification` implements the
[S2-DB05 card](https://trello.com/c/PRkMFAT7). `Notification` stores UUID `id`/`userId`,
`eventKey`, `eventType`, optional UUID `bookingId`, plain-text `title`/`body`, nullable `readAt`,
and defaulted `createdAt`. Both timestamps use `TIMESTAMPTZ(3)` for UTC exchange.
The [Data Model, row 17](https://docs.google.com/spreadsheets/d/17RMTjXa26ho7blv-TK5pbJFbHxVHJEBRPKCXk9x5AE0/edit#gid=1191524122&range=A17:I17)
is a reference: the card's `eventType` and explicit title/body take precedence over the sheet's
`type`/`payloadJson`. The optional booking link follows the sheet. No generic JSON payload,
credentials, meeting links, signed URLs, or copied booking details belong in these display fields.

The database enforces unique `(userId, eventKey)` even for simultaneous writes; the same event
may have multiple recipients. Event keys/types must be nonblank and trimmed; title/body must
contain non-whitespace text. New rows default to unread (`readAt = null`), and `readAt` cannot
precede `createdAt`. User and booking foreign keys restrict hard deletion. Separate
`(userId, createdAt, id)` and `(userId, readAt, createdAt, id)` indexes support all/unread inboxes
with stable `(createdAt, id)` cursor ordering, including equal timestamps; `bookingId` is indexed
for joins. Read state is derived from `readAt`, without a separate status column.

RLS and revoked PUBLIC/Supabase `anon`/`authenticated` privileges keep the table behind the backend
connection. S2-DB05 adds persistence; the S2-T28 event writer below implements recipient selection,
no-self-notification checks and retry handling within domain transactions. The S2-T29 APIs below
provide authenticated, owner-only list/read access; S2-T30 owns the UI. The schema cannot determine
the actor or authorize a caller on its own.

### Notification events (S2-T28)

`NotificationEventsService` is shared by booking and reschedule services. It writes only through
the domain action's transaction client. There are no new endpoints, schema changes, background
jobs or external deliveries in this task. Notification list/read APIs are described under S2-T29 below;
the inbox UI remains S2-T30 and scheduled reminders remain Sprint 3.

| Event type             | Event key                          | Recipient                                  |
| ---------------------- | ---------------------------------- | ------------------------------------------ |
| `BOOKING_CREATED`      | `BOOKING_CREATED:<bookingId>`      | Booking tutor                              |
| `BOOKING_CONFIRMED`    | `BOOKING_CONFIRMED:<bookingId>`    | Booking student                            |
| `BOOKING_REJECTED`     | `BOOKING_REJECTED:<bookingId>`     | Booking student                            |
| `BOOKING_CANCELED`     | `BOOKING_CANCELED:<bookingId>`     | Participant other than the canceling actor |
| `RESCHEDULE_REQUESTED` | `RESCHEDULE_REQUESTED:<requestId>` | Participant other than the requester       |
| `RESCHEDULE_APPROVED`  | `RESCHEDULE_APPROVED:<requestId>`  | Original requester                         |
| `RESCHEDULE_REJECTED`  | `RESCHEDULE_REJECTED:<requestId>`  | Original requester                         |
| `RESCHEDULE_WITHDRAWN` | `RESCHEDULE_WITHDRAWN:<requestId>` | Participant other than the requester       |

Participants come from persisted booking data and the actor comes from the authenticated flow.
The writer rejects nonparticipant actors and skips self-notification. Only a successful conditional
transition produces its event. Failed/unauthorized/repeated domain actions retain their existing
error contracts and produce no notification. Repeated event writes use Prisma `createMany` with
`skipDuplicates`, backed by PostgreSQL's unique `(userId, eventKey)` index; they leave existing
IDs, title/body, creation time and read state unchanged. Each reschedule request has a separate
key even when several rounds concern the same booking.

Notification persistence failures abort the entire domain transaction. Reject/withdraw reschedule
decisions now share the booking-first lock order used by approval, preventing a request/booking
lock inversion when notification foreign keys are checked. No notification is visible before commit.
Stored English title/body are static, minimal fallback text, with no names, reasons, amounts,
class details or URLs. Future bilingual UI can translate the stable event types. There is no
backfill of historical actions.

The focused unit suites cover event recipients, no-self checks, duplicate handling and verifier
target safety. Existing booking/reschedule HTTP suites exercise guards and response contracts
with isolated persistence; they mock the event writer and do not establish notification atomicity.
For real domain services, inserts, concurrent retries/decisions and post-insert rollback across
all eight event paths, apply migrations without seeding to a new disposable PostgreSQL database:

```bash
HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 \
  DATABASE_URL='postgresql://postgres:disposable-local-only@127.0.0.1:55438/hktutor_notification_events_test' \
  pnpm db:verify:notification-events
```

This runner never loads `.env`, requires explicit opt-in and a loopback `hktutor_*_test` or
`hktutor-*-test` target, and refuses URL options/fragments. It checks all committed migrations
before creating its synthetic fixtures, removes only its own records and performs no migration
or seed itself. Discard the disposable database after success or failure. It uses actual services
and PostgreSQL, without an HTTP server, Supabase Storage or external email.

S2-T31 QA adds an HTTP-level counterpart. It serves the real booking and notification controllers,
guards, services and signed JWT sessions against the same kind of disposable database, then checks
what each user can see in their own inbox: retried and concurrent double bookings, repeated or
competing tutor decisions and cancellations, replayed event writes, no self/outsider notifications,
and that other users, a borrowed cursor, revoked sessions and admins cannot list or mark another
inbox. Run it with the same safety rules and opt-in:

```bash
HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 \
  DATABASE_URL='postgresql://postgres:disposable-local-only@127.0.0.1:55439/hktutor_notification_access_test' \
  pnpm db:verify:notification-access
```

Evidence and findings are recorded in `tests/s2-t31-qa.md`.

`node --test tests/notification-schema.test.mjs` checks the committed contract without a database.
For PostgreSQL constraint, concurrent retry, cursor and transaction rollback evidence, prepare
a newly created disposable local PostgreSQL database with all migrations and no seed, then run:

```bash
HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 \
  DATABASE_URL='postgresql://postgres:disposable-local-only@127.0.0.1:55437/hktutor_notification_test' \
  pnpm db:verify:notifications
```

The verifier requires both the opt-in and explicit loopback `hktutor_*_test`/`hktutor-*-test`
target, refuses URL options/fragments, never loads `.env`, and creates/removes only its random
fixtures. It does not migrate or seed, and is separate from `pnpm check`. This is database evidence;
event production and HTTP authorization have separate task tests. Apply this migration
before deploying any writer or reader that uses the new Prisma model.

### Notification inbox APIs (S2-T29)

All three endpoints require a valid Bearer access token and active session. The recipient always
comes from `CurrentUser`, including for administrators; no role can request a different inbox.
The existing S2-DB05 table and indexes are used without a schema migration. UI work remains T30.

| Endpoint                                           | Request                                                                                     | Success                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `GET /api/v1/notifications`                        | Optional `cursor`, `limit` (1–50, default 20), `unreadOnly` (`true`/`false`, default false) | `200 { items, nextCursor, unreadCount }` |
| `PATCH /api/v1/notifications/:notificationId/read` | UUID path; no body/query fields                                                             | `200 { id, readAt }`                     |
| `POST /api/v1/notifications/read-all`              | No body/query fields                                                                        | `200 { updatedCount, readAt }`           |

Each list item contains exactly `id`, `eventType`, `title`, nullable `bookingId`, nullable `readAt`
and `createdAt`. `bookingId` is link metadata; it does not grant access to the booking. Notification
body, event key, recipient ID and related profile data are not returned. All times are UTC ISO 8601.
The GET is read-only. A stored 1H reminder supersedes 24H reminders for the same recipient and
scheduled occurrence (booking, slot and UTC start), including a prior unpaid reminder followed by
a paid class reminder. Superseded rows remain stored with their original read receipts but are
excluded before pagination, unread counts and bulk read. Reading the 1H reminder never restores
the old 24H reminder. Other occurrences, recipients, bookings and QR prompts remain independent.
`unreadCount` counts the entire visible caller inbox, independent of page or filter;
the page and count use one repeatable-read snapshot.

Items are newest first by immutable `(createdAt, id)`. Cursor timestamps must be canonical UTC
with four-digit years 0001–9999; malformed or out-of-range boundaries fail before querying.
Send the opaque `nextCursor` back to get the
next page; it is null on the last page. Both sort fields participate in the exclusive boundary,
including timestamp ties. A cursor remains usable if its row is later marked read or deleted;
it is a boundary, not an authorization token. Every query retains the caller recipient filter.
Newer inserts appear on a fresh first page rather than being inserted into an ongoing older-page
walk. With `unreadOnly=true`, reading a row removes it from subsequent results.

Mark-one uses a single database statement to set `readAt` only when it was null, preserving the
original value on retries. It returns 403 for another recipient's existing ID, checking existence
only without loading their content, and 404 for an absent ID. Invalid UUIDs return 400
`INVALID_UUID`; invalid cursor/query or unexpected mutation inputs return 400 `VALIDATION_FAILED`.
Missing/invalid sessions return 401 `UNAUTHENTICATED`. Errors use the shared
`{ statusCode, error, message, code, details? }` envelope.

Mark-all only updates the caller's unread rows visible to its statement. Existing receipts and
other inboxes remain unchanged. Its `readAt` is the latest receipt written by that call, or null
with `updatedCount: 0` for a no-op. Database time is clamped to each notification's `createdAt`
to preserve the read-time constraint. Notification inserts after a bulk-read statement may remain
unread. There is no notification backfill or external delivery.

Focused checks: `pnpm --filter @hktutor/api test --runInBand test/unit/notifications` and
`pnpm --filter @hktutor/api test:e2e --runInBand notifications`. These exercise cursor decoding,
recipient scoping, the real HTTP guard/validation/service path and OpenAPI response schemas with
mocked persistence. They do not certify real PostgreSQL query execution, transaction isolation or
concurrent-read behavior.

### Class and payment reminders (S3-T05)

`reminder-policy.ts` in the notifications module defines when class and payment reminders are due,
who receives them and their event keys. It is pure: no database, scheduler or Nest dependency.
The [S3-T06](https://trello.com/c/Az3hWEVx) job runs it and writes the rows; S3-T07 shows them in
the inbox. This task adds no endpoint, schema change, job or package.

The time-window rules follow the [S3-T05 card](https://trello.com/c/TpOuncwb) and the product decision recorded
there on 2026-10-26, the interpretation of
[US3-2](https://docs.google.com/spreadsheets/d/17RMTjXa26ho7blv-TK5pbJFbHxVHJEBRPKCXk9x5AE0/edit#gid=443082416&range=A25:L25).
Where the sheet wording differs, the card applies: each run uses one captured UTC clock, and a
class first seen less than 24 hours ahead gets one catch-up 24H reminder. Asia/Bangkok is a fixed
UTC+7 with no daylight saving, so "computed in Bangkok time" gives the same result; Bangkok is used
only for display and examples. The payment lifecycle fix updates the recipient contract below:
class reminders now require payment. The backlog sheet is not edited by this task.

With `delta = startAtUtc - nowUtc` (the slot start and the job's clock):

| `delta`                 | Band  |
| ----------------------- | ----- |
| More than 24h           | None  |
| More than 1h, up to 24h | `24H` |
| More than 0, up to 1h   | `1H`  |
| 0 or less (started)     | None  |

Exactly 24h selects 24H and exactly 1h selects only 1H. A run never selects both bands: a job that
first sees a class 2h ahead sends the 24H reminder now and the 1H reminder later. The 1H reminder
then replaces the old 24H reminder in the inbox and badge, while both records remain stored.
A first run 30 minutes ahead sends only 1H. For a class at 2026-11-10 18:00 Asia/Bangkok
(`2026-11-10T11:00:00.000Z`):

| Job run (UTC)              | Job run (Asia/Bangkok)  | Band           |
| -------------------------- | ----------------------- | -------------- |
| `2026-11-09T10:59:59.999Z` | 2026-11-09 17:59:59.999 | None           |
| `2026-11-09T11:00:00.000Z` | 2026-11-09 18:00:00.000 | `24H`          |
| `2026-11-10T09:00:00.000Z` | 2026-11-10 16:00:00.000 | `24H` catch-up |
| `2026-11-10T09:59:59.999Z` | 2026-11-10 16:59:59.999 | `24H`          |
| `2026-11-10T10:00:00.000Z` | 2026-11-10 17:00:00.000 | `1H`           |
| `2026-11-10T10:59:59.999Z` | 2026-11-10 17:59:59.999 | `1H`           |
| `2026-11-10T11:00:00.000Z` | 2026-11-10 18:00:00.000 | None           |

Calendar days do not matter: a class at 2026-11-11 00:00 Bangkok gets its 24H reminder from
2026-11-10 00:00 Bangkok and its 1H reminder from 23:00.

| Booking                                       | Student                   | Tutor                   |
| --------------------------------------------- | ------------------------- | ----------------------- |
| `CONFIRMED`, `UNPAID`                         | `PAYMENT_REMINDER_<band>` | None                    |
| `CONFIRMED`, `PAID`                           | `CLASS_REMINDER_<band>`   | `CLASS_REMINDER_<band>` |
| `PENDING`, `COMPLETED`, `CANCELED`, `EXPIRED` | None                      | None                    |

Class reminders require `PAID` for both participants, matching classroom access. Payment suppresses
future payment reminders and enables class reminders for the current band on the next job tick;
an earlier payment reminder does not suppress the class reminders. This also includes zero-net
coupon settlement. A booking with a PromptPay charge in progress is still `UNPAID` and keeps its
scheduled payment reminder; a reminder never creates a charge.
A recipient whose account is not `ACTIVE` or has `deletedAt` set is skipped, and the other
participant is still notified.

```text
reminder:<bookingId>:<slotId>:<startAtUtcISO>:<24H|1H>:<CLASS|PAYMENT>
```

The key has no recipient: the existing unique `(userId, eventKey)` index keeps the student's and
tutor's rows apart and makes repeated ticks, retries and concurrent workers write each reminder
once. The slot ID and start time make a rescheduled booking a new occurrence with fresh keys; the
old occurrence's keys are never reused. The `reminder:` prefix cannot collide with S2-T28 keys
(`<EVENT_TYPE>:<id>`). `eventType` is already free text, so the four reminder types need no
migration.

#### Payment QR prompts

`PaymentsService` also writes `PAYMENT_QR_READY` through `NotificationEventsService` in the same
transaction that persists a verified provider charge. It goes only to the booking's student when
the booking is `CONFIRMED`, `UNPAID`, and the charge is `PENDING` with a QR URL and future expiry.
Its key is `PAYMENT_QR_READY:<paymentAttemptId>`, using the existing `(userId, eventKey)` unique
index. No schema migration or HTTP response change is needed.

Each new usable QR, including a retry after verified expiry/failure, gets one payment prompt,
independent of the 24H/1H windows. Resuming the same QR, polling and replayed webhooks preserve
the original notification and read receipt. A lost create response can recover the prompt through
the existing status-read or webhook reconciliation. Notification persistence failure rolls back
the local charge update so reconciliation can retry; it never retries the provider charge POST.
No prompt is written for CREATING, unusable/already elapsed QRs, terminal charges or zero-net
coupon settlement. Provider-confirmed expiry alone sends no notification and does not expire the
booking. Existing notifications remain historical records.

These QR prompts and the scheduled time-band payment reminders are distinct events; both can
appear when a new QR becomes available near a reminder tick. Titles and details distinguish them
in Thai/English, and the booking link always opens current payment state rather than an old QR.

Left to S3-T06: selecting `CONFIRMED` bookings whose slot starts within 24 hours, locking and
re-reading booking, payment, slot and recipient state before inserting so payment, cancellation
and rescheduling cannot race a stale scan, reminder titles/bodies, and the scheduler itself.
Invalid dates make the policy throw rather than pick a band.

Focused check: `pnpm --filter @hktutor/api test test/unit/notifications/reminder-policy`. The spec
holds the acceptance truth table: 24h ± 1 ms, the 2h catch-up, 1h ± 1 ms, a delayed 30-minute run,
start ± 1 ms, Bangkok midnight, paid and unpaid, every excluded status, inactive recipients and a
rescheduled slot. Each case's Bangkok time is checked against the `Asia/Bangkok` zone, and a
minute-by-minute sweep confirms the band changes exactly at 24h, 1h and the start. It does not
exercise PostgreSQL or the job; those belong to S3-T06 and S3-T08.

### Scheduled reminder job (S3-T06)

`ReminderJobService` in the notifications module is the only writer of the S3-T05 time-band reminders, per
the [S3-T06 card](https://trello.com/c/Az3hWEVx). It is a `@nestjs/schedule` cron named
`class-and-payment-reminders` that ticks every minute on UTC. `waitForCompletion` stops a slow run
from overlapping the next tick in the same process; the booking lock and the unique
`(userId, eventKey)` index cover other processes, so every API instance can run it and there is no
separate worker. The cron is disabled when `NODE_ENV=test`, which Jest sets, so suites that boot
`AppModule` never fire it; tests call `runOnce(nowUtc)` with a fixed clock instead.

`@nestjs/schedule` is pinned at 6.1.3 because 12.x is ESM-only and does not load under the API's
CommonJS Jest setup. There is no endpoint, queue, Redis, schema change or external delivery.
Reminders reach users through the existing `GET /api/v1/notifications` (S2-T29), for example:

```json
{
  "id": "88888888-8888-4888-8888-888888888888",
  "eventType": "CLASS_REMINDER_24H",
  "title": "Class starts within 24 hours",
  "bookingId": "11111111-1111-4111-8111-111111111111",
  "readAt": null,
  "createdAt": "2026-11-09T11:00:00.000Z"
}
```

Each run captures one UTC clock and then:

1. Scans `CONFIRMED` bookings whose slot starts in `(now, now + 24h]`, 100 per page, ordered and
   paged by `(startAtUtc, id)`, so a booking canceled or rescheduled mid-run does not shift pages.
2. Plans every booking on the page with `planReminders` and reads the page's stored reminder rows
   without locks. A booking whose planned reminders are all stored counts as duplicates and is never
   locked, so most minutes take no row locks.
3. For each remaining booking, opens one transaction, takes the same `SELECT ... FOR UPDATE` on the
   booking that payment, cancellation and reschedule take, re-reads the booking, slot and both
   recipients, plans again and inserts with `skipDuplicates`. A payment, cancellation, reschedule or
   account change committed after the scan is seen before anything is written.

Runs are sequential, so the job uses at most one of the API's three pooled connections at a time.
If the API is down, the next run sends only the band that is current then (see the S3-T05 table).

| `eventType`            | `title`                      | `body`                                                  |
| ---------------------- | ---------------------------- | ------------------------------------------------------- |
| `CLASS_REMINDER_24H`   | Class starts within 24 hours | Your lesson starts within 24 hours.                     |
| `CLASS_REMINDER_1H`    | Class starts within 1 hour   | Your lesson starts within 1 hour.                       |
| `PAYMENT_REMINDER_24H` | Payment due for your class   | Your lesson starts within 24 hours and is still unpaid. |
| `PAYMENT_REMINDER_1H`  | Payment due for your class   | Your lesson starts within 1 hour and is still unpaid.   |

The text is a fallback with no names, amounts or links (S2-T28); S3-T07 localises by `eventType`.
`NotificationEventsService.writeReminders` writes a booking's reminders in one insert and refuses
reminders whose key belongs to another booking.

`runOnce` returns `{ scanned, created, duplicates, failed }` for internal telemetry only; it is not
an HTTP contract.

- A reminder already stored is a no-op counted as a duplicate. Its ID, text, `readAt` and
  `createdAt` are kept.
- A failure on one booking rolls back that booking only, is counted as `failed` and is retried on the
  next tick while the class is still in a band. The rest of the run continues.
- A failure in the scan or the pre-check ends the run; the tick logs it and the next minute retries.
- Logs carry counts and error classes only, such as
  `Reminder booking skipped (PrismaClientKnownRequestError/P2039); retrying next tick` and
  `Reminder run: scanned=2 created=3 duplicates=0 failed=1`. The summary is logged only when
  something was created or failed. IDs, names and error messages are never logged.

Focused checks: `pnpm --filter @hktutor/api test test/unit/notifications`.
`reminder-job.service.spec.ts` covers the cron registration, scan window and keyset paging, the
lock-before-read order, payment, cancellation, reschedule and suspension after the scan, the
pre-check, failure isolation and log content. `notification-events.reminders.spec.ts` covers the text
and the single skip-duplicates insert, and `reminder-job-verifier.spec.ts` the URL guard. They use
persistence doubles and do not establish database locking.

`pnpm --filter @hktutor/api db:verify:reminders` runs the real services against PostgreSQL. Neither
root `pnpm check` nor `pnpm test` runs it. It uses the same approval flag and loopback-only URL
gates as the S2-T03 verifier above, and also requires the database name to end in `_test` or
`-test`. It refuses a database that already holds bookings, because every run scans the whole
table. Leave `NODE_ENV` unset: the runner refuses `NODE_ENV=test` because it also
checks the live cron registration. From the repository root:

```bash
nvm use 24.19.0
pnpm install --frozen-lockfile
docker run --detach --name hktutor-reminder-job-test \
  --publish 127.0.0.1:55442:5432 \
  --env POSTGRES_USER=postgres --env POSTGRES_PASSWORD=disposable-local-only \
  --env POSTGRES_DB=hktutor_reminder_job_test postgres:17-alpine
# Wait until this reports that PostgreSQL is accepting connections.
docker exec hktutor-reminder-job-test pg_isready -U postgres -d hktutor_reminder_job_test
export DATABASE_URL='postgresql://postgres:disposable-local-only@127.0.0.1:55442/hktutor_reminder_job_test'
pnpm db:generate
pnpm --filter @hktutor/api db:migrate:deploy
HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 pnpm --filter @hktutor/api db:verify:reminders
# Discard this example's container and its anonymous data volume, including after a failed run.
docker rm --force --volumes hktutor-reminder-job-test
unset DATABASE_URL
```

Each scenario uses its own day in 2099, so one 24-hour scan never sees another scenario. The
checks cover:

- The cron registered outside Jest: every minute, UTC, running, and stopped on shutdown.
- The 24h, 1h and start boundaries, exactly and ± 1 ms.
- Excluded statuses, paid bookings, and a suspended student or deleted tutor.
- A late first run, and repeats that keep the original rows and take no lock.
- Two clients, standing in for two API processes, waiting on the same booking lock.
- Payment, cancellation and reschedule committed while the job waits on a held booking lock.
- 210 bookings with three-way start-time ties across page boundaries.
- An insert failure after the payment recipient row is inserted, forced by a temporary trigger on
  `Notification` for one booking, that rolls back every recipient, logs no IDs and retries successfully.
- Fresh paid/unpaid bookings at 24h, 1h and zero, each with +/-1ms checks, plus more than 24h.
- A first run at 2h followed by a new worker at 30m, and a restart first seeing a booking at 30m.
- Separate keys for two rescheduled occurrences in the same band; inbox reads for both participants
  and read receipts preserved across repeated ticks and the start boundary.

Held-lock cases poll `pg_stat_activity` until every worker is waiting, so nothing depends on
timing. With the job's `FOR UPDATE` removed, the race checks fail. The runner removes its fixtures
and the trigger in `finally`; discard the database afterwards. Reminder eligibility uses only the
injected UTC instant; lock polling observes PostgreSQL state without sleeps. The runner prints an
evidence table with synthetic booking/slot IDs, UTC and Bangkok times, expected recipient/key pairs
and exact database assertions. See [S3-T08 QA evidence](../../tests/s3-t08-qa.md) for the executed
commands, results and inbox browser coverage. No endpoint, DTO, wire type or schema changes are needed
for this test-only extension.

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

Since S3-T19, every search runs through one raw SQL path and ranks on stored reviews. The fixture
ratings below are therefore created as real completed-booking reviews whose unrounded averages equal
the stated values, and the cached `TutorProfile.ratingAverage` stays null. The ordering and tag
assertions are unchanged.

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

## Review persistence (S3-DB01)

The additive migration `20261103120000_add_review` introduces `Review` without changing shared
migration history or inventing historical reviews. It retains `TutorProfile.ratingAverage`
(`Decimal(3,2)`), `reviewCount` and `ratingUpdatedAt` as display caches. At rollout, tutors without
reviews are reset to `null`, `0`, `null`; search seeds no longer supply synthetic ratings (S3-T19
adds real reviewed classes for two search fixtures instead). Existing
review-backed seed caches are preserved. Re-seeding also preserves a reviewed Sprint 2 ended class
and its original time window rather than resetting that evidence to confirmed.

Each review has a UUID, unique `bookingId`, private `authorStudentUserId`, `tutorProfileId`, three
integer dimensions (`clarity`, `punctuality`, `preparation`), feedback and UTC `createdAt`. No rounded
`overallRating` is stored. The descending `(tutorProfileId, createdAt, id)` index supports public
review-list cursors; `authorStudentUserId` has its own index and the unique booking index covers
booking lookup. Foreign keys restrict deleting the referenced booking, author and tutor profile.
RLS and revoked PUBLIC/`anon`/`authenticated` grants keep direct browser access closed.

### Completed booking and identity enforcement

A normal CHECK cannot inspect another table. This implementation uses a native composite foreign
key rather than a custom constraint trigger: Review's internal `bookingStatus` has default
`completed` and a CHECK that accepts only `completed`. The tuple
`(bookingId, authorStudentUserId, tutorProfileId, bookingStatus)` references Booking's unique
`(id, studentUserId, tutorProfileId, status)` tuple, with `ON DELETE RESTRICT ON UPDATE RESTRICT`.
This rejects unfinished bookings and mismatched identities and prevents later Booking updates from
invalidating existing evidence. PostgreSQL's referential locks cover both write directions,
including concurrent transactions with older snapshots. The extra Review tuple unique index is
required by Prisma to model this composite relation as one-to-one; `bookingId` remains independently
unique, so changing other fields cannot bypass one-review-per-booking enforcement.

`bookingStatus` is an internal eligibility constant, never client input or a public response field.
The database does not authenticate actors. S3-T13 must derive the author from `@CurrentUser()`, check
student role/current consent/ownership, lock and validate the booking in the write transaction,
select public fields explicitly and map duplicate/eligibility conflicts to the HTTP contract.
No Review HTTP endpoint, DTO, public wire type, or aggregate writer is introduced by this database
card; those belong to S3-T13/T17/T19. Public responses must omit student IDs and private profiles.

### Text and aggregate contract for subsequent API work

Ratings use PostgreSQL INTEGER plus inclusive `1..5` checks. Feedback is stored as literal plain
text, trimmed and nonempty, at most 1,000 Unicode code points. The SQL trim character set matches
ECMAScript `String.trim()` (including tabs, line breaks, NBSP and BOM). Interior whitespace is
allowed. A future DTO must trim first and validate `Array.from(feedback).length`, or an equivalent
code-point-aware validator, rather than UTF-16 `.length`. Combining marks count separately, matching
PostgreSQL `CHAR_LENGTH`; markup-looking text remains literal and must be escaped when rendered.

Compute a tutor's authoritative rating from raw dimensions:
`SUM(clarity + punctuality + preparation)::numeric / (3 * COUNT(*))`, with an explicit no-reviews
case of `null`/`0`. Retain that precision for filters/ranking; use HALF_UP to two decimals only for
final display. For `5/4/5` and `4/4/4`, the result is `4.33`. Do not average prematurely rounded
per-review means or use the rounded display cache as the filter/ranking source. S3-T17 owns cache
maintenance: review insertion and any cache update must share one transaction and serialize on the
tutor row before aggregating to avoid concurrent lost cache updates. The verifier demonstrates
rollback of that transaction boundary; it is not evidence of a production aggregate service.

### Disposable PostgreSQL verification

`pnpm db:verify:reviews` is separate from `pnpm check`. It never loads `.env`, migrates or seeds.
It requires explicit opt-in, an explicit loopback-only `DATABASE_URL`, a database name matching
`hktutor_*_test` or `hktutor-*-test`, no URL options/fragments, and all committed migrations applied.
It creates random synthetic fixtures and removes only those fixtures in `finally`.

After confirming that a new target is disposable, for example PostgreSQL 17:

```bash
docker run --detach --name hktutor-review-test \
  --publish 127.0.0.1:55442:5432 \
  --env POSTGRES_USER=postgres --env POSTGRES_PASSWORD=disposable-local-only \
  --env POSTGRES_DB=hktutor_review_test postgres:17
export DATABASE_URL='postgresql://postgres:disposable-local-only@127.0.0.1:55442/hktutor_review_test'
pnpm db:validate
pnpm db:generate
pnpm db:migrate:deploy
HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 pnpm db:verify:reviews
docker rm --force --volumes hktutor-review-test
unset DATABASE_URL
```

Coverage includes rating/type/null boundaries, every ECMAScript trim character, Thai/emoji text
limits, direct insert/update identity and status violations, deletion restrictions, unique-insert
contention, both directions of status contention, participant-change contention, repeatable-read
snapshot protection, cursor ties, RLS/grants and review/cache rollback. Contention is observed using
`pg_blocking_pids`, not inferred from Promise timing. See [actual evidence](../../tests/s3-db01-qa.md).

## Review API (S3-T13)

Implements the three child cards of S3-T13 on top of the `Review` table from S3-DB01 above. All
three live in the `reviews` module (`apps/api/src/modules/reviews/`), reusing the `Review`-table
contract rather than introducing a new one.

| Card   | Method and route (all under `/api/v1`) | Access                                                                   |
| ------ | -------------------------------------- | ------------------------------------------------------------------------ |
| API-01 | `POST /bookings/me/:bookingId/reviews` | Owning STUDENT with current privacy consent, booking must be `COMPLETED` |
| API-02 | `GET /bookings/me/:bookingId/review`   | Owning STUDENT                                                           |
| API-03 | `GET /tutors/:tutorId/reviews`         | Public, no JWT                                                           |

**API-01** requires `@RequireCurrentConsent()` in addition to the STUDENT role, so an authenticated
caller with missing or outdated privacy consent answers 403 `FORBIDDEN` before the service runs,
matching the S3-DB01 contract that assigns this check to S3-T13. It accepts
`{ clarity, punctuality, preparation }` as integers 1–5 and `feedback` trimmed to 1–1,000 Unicode
code points; the global validation pipe rejects any other field, including an aggregate, author or
tutor identifier supplied by the client. The booking must belong to the caller and be `COMPLETED` (an `ATTENDED` or `ABSENT` attendance outcome is equally eligible; there is no
attended-only restriction). The write locks the booking row and then the tutor row, re-validates
ownership and completion under that lock, inserts the review, and recomputes the tutor's
`ratingAverage`/`reviewCount`/`ratingUpdatedAt` from every stored review's raw dimensions in the same
transaction — not from an average of already-rounded per-review means, which would drift from the
agreed result (`5/4/5` and `4/4/4` average to `4.33`, never `4.34`). A concurrent duplicate
submission for the same booking loses the database's unique constraint and answers 409
`REVIEW_ALREADY_EXISTS`; there are no edit or delete routes, so a review is immutable once created.

**API-02** reads back the canonical saved review, or `{ review: null }` when none exists — including
for a booking that is not `COMPLETED` yet, since eligibility to submit belongs to the booking's own
detail, not to this read. It never writes and never fabricates a review.

Both private routes send `Cache-Control: no-store` and share one status code table:

| Status | Code                    | Cause                                                                  |
| ------ | ----------------------- | ---------------------------------------------------------------------- |
| 400    | `VALIDATION_FAILED`     | Malformed/unknown body field (API-01) or bad UUID                      |
| 401    | `UNAUTHENTICATED`       | Missing, invalid or expired session                                    |
| 403    | `FORBIDDEN`             | Caller is not a STUDENT, or has missing/outdated consent (API-01 only) |
| 403    | `BOOKING_NOT_OWNED`     | Booking belongs to another student                                     |
| 404    | `BOOKING_NOT_FOUND`     | No booking with this ID (matches the sibling booking routes)           |
| 409    | `BOOKING_NOT_COMPLETED` | Booking is not `COMPLETED` (API-01 only)                               |
| 409    | `REVIEW_ALREADY_EXISTS` | A review already exists for this booking (API-01 only)                 |

**API-03** is public and cursor-paginated, newest first (`createdAt DESC, id DESC`), `limit` 1–50
(default 20). It reuses the exact visibility rule the existing public tutor detail endpoint
(`getPublicTutor`) already applies — verified, active, non-deleted — rather than inventing a
stricter rule that would make this list 404 where the tutor's own profile page does not. The cursor
is an opaque, base64url-encoded, structurally validated token (the same convention already used for
conversations and notifications), with the requested `tutorId` encoded into it: a cursor minted
while paginating one tutor's list is rejected as 400 if replayed against a different tutor. The
response's `author` is reduced to a `displayName` built from the reviewing student's nickname (or a
generic label if they have none); the Prisma `select` never fetches `bookingId`, `studentUserId`,
email, phone, school or an avatar, so there is nothing to omit by convention alone. A tutor with no
reviews yet answers `200 { items: [], nextCursor: null }`, never 404.

Verification:

```bash
pnpm --filter @hktutor/api test --runInBand reviews
pnpm --filter @hktutor/api test:e2e --runInBand --runTestsByPath test/reviews.e2e-spec.ts
```

Unit tests cover the HALF_UP aggregate math against the agreed worked example, the booking lock and
re-validation, the P2002/P2003 error mappings, the cursor's cross-tutor rejection, and the privacy
exclusions in the public list. The HTTP suite exercises real validation, guards and controller
wiring with test doubles, including the full rating/feedback validation matrix and the
`{ review: null }` and empty-list shapes. See S3-T15 below for the real PostgreSQL race.

### Review QA (S3-T15)

Local verification on 2026-11-07, using Node.js 24.20.0, pnpm 11.19.0 and PostgreSQL 17.11:

| Command                                                                                     | Result                                                                        |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `pnpm --filter @hktutor/api test --runInBand reviews`                                       | 57 unit cases passed                                                          |
| `pnpm --filter @hktutor/api test:e2e --runInBand --runTestsByPath test/reviews.e2e-spec.ts` | 56 HTTP contract cases passed                                                 |
| `pnpm --filter @hktutor/web test:e2e review-ui.spec.ts --workers=2`                         | 48 passed across desktop, tablet and mobile Chromium                          |
| `pnpm --filter @hktutor/api db:migrate:deploy`                                              | 24 migrations applied to the new disposable database                          |
| `pnpm --filter @hktutor/api db:verify:review-submissions`                                   | Real PostgreSQL, signed JWTs, and the review HTTP routes passed               |
| `pnpm db:verify:reviews`                                                                    | Direct PostgreSQL constraint, Unicode, uniqueness, and rollback checks passed |

Workspace verification:

- `pnpm check` generated Prisma Client and stopped at `format:check` on 625 existing CRLF files
  in the Windows checkout. Default Prettier passed for the six changed files, and
  `pnpm exec prettier --check --end-of-line auto .` passed across the workspace.
- `pnpm lint` picked up the local `.pnpm-store` cache. Root lint passed with
  `pnpm exec eslint . --max-warnings=0 --ignore-pattern '.pnpm-store/**'`;
  `pnpm -r --if-present lint` passed for the workspace packages.
- `pnpm test` passed: 1,560 API cases and 558 web cases. `pnpm build` passed for API and web,
  including API script typechecking.

The HTTP contract checks all three rating dimensions independently and trims feedback before
enforcing the 1–1000 Unicode code point range. The browser suite intercepts API traffic to check
unfinished booking states, duplicate and lost response recovery, draft preservation on retry,
and rendering markup-like feedback as plain text. It does not write to PostgreSQL.

The database verifier observed both POST transactions waiting on the same booking lock before
releasing it. One returned 201 and the other 409 `REVIEW_ALREADY_EXISTS`. Denied requests created
zero reviews. The owner read returned the winning review; equal-timestamp public pages had no
duplicates or private fields, and unverified/suspended tutors returned 404.

| PostgreSQL evidence               | Before the race | After the race |
| --------------------------------- | --------------- | -------------- |
| Review rows for the raced booking | 0               | 1              |
| Review rows for the tutor         | 1               | 2              |
| Cached review count               | 1               | 2              |
| Cached rating average             | 4.00            | 4.33           |

To reproduce, create a fresh PostgreSQL 17 container with the database `hktutor_s3_t15_test`,
published on `127.0.0.1` only. Set `DATABASE_URL` in the test shell to that container's database
and set `HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1`. Run `pnpm db:generate`, then the three database
commands above in order. The new verifier refuses other database names, non-loopback addresses,
URL options and nonempty user tables. It uses synthetic fixtures and leaves them in the container
for inspection. Stop the disposable container when finished; no seed is required.

## Tutor review rating caches and detail (S3-T17)

S3-T17 owns raw review aggregate calculation, cache maintenance/reconciliation and
`GET /api/v1/tutors/:tutorId` (API-02). Search/filter/ranking/HIGHEST_RATED integration and search
fixture changes belong to S3-T19/API-01; UI presentation belongs to S3-T18. The detail endpoint
retains its `{ tutor, listings }` wrapper, numeric `ratingAverage | null` and integer `reviewCount`.
Unknown query parameters and invalid UUIDs return 400; missing or non-public tutors return 404.

`modules/reviews/review-ratings.ts` shares raw dimension totals/count between review creation and
cache rebuilding. It preserves the unrounded numerator and count for later consumers and applies
explicit HALF_UP rounding only to the two-decimal display cache. `5/4/5` and `4/4/4` therefore
display `4.33` with count `2`, never `4.34`. No reviews means `null`, `0`, `null` for average, count
and `ratingUpdatedAt`; otherwise the timestamp is the latest stored review's `createdAt`.

Review insertion and cache refresh share the existing booking-then-tutor locking transaction.
Reconciliation locks one tutor at a time before reading reviews, using READ COMMITTED so reviews
committed while waiting for that lock are included. It scans tutors by ID in batches of 100,
including private/hidden tutors, without changing visibility. Each tutor commits independently;
an interrupted run can be restarted. Re-running preserves the derived cache values and review
timestamp, although the profile's normal `updatedAt` advances. It never inserts/deletes reviews,
changes bookings or invents historical ratings.

### Rebuild caches on an explicitly selected target

This is a write operation. Confirm the intended database before setting an explicit `DATABASE_URL`
and opting in:

```bash
# Supply DATABASE_URL for the separately confirmed target; the command never loads .env.
HKTUTOR_APPLY_REVIEW_RATING_RECONCILIATION=1 pnpm db:reconcile:review-ratings
```

The command does not migrate or seed. It fails without both the explicit target and opt-in, stops
with a nonzero exit code on failure, and logs only aggregate progress rather than credentials,
raw driver errors or private review data. Do not treat a partial failed run as a completed rebuild.

### Real PostgreSQL verification

```bash
# Use a new, empty, migrated disposable PostgreSQL database only.
HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 pnpm db:verify:review-ratings
```

The verifier requires an explicit loopback-only `DATABASE_URL`, a `hktutor_*_test` or
`hktutor-*-test` database name, no URL options/fragments and all migrations already applied. It
never loads `.env`, migrates or seeds. It exercises the real ReviewsService, cache helpers,
TutorDirectoryService and public detail HTTP pipeline against PostgreSQL. It observes actual row
lock contention for concurrent review writers and reconciliation, forces cache-write failure to
prove review rollback, repairs stale/no-review caches across a batch boundary, checks preserved
history and repeated rebuilding, and verifies fresh numeric detail/search values and visibility.
Only randomly identified synthetic fixtures and a temporary failure trigger are removed in
`finally`. See [S3-T17 verification evidence](../../tests/s3-t17-qa.md).

## Tutor search review ratings (S3-T19)

`GET /api/v1/tutors` (S3-T19/API-01) takes every rating it filters, ranks, tags and returns from
stored `Review` rows, using S3-T17's raw totals: the sum of each review's three scores and the review
count. Search never reads the rounded `TutorProfile.ratingAverage` cache, which still serves the
detail endpoint (S3-T17/API-02) and private profiles. The request and response contract is
unchanged: the same query DTO and 400 responses, numeric `ratingAverage | null` and integer
`reviewCount`.

| Rule                           | Behaviour                                                                                                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `minimumRating`                | Inclusive and exact: `total >= minimumRating × 3 × count`, with no division or rounding. 13/3 (4.333…) passes 4.33 and fails 4.34. Tutors without reviews are excluded.                     |
| Rating sort                    | The unrounded average at a fixed 20-decimal scale, so 13/3 and 26/6 tie and 4.1333 sorts above 4.125. No reviews sorts last in both directions. Ties keep the S2-T13 order.                 |
| `HIGHEST_RATED`                | Every listing whose average exactly equals the best of the whole matching set, compared by cross-multiplying, before pagination. 4.1333 and 4.125 both display 4.13; only 4.1333 is tagged. |
| `ratingAverage`, `reviewCount` | From the same totals, HALF_UP to two decimals with S3-T17's `tutorReviewDisplayAverage`: 5/4/5 and 4/4/4 show 4.33 with count 2. No reviews gives `null` and `0`.                           |

Each search runs in one read-only REPEATABLE READ transaction: a summary over the full matching set
(total, lowest price, earliest free slot), the best raw rating for `priority=highest_rating`, the
page of listing IDs, and finally the ORM load of those listings' public fields. A review committed
mid-search therefore cannot make the page, `total` and tags disagree. The SQL pieces live in
`modules/tutors/tutor-search-query.ts`, whose visibility conditions mirror `publicListingWhere` and
`publicTutorWhere`. There is no schema change; `Review`'s `(tutorProfileId, createdAt, id)` index
serves the per-tutor totals.

### Seeded review fixtures

`review-fixtures.seed.ts` gives two search fixtures real rating history instead of seeded
aggregates. Mali has two completed, attended, paid classes reviewed 5/4/5 and 4/4/4 (4.33), and Kiet
one reviewed 4/4/4 (4.00); the seeded student wrote the reviews. Rows use fixed IDs and are only
ever created, never updated, so re-seeding cannot reset live reviews or bookings. Each tutor's cache
is then rebuilt with S3-T17's `refreshLockedTutorReviewRating` under the tutor row lock. Anan, Niran
and Pim keep no reviews, so Anan still shows the New tutor state until the live demo review.

### Verification

Focused checks: `pnpm --filter @hktutor/api test test/unit/tutors test/unit/database/seed`. They
cover the SQL pieces (`tutor-search-query.spec.ts`), exact rating comparison and tags
(`tutor-ranking.spec.ts`), the snapshot statements, filters, ordering and display
(`public-tutors.service.spec.ts`, `tutor-ranking-explanations.service.spec.ts`), the seed
(`review-fixtures.seed.spec.ts`) and the verifier URL guard. They use persistence doubles and do not
establish PostgreSQL arithmetic.

`pnpm --filter @hktutor/api db:verify:search-ratings` runs the real search, review and S3-T17
services against PostgreSQL. Neither root `pnpm check` nor `pnpm test` runs it. It uses the same
approval flag and loopback-only URL gates as the S3-T17 verifier above, and refuses a database that
already has tutor profiles, because one check runs S3-T17 reconciliation across every tutor. From
the repository root:

```bash
nvm use 24.19.0
pnpm install --frozen-lockfile
docker run --detach --name hktutor-search-ratings-test \
  --publish 127.0.0.1:55443:5432 \
  --env POSTGRES_USER=postgres --env POSTGRES_PASSWORD=disposable-local-only \
  --env POSTGRES_DB=hktutor_search_ratings_test postgres:17-alpine
# Wait until this reports that PostgreSQL is accepting connections.
docker exec hktutor-search-ratings-test pg_isready -U postgres -d hktutor_search_ratings_test
export DATABASE_URL='postgresql://postgres:disposable-local-only@127.0.0.1:55443/hktutor_search_ratings_test'
pnpm db:generate
pnpm --filter @hktutor/api db:migrate:deploy
HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 pnpm --filter @hktutor/api db:verify:search-ratings
# Discard this example's container and its anonymous data volume, including after a failed run.
docker rm --force --volumes hktutor-search-ratings-test
unset DATABASE_URL
```

Every fixture rating is a set of completed, attended bookings with real reviews, and each fixture
group has its own random subject. The 8 checks cover:

- Exact thresholds: 13/3 passes 4.33 and fails 4.34; 4.00 passes 4 but not 4.01; 1.00 passes 1.
- Unreviewed tutors as `null`/`0` and last, and five hidden tutors (unverified, suspended, deleted
  account, draft listing, deleted listing) with perfect reviews that never appear or take a tag.
- 4.1333 and 4.125, which both display 4.13 but rank, tag and filter apart.
- An exact 13/3 and 26/6 tie, and pages of one that keep the order and full-set tags.
- `lowest_price` breaking a price tie by raw rating, `earliest_availability`, and an inclusive 5.
- A stale 1.00/77 cache that never drives search, then rebuilt to 4.00/2 by S3-T17 reconciliation.
- Six concurrent `ReviewsService` reviews, shown as 4.17/6 by both search and the detail cache.
- Every search result matching S3-T17's `readTutorReviewTotals` and HALF_UP display rule.

With `minimumRating` compared on the rounded average instead, the third check fails. The S2-T15
`db:verify:tutor-ranking` and S3-T17 `db:verify:review-ratings` verifiers also pass against this
code. The runner removes its fixtures in `finally`; discard the database afterwards.

## Tutor rating regression (S3-T20)

S3-T20 is the US8-2 regression suite for tutor ratings. It changes no production code. A rating is
the sum of every review's three scores divided by three times the review count, rounded HALF_UP to
two decimals only when displayed. Search filters, sorts and tags compare the unrounded value
(S3-T19), the detail endpoint reads the S3-T17 cache, and the web formats the API value without
re-averaging (S3-T18).

### Acceptance wording change for S3-T39

The backlog sheet's US8-2 criterion reads "Given review overall means 4.67 and 4.00. When displayed.
Then average=4.34 and reviewCount=2." The product decision approved on 2026-10-26 replaces 4.34
with **4.33**: aggregate the raw dimensions first and round once at display, so 5/4/5 and 4/4/4 give
26/6 = 4.333… and display 4.33. The 4.34 only appears when each review's mean is rounded first
(4.67 and 4.00 average to 4.335). Averaging the unrounded per-review means also gives 4.33. The
sheet is not edited; S3-T39 records the final wording, suggested as "Given reviews 5/4/5 and 4/4/4
(means 4.67 and 4.00). When displayed. Then average=4.33 and reviewCount=2." The zero-review
criterion (New tutor, count 0, never 0.00) is unchanged.

### Coverage

| Requirement                                                                   | Tests                                                                                                                                                                                        |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4.33, not 4.34; no per-review rounding; HALF_UP display; count 2              | `review-ratings.spec.ts`, `reviews.service.spec.ts`, `db:verify:rating-regression` check 1                                                                                                   |
| A fresh review updates average and count                                      | `db:verify:rating-regression` check 1 (null/0, then 4.67/1, then 4.33/2 on detail, search and cache)                                                                                         |
| Exact 1 and 5 bounds, a single review                                         | `review-ratings.spec.ts`, `reviews.e2e-spec.ts` (accepts 1 and 5), `db:verify:rating-regression` check 2                                                                                     |
| Zero reviews: `null`/`0`, New tutor, never 0.00                               | `db:verify:rating-regression` check 3, web `tutor-rating.test.ts`, `tutor-rating-ui.spec.ts`                                                                                                 |
| Concurrent reviews and cache rebuild                                          | `db:verify:review-ratings`, `db:verify:search-ratings` (six concurrent reviews, stale cache), `db:verify:review-submissions` (S3-T15 duplicate race, cache 4.00 to 4.33)                     |
| Unicode feedback leaves ratings unchanged                                     | `reviews.e2e-spec.ts` (1000 code points, markup), `db:verify:rating-regression` check 4                                                                                                      |
| `minimumRating` exact and inclusive; sort and `HIGHEST_RATED` from one source | `tutor-search-query.spec.ts`, `tutor-ranking.spec.ts`, `db:verify:search-ratings`, `db:verify:rating-regression` checks 1–3                                                                  |
| Pagination and verified-only visibility                                       | `db:verify:search-ratings`                                                                                                                                                                   |
| Card, profile and comparison displays                                         | web `tutor-rating.test.ts`, `tutor-rating-ui.spec.ts` (search, detail, profile, listing editor), `tutor-comparison.test.ts` (S3-T20 rating cases), `tutor-comparison-ui.spec.ts` (New tutor) |
| Seeded ratings come from real reviews                                         | `review-fixtures.seed.spec.ts`, `db:verify:tutor-ranking` (ratings created as reviews)                                                                                                       |

### Verification

`pnpm --filter @hktutor/api db:verify:rating-regression` creates every review through the real
`ReviewsService` and reads it back through the real public detail and search methods. Neither root
`pnpm check` nor `pnpm test` runs it. It uses the same approval flag and loopback-only URL gates as
the verifiers above. The four rating verifiers can share one disposable database; run S3-T17's
first, because it requires an empty one. From the repository root:

```bash
nvm use 24.19.0
pnpm install --frozen-lockfile
docker run --detach --name hktutor-rating-regression-test \
  --publish 127.0.0.1:55443:5432 \
  --env POSTGRES_USER=postgres --env POSTGRES_PASSWORD=disposable-local-only \
  --env POSTGRES_DB=hktutor_rating_regression_test postgres:17-alpine
# Wait until this reports that PostgreSQL is accepting connections.
docker exec hktutor-rating-regression-test pg_isready -U postgres -d hktutor_rating_regression_test
export DATABASE_URL='postgresql://postgres:disposable-local-only@127.0.0.1:55443/hktutor_rating_regression_test'
pnpm db:generate
pnpm --filter @hktutor/api db:migrate:deploy
export HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1
pnpm --filter @hktutor/api db:verify:review-ratings
pnpm --filter @hktutor/api db:verify:tutor-ranking
pnpm --filter @hktutor/api db:verify:search-ratings
pnpm --filter @hktutor/api db:verify:rating-regression
# Discard this example's container and its anonymous data volume, including after a failed run.
docker rm --force --volumes hktutor-rating-regression-test
unset DATABASE_URL HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY
```

The 4 rating regression checks cover:

- 5/4/5 then 4/4/4: per-review means 4.67 and 4.00; the tutor goes from `null`/`0` to 4.67/1 to
  4.33/2 on detail, search and cache, never the 4.34 of averaging rounded means. `minimumRating`
  4.33 includes the tutor and 4.34 excludes them.
- 1/1/1 is 1.00 and passes 1; 5/5/5 is 5.00, the only tutor passing 5 and the only `HIGHEST_RATED`;
  1/1/1 plus 5/5/5 is exactly 3.00; a single 5/5/4 review shows 4.67 but fails `minimumRating=4.67`.
- Zero reviews: `null`/`0` everywhere with no rating timestamp, sorted after a rated tutor, never
  `HIGHEST_RATED` even as the only result, and excluded by `minimumRating=1`.
- 1000 code points of Thai with stacked marks, a ZWJ emoji, combining accents and markup-looking
  text are stored and read back exactly, and the rating matches a twin with ASCII feedback.

The runner removes its fixtures in `finally`; discard the database afterwards. The browser check of
a fresh review (two reviews submitted through the UI against a disposable stack, then search,
detail and comparison) is recorded as manual evidence in the S3-T20 pull request.

## Coupon persistence (S3-DB02)

`20261109120000_add_coupon_persistence` is additive. It introduces `Coupon`, `CouponReservation`,
`CouponUse` and a separate minimal `AuditLog`. Existing Booking money fields, PromptPay and
reschedule constraints remain intact. Coupon APIs/UI, applicability/expiry validation, discount
calculation, Booking snapshots and payment orchestration belong to S3-T21/T25/T26 and S3-DB03.
There are no new HTTP routes or wire types in this database card.

### Codes, claims and capacity

Coupon codes use `extensions.CITEXT` with unique indexing. A trigger trims the ECMAScript whitespace
set and uppercases the code; empty normalized codes are rejected. Thus `welcome_10` and `WELCOME_10` collide even for direct SQL.
Percent is an integer 1–100, maxUses an integer >=1, expiry a UTC timestamptz and active a boolean.
Creation does not require a future expiry: the subsequent admin API owns that validation.
The descending `(createdAt,id)` index supports admin pagination.

Capacity is `COUNT(CouponUse) + COUNT(CouponReservation WHERE status='RESERVED')`. A CONSUMED
reservation is never counted again. There is no writable usage cache that can drift. Before each
new claim, SQL forces a Booking row update followed by a Coupon row update, then checks
`0 <= used + reserved + 1 <= maxUses`. These no-op writes serialize competing direct writers and
make an older repeatable-read snapshot fail with `40001` rather than accept stale counts.
Reducing maxUses uses the same coupon row and rejects a limit below existing claims.
Partial indexes permanently claim `(couponId,studentUserId)` for RESERVED/CONSUMED and claim
bookingId for RESERVED. A separate permanent CouponUse booking unique key, checked under the
booking lock, also prevents reserving a different coupon after a booking has consumed one.
Released reservations do not claim capacity or a student, allowing a new attempt to retry.

Composite foreign keys bind each reservation/use to the booking's actual student, and each
non-null paymentAttemptId to the same booking. Referenced evidence cannot be deleted/reassigned.
Discount amounts are Decimal(10,2), nonnegative and reject PostgreSQL numeric NaN. The discount
is an immutable snapshot; this card does not calculate it or validate it against the percentage.

### One settlement path

Always write a reservation; never insert CouponUse from application code. The consumption trigger
creates exactly one CouponUse with the reservation's ID and immutable identity/amount/time. It also
writes the audit event in the same statement/transaction. A direct CouponUse insertion without
that exact canonical CONSUMED reservation is rejected.

- For PromptPay, insert RESERVED with a unique paymentAttemptId. Keep it reserved while the provider
  outcome is active or uncertain. Transition to CONSUMED only after persisting SUCCESSFUL on the
  attempt; transition to RELEASED only after persisting FAILED/EXPIRED. SQL checks the persisted
  terminal status while locking the attempt. An elapsed expiresAt alone cannot release a claim.
- For a zero settlement, insert CONSUMED with a null paymentAttemptId and consumedAt. SQL requires
  Booking.netAmount=0. This creates CouponUse directly through the same trigger and coupon lock;
  do not call Omise. The future payment flow must mark the booking paid in that transaction using
  the S3-DB03 zero-payment contract; this migration deliberately preserves existing payment checks.
- Only RESERVED may change status. Supply consumedAt or releasedAt for that terminal transition,
  at or after createdAt, leaving the other null. Terminal rows and all snapshot/identity fields are
  immutable. Repeating the exact same terminal write is a no-op with no extra use or audit event.
  Replays that change timestamps fail. Reuse the original reservation ID for insert retries with
  `ON CONFLICT (id) DO NOTHING` (only identical immutable input is accepted), and
  read the canonical row after a duplicate-key response; never mint another charge to resolve an
  uncertain result.

Payment writers must keep the existing booking lock first, then coupon, then attempt. Lock multiple
bookings/coupons in a stable ID order. Retry whole transactions on serialization/deadlock failures;
never retry only the final write. Verify provider terminal evidence before recording it and never
regress a terminal provider outcome. SQL verifies persisted status, not webhook authenticity.
Current consent, student role, authenticated ownership, active/unexpired applicability, amount
math and the atomic Booking/payment changes remain the API's responsibility.

### Minimal append-only audit

Triggers write `coupon.create`, `coupon.reserve`, `coupon.release` and `coupon.consume` with unique
`action:entityId` operation keys. Creation JSON contains only percent/maxUses/active. Reservation
JSON contains only status/discountAmount and an optional prior RESERVED status. SQL rejects other
keys and invalid value shapes; do not persist raw provider responses, secrets, QR URLs or student
contact information. The optional actor and request context can be set by a trusted API transaction:

```sql
-- Bind these values as SQL parameters; derive the actor from the authenticated session.
SELECT set_config('hktutor.audit_actor_user_id', $1, true);
SELECT set_config('hktutor.audit_request_id', $2, true);
```

Use an opaque request identifier of 1–100 ASCII letters/digits/`._:-`; omit it if unavailable.
Transaction-local settings prevent pool context leaking into another request. The actor FK rejects
unknown users, but does not authenticate the actor; API authorization is mandatory. Direct maintenance
writes without context record a null actor. An audit failure rolls back the reservation, use and
capacity change together. AuditLog and CouponUse reject UPDATE/DELETE; reservations reject DELETE;
all four tables reject TRUNCATE. Coupons are retained and can be deactivated rather than deleted.
RLS and revoked PUBLIC/browser-role grants keep access behind the backend. As with other migrations,
these protections assume a trusted migration owner; a superuser can alter database protections.

### Disposable verification

`pnpm db:verify:coupons` shares the existing review verifier's target guard: explicit opt-in,
explicit loopback DATABASE_URL, a `hktutor_*_test`/`hktutor-*-test` name, no URL options/fragments,
and all committed migrations applied. It never loads `.env`, migrates, seeds or deletes evidence.
It leaves randomly identified synthetic evidence behind, so discard the disposable database after
running it. It is separate from `pnpm check`.

```bash
# Create a NEW isolated test container; never point these commands at the shared/demo DB.
docker run --detach --name hktutor-s3-db02-test \
  --publish 127.0.0.1:55449:5432 \
  --env POSTGRES_USER=postgres --env POSTGRES_PASSWORD=disposable-local-only \
  --env POSTGRES_DB=hktutor_coupon_test postgres:17
export DATABASE_URL='postgresql://postgres:disposable-local-only@127.0.0.1:55449/hktutor_coupon_test'
pnpm db:migrate:deploy
HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 pnpm db:verify:coupons
# Retained rows are synthetic evidence created in this disposable container only.
docker rm --force --volumes hktutor-s3-db02-test
unset DATABASE_URL
```

The verifier checks direct SQL boundaries/identity, normalized code collision, real row-lock
contention for capacity/student/booking/maxUses races, repeatable-read safety, released retry,
consume/release retries, zero settlement, append-only/JSON/privacy constraints, audit failure and
transaction rollback, RLS/grants and preservation of existing payment/reschedule indexes.
See [S3-DB02 evidence](../../tests/s3-db02-qa.md) for actual commands/results and limitations.

## Booking coupon snapshots (S3-DB03)

`20261111120000_add_booking_coupon_snapshots` adds nullable `appliedCouponId`,
`appliedCouponCode` and `appliedCouponPercent` to Booking and PaymentAttempt. The FK restricts
coupon deletion; the code/percent are stored evidence. Changing a live Coupon never changes a
booking or an attempt's snapshot. No original column is recreated and no row is backfilled from
a current listing or coupon: historical amounts, paid flags, timestamps, references, active
attempts, cancellations and reschedules are retained exactly. Legacy coupon/discount evidence
with no association continues to read as `coupon: null`.

Booking list/detail (student and tutor) now return `coupon: { id, code, percent } | null`.
Payment create/current responses additionally return stored `subtotalAmount`, `discountAmount`,
`netAmount`, `currency` and `coupon`; the attempt has its own `amount`, `currency` and `coupon`.
Payment response reads use one repeatable-read transaction. Money remains fixed-decimal strings;
these fields never use live listing prices or the live Coupon relation. The web wire types keep
the additive fields optional during API-first rollout. Existing pre-booking quote/create flows
are unchanged; booking coupon quote/apply/remove endpoints belong to T25.

The existing nonnegative/balance/THB checks already imply `0 <= discount <= subtotal`.
The new checks require all three coupon fields together, percent 1–100, canonical code and
`discount = round(subtotal * percent / 100, 2)`. At application, code/percent must match the
coupon under a row lock. Role, consent, ownership, active/expiry and applicability checks remain
the responsibility of the T25 API. Removing a coupon must clear all three fields and restore
the undiscounted amounts in the same conditional update.

Pricing/coupon changes fail while the prior booking is payment-pending/paid, an active attempt
or reservation exists, or CouponUse exists. Attempts lock the booking and must copy its exact
amount/currency/snapshot; those attempt fields cannot subsequently change. Legacy failed attempts
retain their original amounts even if the unpaid booking is repriced later. New snapshot-bearing
reservations must match the booking discount and their attempt. DB02 continues to copy that exact
amount to immutable CouponUse; all-null legacy reservations retain their existing DB02 contract.
Writers must keep the existing booking → coupon → attempt lock order. The payment service's
conditional claim now compares the whole pricing/coupon snapshot, including same-net changes.

`20261111160000_preserve_coupon_reservation_retries` corrects the reservation guard without
rewriting the already-applied DB03 migration. An identical stable-operation retry is checked against
the original reservation before current booking pricing is considered. After failure/release and
repricing or coupon replacement, `INSERT ... ON CONFLICT (id) DO NOTHING` still inserts zero rows
and preserves the original terminal state, timestamps, discount and audit evidence. Reusing an ID
with changed immutable input is rejected; a new ID still requires the current booking/attempt
snapshot. The existing DB02 guard continues to serialize booking → coupon writes before this check.

New zero pricing requires a 100% coupon. Existing zero history can still change non-pricing
fields. A zero paid booking requires `paymentReference = coupon:<CouponUse.id>`, the matching
student/booking/coupon/discount evidence and no provider attempt. A deferred constraint checks
the receipt at commit so Booking and consumption can be written in either order in one
transaction. Positive coupon settlement requires matching consumption and a successful matching
attempt. The unique payment-reference index remains in force. Provider attempts retain the
existing THB 20.00–150,000.00 range; no zero Omise attempt is fabricated.

S3-T26 now uses this foundation to reserve capacity, settle or release atomically; see the
[coupon payment contract](#coupon-payment-orchestration-s3-t26). T25 quote/apply/remove endpoints
remain separate. `/mock-payment` remains retired with 410. No provider charge is replayed by
the migration or snapshot verifier.

### Disposable upgrade verification

`pnpm db:verify:booking-snapshots` requires `HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1`, an explicit
loopback URL with a `hktutor_*_test`/`hktutor-*-test` name, no URL options/fragments, and an
**empty** public schema. It refuses an existing database and never loads `.env`, resets data or
calls Omise. It replays the committed migrations through DB02, creates synthetic legacy
mock/PromptPay/discount/zero/canceled/rescheduled evidence, then executes DB03. It compares every
original Booking/PaymentAttempt field and existing indexes/checks, validates snapshots and
settlement, and observes real row-lock contention. Append-only evidence stays in that disposable
database; discard the container afterwards. It runs separately from `pnpm check`.
The runner also reproduces the released-retry failure on original DB03, applies the forward
correction, and verifies identical/concurrent retries after repricing and coupon replacement,
rejection of changed immutable input and stale new claims, and successful current-price claims.

```bash
docker run --detach --name hktutor-s3-db03-test \
  --publish 127.0.0.1:55453:5432 \
  --env POSTGRES_USER=postgres --env POSTGRES_PASSWORD=disposable-local-only \
  --env POSTGRES_DB=hktutor_booking_snapshot_test postgres:17-alpine
docker exec hktutor-s3-db03-test pg_isready -U postgres -d hktutor_booking_snapshot_test
# This runner itself tests the upgrade: do NOT migrate or seed this empty database first.
HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 \
  DATABASE_URL='postgresql://postgres:disposable-local-only@127.0.0.1:55453/hktutor_booking_snapshot_test' \
  pnpm db:verify:booking-snapshots
docker rm --force --volumes hktutor-s3-db03-test
```

Apply the new additive migration through the normal reviewed deployment workflow **before**
deploying the new API. Roll back application code without removing committed snapshot/evidence
columns. Database/provider-backed coupon journeys, new endpoints and their full API authorization
matrix remain T25/T26/T28; this verification does not certify live Omise behavior.
Databases with the original DB03 already applied must also apply the forward retry correction;
the correction changes only the trigger function, without rewriting any evidence rows.
See [S3-DB03 evidence](../../tests/s3-db03-qa.md) for actual commands/results.

## Admin coupon APIs (S3-T21)

All admin coupon routes require a Bearer access JWT backed by an active session, a verified active account
and the database-backed ADMIN role. Administrators do not require privacy consent to use admin
coupon tools; missing or outdated consent does not block creation, listing or activation. No consent checkbox
or consent record backfill is needed. This follows the existing admin qualification-review access
policy. `JwtAuthGuard` runs before `RolesGuard`; Student/Tutor consent rules remain unchanged.
Responses use `Cache-Control: no-store`; failures follow the existing
`{ statusCode, error, message, code }` envelope. Missing/invalid/revoked credentials return 401;
wrong roles return 403. No caller-supplied identity is accepted.

### Create

`POST /api/v1/admin/coupons` returns 201 with the coupon metadata below.

```json
{
  "code": "WELCOME10",
  "percent": 10,
  "expiresAt": "2026-11-30T16:59:59.000Z",
  "maxUses": 100,
  "active": true
}
```

- `code` is trimmed and ASCII lowercase letters are uppercased before checking
  `[A-Z0-9_-]{3,32}`. Non-ASCII codes are rejected. The existing CITEXT unique index protects
  concurrent creation: `welcome10` conflicts with `WELCOME10`, returning 409 `COUPON_CODE_EXISTS`.
- `percent` is a JSON integer 1–100; `maxUses` is a JSON integer 1–2147483647. Strings, fractions,
  nulls and unknown fields fail with 400 `VALIDATION_FAILED`.
- `expiresAt` is a valid, full UTC ISO 8601 instant ending in `Z`, with seconds and optionally
  1–3 fractional digits. It must be strictly later than the server time, rechecked after acquiring
  a transaction connection. Date-only values, offsets and excess precision are rejected. Convert
  Bangkok inputs to UTC before submission: 2026-11-30 23:59:59 Bangkok is the example above.
  Expiry is exclusive: `now >= expiresAt` means expired.
- `active` is an optional JSON boolean, default true; explicit false is retained. Activation can
  subsequently be changed through the dedicated route below. No price/code/expiry editing or
  deletion route is provided.

The service sets transaction-local `hktutor.audit_actor_user_id` from `CurrentUser`. DB02's insert
trigger creates exactly one append-only `AuditLog` with `action: coupon.create`, `entityType: Coupon`,
the new coupon ID and safe `afterData: { percent, maxUses, active }`. Coupon and audit commit or
roll back together; pool connections cannot retain the actor context. This uses the implemented
DB02 action name **coupon.create**, replacing the card's planned **COUPON_CREATED** spelling;
it does not add a second audit or reuse `TutorDocumentAudit`. Audit failures remain generic 500
errors and are not mistaken for a coupon code collision. No new migration is needed.

### Activation

`PATCH /api/v1/admin/coupons/:couponId/activation` accepts exactly `{ "active": true }` or
`{ "active": false }` and returns 200 with the same current metadata/capacity shape as listing.
It requires an active, verified ADMIN session, without privacy consent. Missing/invalid/revoked
sessions return 401, other roles 403, malformed UUID or missing/null/nonboolean/extra body fields
400 and a missing coupon 404. Successful responses use `Cache-Control: no-store`.

The request specifies the desired state; it never blindly flips a bit. The service locks the
coupon row, writes only `active` and the normal `updatedAt`, and writes an actor-bound
`coupon.active_change` audit in the same transaction. A repeated current state returns the
existing record without changing its timestamp or adding an audit. Concurrent writes serialize
with one another and payment capacity claims. Pricing, expiry, maxUses, CouponUse and all
reservation evidence remain unchanged. Activation does not renew an expired/exhausted coupon.
Deactivation prevents new claims, while previously reserved QR payments remain honored.

Apply `20261112120000_add_coupon_activation_audit` before deploying this API/UI extension.
The forward migration extends only the two AuditLog check constraints: existing creation and
reserve/consume/release rules remain intact. New activation events contain exactly
`beforeData: { active }` and `afterData: { active }` with different booleans, a nonnull authenticated
actor, `entityType: Coupon`, the coupon ID and a unique `coupon.active_change:<AuditLog.id>` key.
Using the event ID allows repeated state changes without altering old operation keys. Audit
append-only protections remain. No existing rows or coupon amounts are rewritten, and Prisma
model fields do not change. Activation audit failure rolls back the status change, including
when the old database has not received this migration; the API never commits an unaudited change.

The coupon register displays Activate/Deactivate per row in Thai/English. It updates badges/counts
only from a successful PATCH response, blocks duplicate actions and overlapping list reads, and
retains the current list/selection order. After an uncertain result, that coupon's control remains
blocked with refresh guidance until a successful authoritative list read. A failed refresh cannot
clear this gate; 401/403 removes coupon data and returns the existing access recovery view.

### List and capacity

`GET /api/v1/admin/coupons?limit=20&cursor=<opaque>` returns `{ items, nextCursor }`.
Limit is 1–50, default 20; the exclusive, validated base64url cursor is at most 512 characters.
Unknown query parameters, malformed/repeated values and invalid cursors return 400.
Ordering is `createdAt DESC, id DESC`, including ties; empty/end pages return `items: []` and
`nextCursor: null`. Each item has exactly:

```json
{
  "id": "66666666-6666-4666-8666-666666666666",
  "code": "WELCOME10",
  "percent": 10,
  "expiresAt": "2026-11-30T16:59:59.000Z",
  "maxUses": 100,
  "active": true,
  "consumedUses": 0,
  "reservedUses": 0,
  "availableUses": 100,
  "createdAt": "2026-11-10T11:00:00.000Z",
  "updatedAt": "2026-11-10T11:00:00.000Z"
}
```

`consumedUses` counts `CouponUse`; `reservedUses` counts only `RESERVED` reservations.
Released/consumed reservations do not count again. Uncertain payment outcomes stay reserved,
regardless of an elapsed reservation timestamp. `availableUses = maxUses - consumedUses - reservedUses`.
The page and counts share a repeatable-read snapshot. Inactive, expired and exhausted coupons
remain in the admin list: `active` is the stored flag and capacity is not an eligibility promise.
Availability for future coupon application requires `active && now < expiresAt && availableUses > 0`;
booking/student applicability and payment orchestration belong to T25/T26. Responses expose no
student redemption history, audit actors, private contact data or payment-provider fields.

### Verification

Focused unit/HTTP checks are in `test/unit/coupons` and `test/coupons.e2e-spec.ts`.
The HTTP suite runs real guards, validation and service code with mocked persistence. The separate
`pnpm db:verify:admin-coupons` runner uses real PostgreSQL, real signed JWTs and the HTTP routes for
the duplicate-code race, safe listing and persisted session revocation; it also verifies audit
rollback, equal-time keyset pagination and real reservation/release/consumption counts.

The runner requires explicit opt-in, a loopback-only URL, a `hktutor_*_test`/`hktutor-*-test`
database name, no URL options/fragments and all committed migrations. It does not load `.env`,
migrate or seed. Synthetic append-only evidence is retained, so discard its disposable database.
It runs separately from `pnpm check`.

```bash
# Use a NEW isolated container, never the shared/demo database.
docker run --detach --name hktutor-s3-t21-test \
  --publish 127.0.0.1:55451:5432 \
  --env POSTGRES_USER=postgres --env POSTGRES_PASSWORD=disposable-local-only \
  --env POSTGRES_DB=hktutor_coupon_api_test postgres:17-alpine
docker exec hktutor-s3-t21-test pg_isready -U postgres -d hktutor_coupon_api_test
export DATABASE_URL='postgresql://postgres:disposable-local-only@127.0.0.1:55451/hktutor_coupon_api_test'
pnpm db:migrate:deploy
HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 pnpm db:verify:admin-coupons
docker rm --force --volumes hktutor-s3-t21-test
unset DATABASE_URL
```

See [S3-T21 evidence](../../tests/s3-t21-qa.md) for actual commands and results.

## Coupon payment orchestration (S3-T26)

This extends the three existing PromptPay routes; it adds no migration or new response fields.
Apply DB02 and both DB03 migrations before deploying the API. The checkout's booking coupon
snapshots are the authoritative input; T25 quote/apply/remove HTTP routes and the T27 UI are
separate work. The POST accepts an absent body or `{}` only, never an amount, code, currency or
identity from the client. GET current accepts no query parameters. Both student routes require
current consent and return `Cache-Control: no-store`. The existing signed webhook has no JWT.

### Claim and settlement

- A transaction locks the booking first, then forces a coupon row update before inspecting
  reservation/attempt evidence. It reads the booking again under the lock, checks CONFIRMED/UNPAID,
  current active/exclusive expiry, exact applied code/percent and HALF_UP Decimal discount math,
  student reuse and `CouponUse + RESERVED < maxUses`. Same-student active claims also block reuse.
  No live listing price is consulted. Coupon changes after application require a fresh quote.
- Positive THB net must be 20.00–150000.00 inclusive. The transaction claims `paymentPending`,
  creates the frozen PaymentAttempt and its RESERVED CouponReservation together. The Omise POST
  happens only after commit. A concurrent retry reuses the active attempt; a paid retry returns
  the stored receipt. Database serialization/deadlock failures retry the entire transaction at
  most twice; provider HTTP POST is never retried automatically.
- Timeout, 5xx, malformed results and absent charge-history matches retain CREATING and capacity.
  Current reads recover by `metadata.attemptId` after 15 seconds. Neither local QR expiry nor a
  503 releases capacity. A definitive no-charge rejection persists FAILED, releases the reservation
  and clears paymentPending atomically. Provider-confirmed FAILED/EXPIRED does the same.
- Signed webhook/current retrieval checks charge ID, amount, currency, test mode, PromptPay method,
  captured status and attempt/booking metadata. Reconciliation locks booking → coupon before
  updating the attempt. SUCCESSFUL, CONSUMED (trigger-generated CouponUse/audit) and Booking PAID
  commit together. Expiry/deactivation after reservation does not invalidate that QR. Duplicate or
  older signals cannot downgrade terminal attempts or duplicate evidence; consumed uses are never
  refunded. A failed database write rolls the entire settlement back for safe reconciliation.
- A valid full coupon with net 0 uses the same POST, consumes immediately and writes PAID/paidAt
  and `paymentReference = coupon:<CouponUse.id>` in one transaction. No provider configuration,
  HTTP call, QR or PaymentAttempt is needed; the receipt returns `attempt: null`. An old failed
  attempt, if pricing changed after its release, remains historical and is not shown as that
  zero receipt's attempt. Zero retries return the same receipt. Paid cancellation remains denied.

Domain 409 codes include `BOOKING_NOT_PAYABLE`, `PAYMENT_AMOUNT_UNSUPPORTED`, `COUPON_INACTIVE`,
`COUPON_EXPIRED`, `COUPON_EXHAUSTED`, `COUPON_ALREADY_USED` and `PAYMENT_STATE_CONFLICT` for a
stale quote/snapshot. Charge mismatches return 409. Invalid provider data/verification uncertainty
returns 503 without releasing evidence. Existing authentication/validation/ownership envelopes
remain; unexpected persistence failures return generic 500, never provider payloads or secrets.

### Verification

`pnpm db:verify:coupon-payments` runs real PostgreSQL transactions and the real Omise adapter with
a deterministic in-process HTTP stub. Webhooks pass through real raw-body HMAC verification;
student HTTP checks use real signed JWTs and persisted sessions. No Omise account is contacted.
The runner requires explicit opt-in, loopback-only URL, `hktutor_*_test`/`hktutor-*-test` name,
no URL options/fragments and all committed migrations. It does not load `.env`, migrate or seed.
It retains synthetic append-only evidence, so run it only in a new isolated database and discard
that database afterward. It is deliberately outside `pnpm check`.

```bash
docker run --detach --name hktutor-s3-t26-test \
  --publish 127.0.0.1:55456:5432 \
  --env POSTGRES_USER=postgres --env POSTGRES_PASSWORD=disposable-local-only \
  --env POSTGRES_DB=hktutor_coupon_payment_test postgres:17-alpine
docker exec hktutor-s3-t26-test pg_isready -U postgres -d hktutor_coupon_payment_test
export DATABASE_URL='postgresql://postgres:disposable-local-only@127.0.0.1:55456/hktutor_coupon_payment_test'
pnpm db:migrate:deploy
HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 pnpm db:verify:coupon-payments
docker rm --force --volumes hktutor-s3-t26-test
unset DATABASE_URL
```

See [S3-T26 QA evidence](../../tests/s3-t26-qa.md) for the original commands/results and
[S3-T28 QA evidence](../../tests/s3-t28-qa.md) for the expanded suite. The runner now also
integrates the real T25 apply and rejected remove HTTP routes with T26 creation, signed success,
current reads and paid retries. It verifies same-student simultaneous active claims, replayed
terminal release with fresh-attempt expiry revalidation, and success racing cancellation or
coupon apply/remove. Sanitized `EVIDENCE` lines expose only statuses, fixed-decimal amounts,
receipt kind and exact attempt/reservation/use/audit/provider counts. The separate DB04 fixture
verifier checks the 905.00 THB paid-completed net ledger; no report endpoint is added by T28.
Browser coverage uses intercepted API responses and never contacts Omise. Live Test Dashboard
configuration, actual QR delivery and external callback delivery still require a separate rehearsal.

## Coupon rules and audit reference (S3-T23)

This section collects the US9-1 coupon rules in one place. It adds no route, field or migration.
The detailed contracts remain in [persistence](#coupon-persistence-s3-db02),
[admin APIs](#admin-coupon-apis-s3-t21) and
[payment orchestration](#coupon-payment-orchestration-s3-t26). Swagger (`coupons.swagger.ts`)
publishes the same rules, examples and 409 body. `test/unit/coupons/coupons.swagger.spec.ts`
checks that it matches the DTO validation and response.

### Coupon rules

| Rule          | Contract                                                                                                  |
| ------------- | --------------------------------------------------------------------------------------------------------- |
| Type          | Percentage only. There are no fixed-amount or other coupon types.                                         |
| `code`        | Trimmed and ASCII a–z uppercased, then 3–32 of `A-Z`, `0-9`, `_`, `-`. Non-ASCII is rejected.             |
| Uniqueness    | CITEXT unique index; `welcome10` and `WELCOME10` collide, returning 409 `COUPON_CODE_EXISTS`.             |
| `percent`     | JSON integer 1–100 inclusive. 0, -10, 120, fractions and strings return 400.                              |
| `maxUses`     | JSON integer 1–2147483647. 0 returns 400.                                                                 |
| `active`      | Optional JSON boolean, default true. Only the activation route changes it later.                          |
| `expiresAt`   | Full UTC instant ending in `Z`, at most millisecond precision, strictly future when created.              |
| Expiry        | Exclusive: usable only while `now < expiresAt`; `now >= expiresAt` is expired.                            |
| Bangkok input | The admin UI needs a Bangkok date and HH:mm time and sends UTC. A date alone is never read as end of day. |
| Capacity      | `availableUses = maxUses - consumedUses - reservedUses`.                                                  |
| Eligibility   | `active && now < expiresAt && availableUses > 0`, plus T25/T26 booking and student checks.                |
| Changes       | No edit or delete route. Code, percent, expiry and maxUses are fixed once created.                        |

`consumedUses` counts immutable `CouponUse` rows. A consumed use is never refunded or decremented,
including after cancellation. `reservedUses` counts only `RESERVED` claims, including uncertain
payment outcomes. Released claims do not count.

Duplicate-code response:

```json
{
  "statusCode": 409,
  "error": "Conflict",
  "code": "COUPON_CODE_EXISTS",
  "message": "A coupon with this code already exists"
}
```

### Audit

Before S3-DB02 there was no general AuditLog table. DB02 adds a minimal append-only `AuditLog`:

- **Creation.** `POST /admin/coupons` sets the actor from the JWT `CurrentUser`. The DB02 insert
  trigger writes one `coupon.create` row in the same transaction as the coupon. `afterData` is
  exactly `{ percent, maxUses, active }`, with no payment credentials or student PII. The unique
  `coupon.create:<couponId>` operation key means a retry cannot add a second row. If the audit
  write fails, the coupon insert rolls back.
- **Activation.** Each real change writes one `coupon.active_change` row with
  `{ active }` before and after data and the authenticated actor.
- **Payments (S3-T26).** `coupon.reserve`, `coupon.consume` and `coupon.release` rows use the
  reservation ID as `entityId`. `afterData` is only `{ status, discountAmount }` and `beforeData`
  is at most `{ status: "RESERVED" }`. They never store raw webhook payloads, provider tokens,
  secrets or QR URLs.
- **Responses.** Create, list and activation responses return only coupon metadata and counts.
  They never include audit rows, actors, operation keys or redemption history.

### Approved PromptPay coupon decisions

These product decisions replace the backlog's earlier mock-payment wording.
`/api/v1/bookings/me/:bookingId/mock-payment` stays retired with 410 and is not restored.

- **Reservation.** Starting a PromptPay Test Mode charge reserves one use. The use stays reserved
  while the charge is active or its outcome is uncertain, even after the QR expires locally.
- **Consumption.** A use is consumed only after verified provider success. The booking is paid in
  the same transaction.
- **Release.** A use is released only after a definitive no-charge rejection, or after the
  provider confirms FAILED or EXPIRED.
- **Zero payment.** A 100% coupon with net 0.00 settles at once with no Omise call and no
  PaymentAttempt. The receipt is `coupon:<CouponUse.id>`.
- **Amount cutoff.** A positive net must be THB 20.00–150,000.00. A net between 0 and 20.00, or a
  zero net without a 100% coupon, returns 409 `PAYMENT_AMOUNT_UNSUPPORTED`.
- **Expiry cutoff.** Expiry and activation are checked when the use is reserved. A QR already
  reserved is honored after the coupon expires or is deactivated.

### Traceability

| Card    | Scope                                                       | Evidence                                                                                                                                          |
| ------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| US9-1   | Admin creates and manages percentage coupons                | The rows below                                                                                                                                    |
| S3-DB02 | Coupon, reservation and use tables; creation/payment audit  | `pnpm db:verify:coupons`; [S3-DB02 QA](../../tests/s3-db02-qa.md)                                                                                 |
| S3-T21  | Admin create/list API, normalization, uniqueness and expiry | `test/coupons.e2e-spec.ts`, `test/unit/coupons`, `pnpm db:verify:admin-coupons`; [S3-T21 QA](../../tests/s3-t21-qa.md)                            |
| S3-T22  | Admin coupon UI with Bangkok-to-UTC expiry input            | `apps/web/test/coupon-model.test.ts`, `apps/web/e2e/admin-coupons-ui.spec.ts`; [S3-T22 QA](../../tests/s3-t22-qa.md)                              |
| S3-T23  | This reference, Swagger and audit checks                    | [S3-T23 QA](../../tests/s3-t23-qa.md)                                                                                                             |
| S3-T24  | Authorization, boundary, expiry and duplicate-code tests    | HTTP validation/guards, real PostgreSQL uniqueness/audit rollback, form models and bilingual browser tests; [S3-T24 QA](../../tests/s3-t24-qa.md) |

## Tutor comparison QA (S3-T32)

S3-T32 is the US10-1 regression suite for the tutor comparison built in S3-T29 to S3-T31 and
polished in S3-T34 and the Foldout Folio change. It changes no production code. The comparison has
no table or endpoint of its own: for each selected tutor it reads only the public
`GET /api/v1/tutors/:tutorId` and `GET /api/v1/tutors/:tutorId/availability`, keyed by the selected
tutor and listing.

### Acceptance wording difference

The backlog sheet's US10-1 criterion and the S3-T29 card say Compare is disabled below two tutors,
behind a separate `/tutors/compare` page. The later S3-T30 card replaced that design: there is no
compare page or second Compare step, and zero or one selections show guidance in the existing popup.
S3-T32 tests that approved behaviour. With no selection there is no dock. With one, the dock says
"Select one more tutor to compare.", the popup shows a single column and the comparison priorities
stay disabled until a second tutor is chosen. A fourth tutor cannot be selected. The sheet is not
edited.

### Coverage

| Requirement                                                                   | Tests                                                                                                                                |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 0/1 guidance, 2/3 enabled, a fourth refused, removal 3→2→1, announced count   | web `tutor-comparison-qa.test.ts`, `tutor-comparison-qa.spec.ts` (keyboard), `tutor-comparison.test.ts`                              |
| One tutor counted once across listings; the course swaps in place             | web `tutor-comparison-qa.test.ts`, `tutor-comparison-qa.spec.ts`, `tutor-comparison.test.ts`                                         |
| Malformed or duplicate restored selections start a fresh search               | web `tutor-comparison-qa.test.ts`; the sort URL is covered by `comparison-sort-query.test.ts` and `tutor-comparison-sort.test.ts`    |
| Six aligned attributes for 2 and 3 tutors, with header associations           | web `tutor-comparison-qa.spec.ts`, `tutor-comparison-ui.spec.ts` (S3-T30)                                                            |
| Price and subject from the selected listing, never another listing            | `db:verify:comparison-visibility` check 1, web `tutor-comparison-qa.spec.ts`, `tutor-comparison-view-model.test.ts`                  |
| New tutor `null`/0, invalid experience, no future slot; no fake 0.00 or slot  | `db:verify:comparison-visibility` check 3, web `tutor-comparison-qa.spec.ts`, `tutor-comparison-view-model.test.ts`                  |
| Only allow-listed public fields; no private profile reads                     | `db:verify:comparison-visibility` checks 1–2, web `tutor-comparison-qa.spec.ts` (request log), `tutor-comparison-view-model.test.ts` |
| A tutor hidden after selection answers 404 and shows no cached search data    | `db:verify:comparison-visibility` check 4, web `tutor-comparison-qa.spec.ts`                                                         |
| A selected listing removed after selection is unavailable, with no substitute | `db:verify:comparison-visibility` check 5, web `tutor-comparison-qa.spec.ts`                                                         |
| Retrying one failed tutor keeps the others; profile links keep the listing    | web `tutor-comparison-qa.spec.ts`, `tutor-comparison.test.ts` (S3-T30 retries)                                                       |

### Verification

`pnpm --filter @hktutor/api db:verify:comparison-visibility` runs the real public detail,
availability and search services against PostgreSQL. Neither root `pnpm check` nor `pnpm test` runs
it. It uses the same approval flag and loopback-only URL gates as the verifiers above and removes
its fixtures in `finally`. From the repository root:

```bash
nvm use 24.19.0
pnpm install --frozen-lockfile
docker run --detach --name hktutor-comparison-visibility-test \
  --publish 127.0.0.1:55443:5432 \
  --env POSTGRES_USER=postgres --env POSTGRES_PASSWORD=disposable-local-only \
  --env POSTGRES_DB=hktutor_comparison_visibility_test postgres:17-alpine
# Wait until this reports that PostgreSQL is accepting connections.
docker exec hktutor-comparison-visibility-test pg_isready -U postgres -d hktutor_comparison_visibility_test
export DATABASE_URL='postgresql://postgres:disposable-local-only@127.0.0.1:55443/hktutor_comparison_visibility_test'
pnpm db:generate
pnpm --filter @hktutor/api db:migrate:deploy
HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1 pnpm --filter @hktutor/api db:verify:comparison-visibility
# Discard this example's container and its anonymous data volume, including after a failed run.
docker rm --force --volumes hktutor-comparison-visibility-test
unset DATABASE_URL
```

The 5 checks cover:

- Detail returns only the allow-listed tutor and listing fields (no email or legal names), and each
  of a tutor's two listings keeps its own price, subject and grade, matching its search row.
- Availability returns only future free slots as `{id, startAtUtc, endAtUtc}`: a pending booking,
  a past slot and a deleted slot are hidden, and a canceled booking frees its slot.
- A new tutor reads as `null`/0 with 0 years, no future slot is `[]`, and a tutor without published
  listings has an empty list.
- A tutor that becomes UNVERIFIED, PENDING, REJECTED, SUSPENDED or DELETED after selection answers
  404 on both reads and leaves search.
- An archived or deleted selected listing drops out of detail and search while the tutor stays
  public, and the tutor's other listing comes back unchanged rather than as a substitute.

Removing `publicTutorWhere` from the public availability read makes the fourth check fail.

The browser suite is `pnpm --filter @hktutor/web test:e2e tutor-comparison-qa.spec.ts`. It
intercepts every API read with the card's fixtures (two courses for one tutor, a new tutor, invalid
experience with no future slot, a tutor hidden after selection and a course removed after selection)
and asserts page text, accessible names and the request log on desktop, tablet and mobile
Chromium. It does not certify a live database-backed journey; the verifier above covers that side.

## Tutor comparison sort QA (S3-T35)

S3-T35 is the US10-2 regression suite for comparison sorting (S3-T33) and its Priority Tabs
(S3-T34). It changes no production code and needs no database: at most three tutors are sorted in
the browser, from the same public detail and availability reads covered in S3-T32.

### Acceptance wording difference

The backlog sheet's US10-2 criterion says that for `sort='unknown'` "the API rejects the value".
The sheet's own note and the S3-T33 card make sorting client-side with no backend sort call, so the
browser validates the value instead. Only `lowest_price`, `highest_rating` and
`earliest_availability` are accepted. Anything else, including an ambiguous repeated
`comparisonSort` URL value, shows "Invalid comparison sort. Showing lowest price first." and sorts
by lowest price without changing the selection. The sheet is not edited.

### Coverage

| Requirement                                                                    | Tests                                                                                                     |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Card fixture A 450/4.8/sooner, B 350/4.4/later, C no rating or slot            | web `tutor-comparison-sort-qa.test.ts` (real pipeline), `tutor-comparison-sort-qa.spec.ts`                |
| 350 before 450; prices compared as numbers, never as text                      | web `tutor-comparison-sort-qa.test.ts`, `tutor-comparison-sort.test.ts` (satang)                          |
| Highest rating first on unrounded values; New tutor last                       | web `tutor-comparison-sort-qa.test.ts`, `tutor-comparison-sort.test.ts`                                   |
| Future slots first; no slot or a started slot last; one instant in two offsets | web `tutor-comparison-sort-qa.test.ts`, `tutor-comparison-sort.test.ts`                                   |
| Ties and all-missing values keep selection order                               | web `tutor-comparison-sort-qa.test.ts`, `tutor-comparison-sort-qa.spec.ts`                                |
| Invalid sort shows a message and falls back to lowest price                    | web `tutor-comparison-sort-qa.test.ts`, `tutor-comparison-sort-qa.spec.ts`, `tutor-comparison-ui.spec.ts` |
| Every column's six values and name move together after each change             | web `tutor-comparison-sort-qa.spec.ts` (2 and 3 tutors, every priority repeatedly)                        |
| No selection loss, array mutation or extra reads while sorting                 | web `tutor-comparison-sort-qa.test.ts`, `tutor-comparison-sort-qa.spec.ts`, `tutor-comparison-ui.spec.ts` |
| Sorting repeatedly while a tutor reloads keeps the finished column whole       | web `tutor-comparison-sort-qa.spec.ts`, `tutor-comparison-ui.spec.ts` (S3-T34 pending retry)              |
| URL history, keyboard and announcements for the Priority Tabs                  | web `tutor-comparison-ui.spec.ts` (S3-T34), `tutor-comparison-sort-qa.spec.ts` (announcement)             |

### Verification

Run the pure tests with `pnpm --filter @hktutor/web test` and the browser suite with
`pnpm --filter @hktutor/web test:e2e tutor-comparison-sort-qa.spec.ts`. The pure tests build each
column from API-shaped detail and slot data through `buildComparisonColumn`,
`buildTutorComparisonView` and `sortTutorComparisonView`, so they cover the values a student sees
rather than hand-built sort keys. Making ties ignore selection order fails three of them. The
browser suite intercepts every API read and checks, after each change, every column's name, price,
subject, rating, review count, experience and next slot on desktop, tablet and mobile Chromium.

## Tutor comparison responsive E2E (S3-T36)

S3-T36 runs the US10-2 comparison journey in the browser at the card's three viewports, keyboard
only. It changes no production code. The suite is
`apps/web/e2e/tutor-comparison-responsive.spec.ts`; each existing Playwright project is resized to
the card's size, keeping that project's device settings:

| Project           | Viewport   | Device settings           |
| ----------------- | ---------- | ------------------------- |
| `chromium`        | 1440 × 900 | Desktop Chrome            |
| `tablet-chromium` | 768 × 1024 | Desktop Chrome with touch |
| `mobile-chromium` | 390 × 844  | Pixel 7 (mobile, touch)   |

### What it checks

- The journey: select two tutors, open the comparison, add a third, have a fourth refused and
  announced, remove one, then sort by lowest price, highest rating and earliest availability.
- Every control is reached with real Tab or Shift+Tab presses and used with Enter, Space, the arrow
  keys or Escape. Each focused control (a radio's label for the priorities) must be
  `:focus-visible` with an outline of at least 2px.
- After each step: column order, each cell's `headers` association with its row and column header,
  each tutor's own values, no page-level horizontal scroll and the popup inside the viewport. At
  390px the table scrolls sideways inside the popup.
- Long English and Thai names and subjects wrap inside their own cells (no cell with
  `scrollWidth > clientWidth`), with New tutor and no-slot labels in both languages.
- A tutor hidden (404) between selection and comparison shows no stale name or link, and retrying
  one network error by keyboard keeps the other selections and the 3/3 count.

Removing the search card's `:focus-visible` outline makes all four desktop tests fail.

### Running it and the evidence

`pnpm --filter @hktutor/web test:e2e tutor-comparison-responsive.spec.ts` runs all three
projects. Screenshots are written to each test's Playwright output folder; they are evidence only,
and every test passes or fails on its assertions. A curated set is kept in
`ui-design/review-evidence/s3-t36/`: for each viewport, three tutors compared
(`*-2-compare-three.png`), the result sorted by highest rating (`*-3-sorted-highest_rating.png`)
and Thai long text (`*-4-long-text-th.png`).

Limits: every API read is intercepted, so this does not certify a live database-backed journey
(S3-T32's `db:verify:comparison-visibility` covers the public reads). Only the repository's
Chromium projects were run; Firefox and WebKit were not. No external service is contacted.

## Sprint 3 deterministic fixtures (S3-DB04)

`pnpm db:seed` keeps the existing combined entry point and now calls `seedSprint3Fixtures` after
Sprint 2. DB04 includes 61 bookings across isolated review/report/coupon/reminder groups, 12
coupons, real review aggregates, the 905.00 THB report ledger, provider-stub and zero settlements,
and 29 reminder scenarios with injected clocks. No new migration, API or seed configuration is
introduced. Synthetic `.invalid` users have no passwords; provider IDs are explicitly test stubs.

Read the [fixture inventory, expected results, examples and QA evidence](../../tests/s3-db04-qa.md)
before writing consuming tests. Pure unit tests import `buildSprint3Fixtures` without a database;
integration tests use the same combined `runSeed(prisma, now)` on a fresh disposable DB. Existing
DB04 rows are not reset: repeated seeds preserve live reviews, attempts, reservations, consumption
and original time windows. The legacy Sprint 2 ended demo class is also preserved when provider or
coupon evidence exists, in addition to the existing reviewed-class protection.

`pnpm db:verify:sprint3-fixtures` is separate from `pnpm check`. It refuses remote/non-test targets,
requires `HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1`, explicit loopback `DATABASE_URL` without options,
all migrations applied and zero initial users. It never loads `.env`, migrates or calls Omise.
It invokes the combined seed, verifies raw PostgreSQL totals and existing service reads, tests
real reminder writes and compares full fixture snapshots after repeated/next-day seeding. It
retains synthetic append-only evidence: discard the owned disposable database afterwards.

## Sprint 3 concurrency and query plans (S3-DB05)

`pnpm db:verify:sprint3-concurrency` runs the existing review HTTP/SQL and coupon SQL/payment
verifiers, then representative EXPLAIN checks, on one fresh disposable database. It requires
`HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1`, an explicit loopback URL without options/fragments and
exact database name `hktutor_s3_db05_test`, all committed migrations and zero initial users.
It never loads `.env`, migrates or calls live Omise. Each child runs sequentially and failure
stops the command; append-only evidence remains until its owned disposable database is discarded.

The payment runner now observes all contenders in PostgreSQL blocker chains before releasing
held row locks. It integrates actual T25 apply/remove/replace services with QR creation, checks
losing-side/full transaction evidence, both consume/release directions and retry limits for
PostgreSQL 40001/40P01 mapped to Prisma P2034. Existing provider/auth guards remain covered.

`20261112170000_add_sprint3_query_indexes` adds `Coupon_code_text_idx` for normalized Prisma
code equality and `AvailabilitySlot_startAtUtc_id_idx` for global reminder windows. Measured
EXPLAIN plans justified both; the existing CITEXT unique key and all partial claim indexes remain.
Only indexes/schema metadata and verification change; there is no new API, DTO or UI behavior.

See the [DB05 file/call map, cases, plans and runnable evidence](../../tests/s3-db05-qa.md).

## Sprint 3 final database rehearsal (S3-DB06)

`pnpm db:verify:sprint3-final` is the clean seed/startup part of DB06, separate from `pnpm check`.
It requires explicit `HKTUTOR_ALLOW_DISPOSABLE_DB_VERIFY=1`, loopback `DATABASE_URL` without
options/fragments, exact database name `hktutor_s3_db06_test`, public schema and zero users after
migration deploy. It compares every committed migration's SHA-256 with completed Prisma history,
prints a migration manifest and deterministic DB04 input hash, then calls the existing fixture
and admin coupon verifiers. Those establish seed repeatability, 905.00 report inputs, 4.33/count 2
and null/0 reviews, reminders, zero settlement, uncertain reservations and append-only audit.
The final runner checks persisted reminder/audit type coverage and boots the actual AppModule
for `GET /api/v1/health`, expecting 200 and `{ database: 'connected' }`.

The runner replaces inherited application settings with an allowlist: only OS path/temp variables,
the validated disposable target and explicit synthetic config reach its children/startup. AppModule
and app.setup load only after environment isolation and a move into a new empty directory tree,
so their environment-file paths cannot read the workspace `.env`. The fixture input hash is printed
inside the isolated fixture child. Generated JWT secrets are never printed; Omise keys are blank.
The actual API providers start in `NODE_ENV=test`: the runner asserts the reminder cron is inactive,
and all six booking/payment/coupon/notification/audit evidence tables retain identical hashes.
External fetches are rejected rather than stubbed as successful. The app/temp directory are closed
and the original process environment restored afterwards. The separate reminder verifier still
tests the enabled cron outside test mode.

Failures identify the checkpoint, error type and safe error code. Known child exit/signal and
timeout details, or the invalid configuration field, are retained; arbitrary error messages,
assertion values, URLs and provider payloads are not printed. The shared pure
`config/disposable-database-url.ts` guard is reused by the four related TypeScript verifiers while
their existing exported wrappers retain their exact/generic target rules.

This command does not migrate, reset a database or aggregate every DB verifier. Complete DB06 also
runs the existing upgrade, reminder and DB05 verifiers on separate fresh targets. The upgrade
harness now starts with the S2 + PromptPay schema and replays through all current migration SQL,
preserving original booking/payment fields and pre-existing audit. Each snapshot carries its
baseline columns and row IDs; comparisons project those columns in PostgreSQL, preserving exact
Decimal JSON text while tolerating later additive columns. An ALTER-column regression probe on
Booking/PaymentAttempt/AuditLog passes, an actual historical value change is detected, and the
whole probe rolls back. Missing index/constraint diagnostics name the object and migration range.
The harness directly replays SQL rather
than creating a Prisma migration ledger; the clean path separately proves actual Prisma deploy
and ledger checksums. No production migration file, API, DTO, fixture input or dependency changes.

Follow the [DB06 commands, file/call map, acceptance evidence and limitations](../../tests/s3-db06-qa.md).
