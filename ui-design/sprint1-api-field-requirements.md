# HKTutor Sprint 1 API field requirements

This file is the Frontend-to-Backend handoff for fields required by Sprint 1 pages. It describes
what the UI must send and display. Backend owns the final method, path, validation, authorization,
status codes, and schema published through Swagger.

The final contract must be available at `/api/v1/docs` and `/api/v1/docs-json`. Runtime routes and
Trello API cards use `/api/v1`; endpoint headings below omit that shared prefix for readability. If
Swagger differs from this file, resolve the difference with the owning Frontend task before
integration. Do not silently remove a field used by a page.

## Contract rules used by every endpoint

- IDs are UUID strings.
- API timestamps are ISO 8601 UTC strings. Frontend converts lesson and availability times to
  `Asia/Bangkok` for display.
- Money fields use THB with two decimal places. Backend must choose one JSON representation for
  decimal values and use it consistently in listing, quote, booking, and history responses.
- Enum values use the Prisma names: `STUDENT`, `TUTOR`, `ADMIN`; `PENDING`, `VERIFIED`, `REJECTED`;
  `DRAFT`, `PUBLISHED`, `ARCHIVED`; and `PENDING`, `CONFIRMED`, `COMPLETED`, `CANCELED`.
- Private endpoints receive identity from the authenticated session. Frontend never sends owner,
  student, or tutor IDs when the server can derive them.
- Validation removes unknown input fields. Passwords, password hashes, tokens, consent metadata,
  refresh-session data, soft-delete fields, and private document paths are never returned to a
  normal page.
- Errors use the existing shape: `statusCode: number`, `error: string`, and
  `message: string | string[]`. Domain errors should also expose a stable `code` when the UI needs
  different behavior for conflicts.

## Confirmed Sprint 1 UI identity decisions

- Booking does not need a public or human-readable reference. `Booking.id` remains an internal API
  and route value and is not displayed by the seven UI drafts.
- `StudentProfile.nickname` is the Tutor-facing participant label. Booking APIs may return that
  nickname to the Tutor assigned to the booking. They must not return the Student's legal name,
  school, grade-level profile, telephone, email, or account identifiers as display fallbacks.

## Trello contract comparison and UI impact

Compared with the
[Trello Sprint 1 board](https://trello.com/b/5rez0fNO/hktutor-sprint-1-backlog) on 2026-09-09.
Names in this document use the application's `/api/v1` runtime prefix and the proposed Trello
task ownership listed in `sprint1-ui-api-map.md`.

| Difference                                                                                                                     | Resolution in this document                                                      | UI impact if unresolved                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Trello API titles previously omitted `/v1`; they were aligned to the application's `/api/v1` prefix on 2026-09-09              | Resolved on the Trello board                                                     | No remaining UI impact; Frontend and Backend now share one route prefix                                       |
| Listing edit was `PUT .../:listingId`; Trello defines `PATCH .../:listingId`                                                   | Use Trello's partial-update method                                               | No layout change; save fails with 404/405 if the client uses the old method                                   |
| Listing status was a generic status patch; Trello defines `POST .../:listingId/publish` only                                   | Use the explicit publish action; archiving has no Sprint 1 mutation card         | Existing archived rows may display, but an Archive action cannot be implemented from this contract            |
| Catalog paths were `/catalogs/subjects` and `/catalogs/grade-levels`; Trello now assigns `/subjects` and `/grade-levels`       | S1-T21/API-03 and API-04 were created with the shorter routes                    | Selectors remain blocked only until these assigned endpoints are implemented                                  |
| Own availability was `/availability/me`; Trello defines `/tutors/me/availability`                                              | Use the Trello route family                                                      | No layout change; list, add, and delete actions fail if Frontend uses the old route                           |
| Availability create input was `startAtUtc/endAtUtc`; Trello defines `startAt/endAt` and returns `startAtUtc/endAtUtc`          | Use Trello's input and output field names                                        | No layout change; submit returns 400 if payload keys do not match                                             |
| Trello own-availability response originally left the derived reservation field unnamed                                         | S1-T18/API-01 now defines `state: OPEN \| RESERVED`                              | No contract ambiguity remains; the UI is blocked only until the endpoint is implemented                       |
| Search used ID filters and `minRating`; Trello defines string `subject`, string `grade`, and `minimumRating`                   | Use Trello's query names and ranges                                              | Filter controls still look the same, but wrong query keys produce unfiltered, empty, or 400 responses         |
| Trello search response originally omitted tutor ID, description, review count, experience, and next availability used by cards | S1-T21/API-01 now defines every search-result field required by the UI           | No contract ambiguity remains; the page is blocked only until the endpoint is implemented                     |
| Trello originally had only create-booking and no quote, Student list/detail, or Tutor booking-list cards                       | S1-T24/API-02 through API-05 were created with page-specific contracts           | Booking history/status tabs and dashboard rows remain blocked only until those endpoints are implemented      |
| Trello create-booking returns IDs and amount fields, not a complete joined `BookingView`                                       | Accept the create response shape and require read endpoints for reloadable views | Immediate success can reuse selected client data, but refresh/detail/history cannot reconstruct the full card |
| The new model has `StudentProfile.nickname`; the Tutor participant projection was previously undefined                         | S1-T24/API-05 now returns only `student: { nickname }` to the owning Tutor       | Tutor booking rows can use the intended label once API-05 is implemented                                      |

### Current `design/ui` code audit

Rechecked against `main` and local `design/ui` at `de95d0b` on 2026-09-10. S1-T31 profile DTOs,
Swagger schemas, profile completion behavior, and Frontend field handling are merged. Tutor listing
code now validates the publication-status enum and applies ownership guards to edit/publish, but
these remaining conflicts must be resolved before Frontend treats it as the final contract:

| Current code conflict                                                                                           | Required resolution                                                                                       | UI effect until resolved                                                                                                 |
| --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `TutorsController` declares `@Controller('api/tutors')` while the app already applies global prefix `api/v1`    | Change the controller prefix to `tutors`, so the runtime path is `/api/v1/tutors/...`                     | Every listing request documented here otherwise returns 404 because the current runtime path is `/api/v1/api/tutors/...` |
| `GET me/listings` binds `ListingQueryDto` with `@Body()`                                                        | Bind the optional filter from `@Query()` and document it in Swagger                                       | Browser clients do not reliably send a GET body; the status filter cannot be integrated safely                           |
| `ListingQueryDto.publicationStatus` has runtime enum validation but no discoverable query binding/schema        | Keep validation and expose the filter through `@Query()` plus Swagger query metadata                      | Generated API clients cannot discover or send the filter reliably                                                        |
| `POST me/listings` returns only the new listing ID string                                                       | Return the complete created `TeachingListing`, as required below                                          | The create page cannot render the saved listing without an extra request                                                 |
| `POST .../:listingId/publish` returns no response body                                                          | Return the updated `TeachingListing`                                                                      | The page cannot update publication state without an extra reload                                                         |
| `ListingResponseDto` exposes `listingId`, omits `createdAt`, and embeds catalog timestamps not used by the page | Align one response shape with `TeachingListing` below, or update this document and all consumers together | List, create, edit, and publish currently disagree about field names and available metadata                              |
| No `GET /tutors/me/listings/:listingId` method exists                                                           | Implement S1-T15/API-08 before direct edit routes ship                                                    | Reloading or directly visiting an edit URL cannot reconstruct the form                                                   |
| No availability, public search/catalog, or booking controller is registered in `AppModule`                      | Keep those contracts marked Proposed until their owning tasks merge                                       | Related drafts are design-ready but cannot be wired to live data yet                                                     |

## Shared output objects

These names describe the fields Frontend needs. Backend may choose different DTO class names, but
the Swagger response must expose the same usable data.

### `AuthUser`

| Field   | Type                        | Required | Used for                                    |
| ------- | --------------------------- | -------- | ------------------------------------------- |
| `id`    | UUID                        | Yes      | Authenticated user identity                 |
| `email` | Email string                | Yes      | Header, account, and fallback display label |
| `role`  | `STUDENT \| TUTOR \| ADMIN` | Yes      | Role-aware navigation and authorization UI  |

### `AuthSessionResponse`

| Field         | Type            | Required | Used for                             |
| ------------- | --------------- | -------- | ------------------------------------ |
| `accessToken` | String          | Yes      | Bearer authentication held in memory |
| `expiresIn`   | Integer seconds | Yes      | Access-token lifetime                |
| `user`        | `AuthUser`      | Yes      | Current identity and role            |

The refresh token is an HttpOnly cookie and must not be returned in JSON.

### `StudentProfile`

| Field        | Type   | Required | Used for                                                    |
| ------------ | ------ | -------- | ----------------------------------------------------------- |
| `firstName`  | String | Yes      | Owner-only profile editor                                   |
| `lastName`   | String | Yes      | Owner-only profile editor                                   |
| `nickname`   | String | Yes      | Dashboard identity and Tutor-facing booking label           |
| `school`     | String | Yes      | Owner-only profile editor                                   |
| `gradeLevel` | String | Yes      | Owner-only profile editor; separate from listing grade      |
| `phone`      | String | Yes      | Owner/admin emergency use; never public or in booking lists |

### `TutorProfile`

| Field                | Type                              | Required | Used for                                                            |
| -------------------- | --------------------------------- | -------- | ------------------------------------------------------------------- |
| `firstName`          | String or `null`                  | Yes      | Owner-only profile editor; legacy rows may be null                  |
| `lastName`           | String or `null`                  | Yes      | Owner-only profile editor; legacy rows may be null                  |
| `nickname`           | String or `null`                  | Yes      | Owner-only profile editor; legacy rows may be null                  |
| `displayName`        | String                            | Yes      | Tutor cards, profile, dashboard, and booking labels                 |
| `bio`                | String                            | Yes      | Profile editor and public tutor detail                              |
| `experienceYears`    | Integer                           | Yes      | Profile, search card, and tutor detail                              |
| `verificationStatus` | `PENDING \| VERIFIED \| REJECTED` | Yes      | Read-only verification state and publication eligibility            |
| `ratingAverage`      | Decimal string or `null`          | Yes      | Rating display; parse only for formatting; `null` means a new tutor |
| `reviewCount`        | Integer                           | Yes      | Rating context                                                      |

The current owner-profile API does not return `userId`, `createdAt`, or `updatedAt`. Public Tutor
and search responses must provide a separate unambiguous `tutorId` for navigation and availability
requests.

### `MyProfileResponse`

| Field             | Type                                     | Required | Used for                                    |
| ----------------- | ---------------------------------------- | -------- | ------------------------------------------- |
| `role`            | `STUDENT \| TUTOR \| ADMIN`              | Yes      | Chooses the role-specific profile shape     |
| `consentCurrent`  | Boolean                                  | Yes      | Opens the current privacy notice when false |
| `policyVersion`   | `YYYY-MM-DD` string                      | Yes      | Displays/submits the current version        |
| `profileComplete` | Boolean                                  | Yes      | Onboarding redirect and dashboard access    |
| `profile`         | `StudentProfile \| TutorProfile \| null` | Yes      | Owner-only profile data                     |

### `SubjectOption` and `GradeLevelOption`

| Object             | Fields                                                                              |
| ------------------ | ----------------------------------------------------------------------------------- |
| `SubjectOption`    | `id: UUID`, `code: string`, `name: string`, `active: boolean`                       |
| `GradeLevelOption` | `id: UUID`, `code: string`, `name: string`, `sortOrder: integer`, `active: boolean` |

### `TeachingListing`

| Field               | Type                             | Required | Used for                                         |
| ------------------- | -------------------------------- | -------- | ------------------------------------------------ |
| `id`                | UUID                             | Yes      | Listing selection, edit route, and booking input |
| `subject`           | `SubjectOption`                  | Yes      | Listing title and search/booking labels          |
| `gradeLevel`        | `GradeLevelOption`               | Yes      | Listing title and search/booking labels          |
| `pricePerHour`      | THB decimal                      | Yes      | Listing card and booking quote context           |
| `description`       | String                           | Yes      | Listing form, search result, and booking detail  |
| `publicationStatus` | `DRAFT \| PUBLISHED \| ARCHIVED` | Yes      | Tutor listing tabs and available actions         |
| `publishedAt`       | UTC timestamp or `null`          | Yes      | Publication metadata                             |
| `createdAt`         | UTC timestamp                    | Yes      | Stable record metadata                           |
| `updatedAt`         | UTC timestamp                    | Yes      | Listing card and edit state                      |

There is no listing `title`. Frontend derives the heading from `subject.name` and
`gradeLevel.name`.

### `OwnAvailabilitySlot`

| Field        | Type               | Required | Used for                              |
| ------------ | ------------------ | -------- | ------------------------------------- |
| `id`         | UUID               | Yes      | Internal delete/selection value       |
| `startAtUtc` | UTC timestamp      | Yes      | Bangkok date/start display            |
| `endAtUtc`   | UTC timestamp      | Yes      | Bangkok end time and derived duration |
| `state`      | `OPEN \| RESERVED` | Yes      | Badge and delete availability         |
| `createdAt`  | UTC timestamp      | Yes      | Stable ordering/debug metadata        |

`state` is derived. It is `RESERVED` when the slot has an active `PENDING` or `CONFIRMED` booking;
it is not stored on `AvailabilitySlot`.

### `PublicAvailabilitySlot`

| Field        | Type          | Required | Used for                      |
| ------------ | ------------- | -------- | ----------------------------- |
| `id`         | UUID          | Yes      | Booking selection             |
| `startAtUtc` | UTC timestamp | Yes      | Bangkok date/start display    |
| `endAtUtc`   | UTC timestamp | Yes      | Bangkok end time and duration |

The public response contains only future open slots. It must not expose `bookingId`, student data,
or deleted slots.

### `BookingView`

| Field            | Type                                            | Required | Used for                                                 |
| ---------------- | ----------------------------------------------- | -------- | -------------------------------------------------------- |
| `id`             | UUID                                            | Yes      | Internal selection and detail route; not displayed       |
| `status`         | `PENDING \| CONFIRMED \| COMPLETED \| CANCELED` | Yes      | Status badge and filters                                 |
| `createdAt`      | UTC timestamp                                   | Yes      | Submitted date and ordering                              |
| `updatedAt`      | UTC timestamp                                   | Yes      | Detail metadata                                          |
| `tutor`          | `{ userId, displayName }`                       | Yes      | Student booking labels                                   |
| `listing`        | `TeachingListing`                               | Yes      | Subject, grade, description, and booked offering         |
| `slot`           | `{ id, startAtUtc, endAtUtc }`                  | Yes      | Bangkok lesson time and duration                         |
| `subtotalAmount` | THB decimal                                     | Yes      | Booking amount breakdown                                 |
| `discountAmount` | THB decimal                                     | Yes      | Booking amount breakdown; Sprint 1 normally returns zero |
| `netAmount`      | THB decimal                                     | Yes      | Final amount snapshot                                    |
| `currency`       | Three-letter string                             | Yes      | Must be `THB` in Sprint 1                                |

Tutor-facing `BookingView` adds `student: { nickname: string }`. This is a participant-scoped
projection from `StudentProfile`; it must not include the Student's legal name, school,
grade-level profile, phone, email, or internal user ID.

## S1-T08 — Existing authentication contracts

These endpoints already exist. Their current DTO and Swagger contract remain authoritative.

| API                              | Authentication              | Input fields                                                  | Success output                                        | Page use                 |
| -------------------------------- | --------------------------- | ------------------------------------------------------------- | ----------------------------------------------------- | ------------------------ |
| `POST /auth/register`            | Public                      | Body: `email`, `password`, `role`, `consent`, `policyVersion` | `201 { message }`                                     | `/register`              |
| `POST /auth/verify-email`        | Public                      | Body: `token`                                                 | `200 AuthSessionResponse` plus refresh cookie         | `/register/verify`       |
| `POST /auth/resend-verification` | Public                      | Body: `email`                                                 | `200 { message }`                                     | `/register/verify`       |
| `POST /auth/login`               | Public                      | Body: `email`, `password`                                     | `200 AuthSessionResponse` plus refresh cookie         | `/`                      |
| `POST /auth/refresh`             | Refresh cookie              | No JSON body                                                  | `200 AuthSessionResponse` plus rotated refresh cookie | All authenticated pages  |
| `POST /auth/logout`              | Refresh cookie when present | No JSON body                                                  | `204`, no body, expired refresh cookie                | All authenticated pages  |
| `GET /auth/me`                   | Bearer token                | No input                                                      | `200 AuthUser`                                        | Authenticated shell      |
| `POST /auth/consent`             | Bearer token                | Body: `consent: true`, `policyVersion`                        | `200 { consentAcceptedAt, policyVersion }`            | Privacy modal/onboarding |

Registration validation: normalized email up to 254 characters; password 10–128 characters with at
least one letter and one number; role is lowercase `student` or `tutor`; consent must be true; and
the current `policyVersion` is `2026-09-09`. Verification token length is 32–256 characters.

Document `400`, `401`, `403`, `409`, `429`, and `503` exactly as already defined in
`auth.swagger.ts`.

## S1-T15 / S1-T31 — Owner profiles and Tutor listings

All endpoints in this section require a bearer session. Role-specific save routes use the role
guard; listing routes require a Tutor session. Admin behavior must be declared explicitly rather
than inherited accidentally.

### `GET /profiles/me`

- Pages: `/onboarding/profile`, `/dashboard/profile`, and `/dashboard`.
- Input: none; identity and role come from the bearer session.
- Output `200`: `MyProfileResponse`. Student and Tutor profile may be `null`; Admin returns
  `profile: null`, `profileComplete: true`, and `consentCurrent: true`.
- Errors: `401` unauthenticated, `404` only when the authenticated account no longer exists.

### `PUT /profiles/me/student`

| Input field  | Type   | Required | Validation                                      |
| ------------ | ------ | -------- | ----------------------------------------------- |
| `firstName`  | String | Yes      | Trimmed, 1–100 characters                       |
| `lastName`   | String | Yes      | Trimmed, 1–100 characters                       |
| `nickname`   | String | Yes      | Trimmed, 1–60 characters                        |
| `school`     | String | Yes      | Trimmed, 1–160 characters                       |
| `gradeLevel` | String | Yes      | Trimmed, 1–80 characters                        |
| `phone`      | String | Yes      | 8–32 phone characters; starts with `+` or digit |

- Behavior: upsert the authenticated Student's owner-only profile after current privacy consent.
- Output `200`: saved `StudentProfile`.
- Errors: `400` validation or stale consent, `401` unauthenticated, `403` wrong role.

### `PUT /profiles/me/tutor`

| Input field       | Type    | Required | Validation                 |
| ----------------- | ------- | -------- | -------------------------- |
| `firstName`       | String  | Yes      | Trimmed, 1–100 characters  |
| `lastName`        | String  | Yes      | Trimmed, 1–100 characters  |
| `nickname`        | String  | Yes      | Trimmed, 1–60 characters   |
| `displayName`     | String  | Yes      | Trimmed, 1–100 characters  |
| `bio`             | String  | Yes      | Trimmed, 1–2000 characters |
| `experienceYears` | Integer | Yes      | 0 or greater               |

- Behavior: upsert the authenticated Tutor's private names and public profile after current
  privacy consent. Client input cannot set verification or rating fields.
- Output `200`: complete saved `TutorProfile`.
- Errors: `400` validation or stale consent, `401` unauthenticated, `403` wrong role.

### Profile draft readiness and field-error audit

Checked against `ui-design/pages/student-profile.html`, `ui-design/pages/tutor-profile.html`, the
production `ProfileEditor`, Web API types/client, DTO validation, service selects, and Swagger at
`de95d0b`.

| Draft block                       | Data source                                      | Ready now                                                                                           | Remaining issue                                                                                                                          |
| --------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Student editable profile          | `GET /profiles/me`; `PUT /profiles/me/student`   | Yes: `firstName`, `lastName`, `nickname`, `school`, `gradeLevel`, and `phone` match exactly         | None for the six fields                                                                                                                  |
| Student account summary           | Profile response plus authenticated `user.email` | Yes                                                                                                 | `email` comes from Auth context, not the profile response                                                                                |
| Tutor editable profile            | `GET /profiles/me`; `PUT /profiles/me/tutor`     | Yes: `firstName`, `lastName`, `nickname`, `displayName`, `bio`, and `experienceYears` match exactly | Legacy Tutor names can load as `null`; the editor already converts them to empty strings                                                 |
| Tutor verification/rating summary | Tutor profile response                           | Yes: `verificationStatus`, `ratingAverage`, and `reviewCount` are returned read-only                | `ratingAverage` is a decimal string or `null`, matching the Web type and Swagger                                                         |
| Tutor account email               | Authenticated `user.email`                       | Yes                                                                                                 | It is intentionally outside the profile response                                                                                         |
| Tutor preview subject label       | Published listing joined with Subject            | No profile source                                                                                   | The hard-coded “English tutor” draft text needs listing/catalog data or must be replaced with generic copy                               |
| Tutor certificates                | Future `TutorDocument` API                       | No                                                                                                  | Upload, list, verification state, review note, and persisted removal are Sprint 2 and must not be connected to the profile save endpoint |

The production `ProfileEditor` now trims and validates every profile field before submission and
renders reviewed EN/TH errors beside the matching input. `authenticatedFetch` still receives a
Backend `message: string | string[]` without stable field keys. The editor can only map a server
message to a field when the message contains the DTO property name, while retaining the complete
form-level message for every API failure.

| Error case                           | Current API behavior                                                                                         | Current UI behavior                                                                                       | Needed before production polish                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Empty/space-only text                | DTO trims, then returns `400` for values below minimum length                                                | Client trims before save and shows an EN/TH inline error without calling the API                          | Covered                                                                     |
| Overlong text                        | DTO returns `400`; limits are names 100, nickname 60, school 160, grade level 80, display name 100, bio 2000 | `maxLength` prevents normal typing past the limit                                                         | Keep server validation; show an inline counter/error where useful           |
| Invalid Student phone                | DTO returns `400`; pattern is `^[+0-9][0-9 ()-]{7,31}$`                                                      | Client uses the same pattern and reviewed EN/TH inline copy                                               | Covered                                                                     |
| Invalid Tutor experience             | DTO returns `400` unless it is an integer at least zero                                                      | Client checks required, integer, and nonnegative rules with reviewed EN/TH inline copy                    | Add DTO tests for blank, decimal, and negative values                       |
| Stale privacy consent                | GET/save returns `400`                                                                                       | Editor switches to the privacy-consent step and can retry after acceptance                                | Covered                                                                     |
| Expired session                      | Returns `401`; the client refreshes once and expires the session if retry fails                              | Shared Auth context handles session expiry                                                                | Covered by shared auth behavior                                             |
| Wrong role on save                   | Returns `403`                                                                                                | Auth role selects the form and save endpoint; unexpected failures retain entered values and show an alert | Keep the server guard; a stable error code would improve recovery/reporting |
| Missing authenticated account on GET | Service can return `404 Account not found`                                                                   | One form-level message appears                                                                            | Add `404` to `GetMyProfileDoc` Swagger or change the service contract       |
| Network/non-JSON failure             | Browser/client fallback error                                                                                | One form-level message appears and entered values remain                                                  | Add reviewed EN/TH retry copy; no field should be marked invalid            |

The two Sprint 1 basic profile forms can be implemented with the current endpoints. Field-level
error UX, the Tutor subject label, and Tutor certificates require the follow-up work above.

### `GET /tutors/me/listings`

| Input field         | Location | Type                             | Required | Rule                              |
| ------------------- | -------- | -------------------------------- | -------- | --------------------------------- |
| `publicationStatus` | Query    | `draft \| published \| archived` | No       | Omit to return all owned listings |

- Output `200`: `TeachingListing[]`, ordered by `updatedAt` descending.
- Empty result: `200 []`.
- Errors: `400` invalid filter, `401`, `403`.

### `GET /tutors/me/listings/:listingId`

- Trello task: S1-T15/API-08.
- Input: path `listingId: UUID`.
- Output `200`: `TeachingListing`.
- Errors: `400` invalid UUID, `401`, `403`, `404 LISTING_NOT_FOUND`. Use the same `404` for a
  missing listing and a listing owned by someone else.

### `POST /tutors/me/listings`

| Input field    | Type        | Required | Validation                                    |
| -------------- | ----------- | -------- | --------------------------------------------- |
| `subjectId`    | UUID        | Yes      | Must reference an allowed catalog value       |
| `gradeLevelId` | UUID        | Yes      | Must reference an allowed catalog value       |
| `pricePerHour` | THB decimal | Yes      | Greater than zero, maximum two decimal places |
| `description`  | String      | Yes      | Trimmed, 20–1000 characters                   |

- Behavior: create an owned `DRAFT` listing. Client cannot set owner, publication status, or
  timestamps.
- Output `201`: complete created `TeachingListing`, not only its ID.
- Errors: `400`, `401`, `403`, `404 CATALOG_VALUE_NOT_FOUND`.

### `PATCH /tutors/me/listings/:listingId`

- Input: path `listingId: UUID`; body may contain one or more of `subjectId`, `gradeLevelId`,
  `pricePerHour`, and `description`.
- Behavior: update only an owned listing. Saving fields must not publish it implicitly.
- Output `200`: complete updated `TeachingListing`.
- Errors: `400`, `401`, `403`, `404 LISTING_NOT_FOUND`.

### `POST /tutors/me/listings/:listingId/publish`

- Input: path `listingId: UUID`; no body.
- Output `200`: complete updated `TeachingListing`.
- Errors: `400` incomplete listing, `401`, `403` wrong role or unverified tutor,
  `404 LISTING_NOT_FOUND`, `409` invalid transition.

Trello has no Sprint 1 endpoint for archiving or restoring a listing. Frontend must not add those
actions until a separate contract is assigned.

### `GET /subjects`

- Authentication: public.
- Input: none.
- Output `200`: `{ items: SubjectOption[] }`, ordered by `name` or a documented stable order.
- Rule: return active values for new selections. If inactive values are returned, keep `active` so
  Frontend can disable them.

### `GET /grade-levels`

- Authentication: public.
- Input: none.
- Output `200`: `{ items: GradeLevelOption[] }`, ordered by `sortOrder` ascending.
- Rule: same active/inactive behavior as subjects.

Trello ownership: S1-T21/API-03 for subjects and S1-T21/API-04 for grade levels.

## S1-T18 — Availability

### `GET /tutors/me/availability`

| Input field | Location | Type          | Required | Rule                                   |
| ----------- | -------- | ------------- | -------- | -------------------------------------- |
| `from`      | Query    | UTC timestamp | No       | Inclusive range start                  |
| `to`        | Query    | UTC timestamp | No       | Exclusive range end; later than `from` |

- Authentication: Tutor bearer session.
- Output `200`: `OwnAvailabilitySlot[]`, ordered by `startAtUtc` ascending.
- Empty result: `200 []`.
- Errors: `400` invalid range, `401`, `403`.
- Trello S1-T18/API-01 defines the derived field as `state: OPEN | RESERVED`. Swagger must
  preserve that field and enum for S1-T19 integration.

### `POST /tutors/me/availability`

| Input field | Type          | Required | Validation                   |
| ----------- | ------------- | -------- | ---------------------------- |
| `startAt`   | UTC timestamp | Yes      | Must be in the future        |
| `endAt`     | UTC timestamp | Yes      | Must be later than `startAt` |

- Authentication: Tutor bearer session.
- Output `201`: created slot with `id`, server-derived `tutorProfileId`, `startAtUtc`, and
  `endAtUtc`.
- Errors: `400 INVALID_TIME_RANGE`, `401`, `403`, `409 AVAILABILITY_OVERLAP`.
- Adjacent ranges are valid; overlapping ranges are rejected.

### `DELETE /tutors/me/availability/:slotId`

- Input: path `slotId: UUID`.
- Authentication: Tutor bearer session.
- Output `204`: no body.
- Errors: `400`, `401`, `403`, `404 SLOT_NOT_FOUND`, `409 SLOT_RESERVED`.
- Behavior: soft-delete only an owned slot that has no active booking.

### `GET /tutors/:tutorId/availability`

| Input field | Location | Type          | Required | Rule                         |
| ----------- | -------- | ------------- | -------- | ---------------------------- |
| `tutorId`   | Path     | UUID          | Yes      | Selected public tutor        |
| `from`      | Query    | UTC timestamp | No       | Inclusive future range start |
| `to`        | Query    | UTC timestamp | No       | Exclusive range end          |

- Authentication: public read of a verified tutor's future free slots.
- Output `200`: `PublicAvailabilitySlot[]`, ordered by `startAtUtc` ascending.
- Empty result: `200 []`.
- Errors: `400`, `404 TUTOR_NOT_FOUND`.

## S1-T21 — Search and public tutor detail

### `GET /tutors`

| Input field     | Location | Type        | Required | Rule                                        |
| --------------- | -------- | ----------- | -------- | ------------------------------------------- |
| `subject`       | Query    | String      | No       | Case-insensitive exact match                |
| `grade`         | Query    | String      | No       | Exact grade-label match                     |
| `maxPrice`      | Query    | THB decimal | No       | Inclusive and greater than or equal to zero |
| `minimumRating` | Query    | Number      | No       | Inclusive, 1–5; omit for any rating         |

- Authentication: public.
- Filters combine with AND.
- Confirmed Trello output `200`: an array whose item contains `id` (listing ID), `tutorId`,
  `displayName`, `subject`, `grade`, `pricePerHour`, `rating`, `description`, `reviewCount`,
  `experienceYears`, and `nextAvailableAt`. The verified state may remain implicit because only
  verified tutors are returned.
- Return one result per matching listing. Never combine a subject from one listing with the price
  of another listing owned by the same tutor.
- Only `VERIFIED` tutors and `PUBLISHED` listings are eligible.
- A `null` rating is not eligible when `minimumRating` is supplied.
- Errors: `400` invalid number, range, or unsupported query value. Exact no-match is `200 []`.

Sprint 1 does not require name search, minimum price, sorting, or recommendation reasons. Add those
only after their later task defines the contract.

### `GET /tutors/:tutorId`

- Trello task: S1-T21/API-02.
- Input: path `tutorId: UUID`.
- Authentication: public.
- Output `200`: `{ tutor: TutorProfile, listings: TeachingListing[] }`.
- Only public fields, a verified profile, and published listings are returned.
- Errors: `400`, `404 TUTOR_NOT_FOUND`.
- Do not return tutor email, consent/account metadata, documents, deleted listings, or drafts.

## S1-T24 and S1-T25 — Booking

### `GET /bookings/quote`

| Input field | Location | Type | Required | Rule                                     |
| ----------- | -------- | ---- | -------- | ---------------------------------------- |
| `listingId` | Query    | UUID | Yes      | Published listing selected by Student    |
| `slotId`    | Query    | UUID | Yes      | Future open slot owned by the same tutor |

- Authentication: Student bearer session.
- Output `200`: `{ tutor: { userId, displayName }, listing: TeachingListing, slot:
PublicAvailabilitySlot, subtotalAmount, discountAmount, netAmount, currency }`.
- Backend derives every amount. Frontend must not calculate the authoritative total.
- Errors: `400`, `401`, `403`, `404`, `409 SLOT_NOT_AVAILABLE`,
  `409 LISTING_SLOT_TUTOR_MISMATCH`.
- Trello task: S1-T24/API-02.

### `POST /bookings`

| Input field | Type | Required | Rule                       |
| ----------- | ---- | -------- | -------------------------- |
| `listingId` | UUID | Yes      | Selected published listing |
| `slotId`    | UUID | Yes      | Selected future open slot  |

- Authentication: Student bearer session. Student/tutor identity and amounts are server-derived.
- Confirmed Trello output `201`: `{ id, status, listingId, slotId, subtotalAmount,
discountAmount, netAmount, currency, createdAt }` with `status: PENDING`.
- Errors: `400`, `401`, `403`, `404`, `409 SLOT_NOT_AVAILABLE`,
  `409 LISTING_SLOT_TUTOR_MISMATCH`.
- Creation must be transactional so only one active booking can reserve a slot.
- The response is sufficient for the immediate success state when Frontend retains the selected
  tutor, listing, and slot in memory. It is not sufficient to reload booking detail or history;
  those pages still require the read endpoints below.

### `GET /bookings/me`

| Input field | Location | Type           | Required | Rule                                    |
| ----------- | -------- | -------------- | -------- | --------------------------------------- |
| `status`    | Query    | Booking status | No       | Exact status filter                     |
| `from`      | Query    | UTC timestamp  | No       | Filter by slot start                    |
| `to`        | Query    | UTC timestamp  | No       | Filter by slot start; later than `from` |

- Authentication: Student bearer session.
- Output `200`: `{ items: BookingView[], total: integer }`, newest relevant lesson first using a
  documented sort order.
- Used by Student `/dashboard` and `/dashboard/bookings`.
- Errors: `400`, `401`, `403`.
- Trello task: S1-T24/API-03.

### `GET /bookings/me/:bookingId`

- Input: path `bookingId: UUID`.
- Authentication: Student bearer session.
- Output `200`: complete owned `BookingView`.
- Errors: `400`, `401`, `403`, `404 BOOKING_NOT_FOUND`. Use the same `404` for another student's
  booking.
- Trello task: S1-T24/API-04.

### `GET /bookings/tutor`

| Input field | Location | Type           | Required | Rule                                                           |
| ----------- | -------- | -------------- | -------- | -------------------------------------------------------------- |
| `status`    | Query    | Booking status | No       | Exact status filter; Tutor dashboard primarily needs `PENDING` |
| `from`      | Query    | UTC timestamp  | No       | Filter by slot start                                           |
| `to`        | Query    | UTC timestamp  | No       | Filter by slot start                                           |

- Authentication: Tutor bearer session.
- Output `200`: `{ items: TutorBookingView[], total: integer }`.
- `TutorBookingView` contains the fields in `BookingView` plus
  `student: { nickname: string }`. It omits legal names, school, grade-level profile, phone, email,
  and internal Student ID.
- Used by Tutor `/dashboard`. Booking confirmation/rejection actions are Sprint 2.
- Errors: `400`, `401`, `403`.
- Trello task: S1-T24/API-05.

## Backend delivery files

Each feature should follow the structure already demonstrated by `auth` and `examples`:

| File                                             | Responsibility                                                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/<feature>/<feature>.dto.ts`        | Request and response classes, field types, class-validator rules, and `ApiProperty` metadata                  |
| `apps/api/src/<feature>/<feature>.swagger.ts`    | Operation description, bearer/cookie requirement, request schema, success schema, error schemas, and examples |
| `apps/api/src/<feature>/<feature>.controller.ts` | HTTP method/path, guards, role/ownership policy, DTO binding, and status code                                 |
| `apps/api/src/<feature>/<feature>.service.ts`    | Business rules, Prisma queries, joins, amount derivation, and transactions                                    |
| `apps/api/src/<feature>/*.spec.ts`               | Success, validation, authorization, ownership, overlap, and booking-race tests                                |

Existing feature folders include `profiles` and `tutors`. Remaining Sprint 1 folders are expected
for `catalogs`, `availability`, and `bookings`. The DTO and Swagger files are the reviewable API
contract. The controller and service must implement that contract; they must not introduce
undocumented request or response shapes.
