# HKTutor Sprint 1 API field requirements

This file is the Frontend-to-Backend handoff for fields required by Sprint 1 pages. It describes
what the UI must send and display. Backend owns the final method, path, validation, authorization,
status codes, and schema published through Swagger.

The final contract must be available at `/api/v1/docs` and `/api/v1/docs-json`. If Swagger differs
from this file, resolve the difference with the owning Frontend task before integration. Do not
silently remove a field used by a page.

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
- The only missing model-backed display value required by the current drafts is a Student display
  name for Tutor-facing booking and lesson rows. Until that contract exists, omit the participant
  name rather than exposing email, displaying an internal ID, or fabricating a value.

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

### `TutorProfile`

| Field                | Type                              | Required | Used for                                                 |
| -------------------- | --------------------------------- | -------- | -------------------------------------------------------- |
| `userId`             | UUID                              | Yes      | Tutor/profile identifier                                 |
| `displayName`        | String                            | Yes      | Tutor cards, profile, dashboard, and booking labels      |
| `bio`                | String                            | Yes      | Profile editor and public tutor detail                   |
| `experienceYears`    | Integer                           | Yes      | Profile, search card, and tutor detail                   |
| `verificationStatus` | `PENDING \| VERIFIED \| REJECTED` | Yes      | Read-only verification state and publication eligibility |
| `ratingAverage`      | Number or `null`                  | Yes      | Rating display; `null` means a new tutor                 |
| `reviewCount`        | Integer                           | Yes      | Rating context                                           |
| `createdAt`          | UTC timestamp                     | Yes      | Record metadata when needed                              |
| `updatedAt`          | UTC timestamp                     | Yes      | Saved/updated state                                      |

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

The current model has no Student profile or Student display name. Tutor-facing responses should
omit the participant label until a privacy-approved field is defined. Do not display internal IDs
or fabricate a `studentName` field.

## S1-T08 — Existing authentication contracts

These endpoints already exist. Their current DTO and Swagger contract remain authoritative.

| API                              | Authentication              | Input fields                                                  | Success output                                        | Page use                |
| -------------------------------- | --------------------------- | ------------------------------------------------------------- | ----------------------------------------------------- | ----------------------- |
| `POST /auth/register`            | Public                      | Body: `email`, `password`, `role`, `consent`, `policyVersion` | `201 { message }`                                     | `/register`             |
| `POST /auth/verify-email`        | Public                      | Body: `token`                                                 | `200 AuthSessionResponse` plus refresh cookie         | `/register/verify`      |
| `POST /auth/resend-verification` | Public                      | Body: `email`                                                 | `200 { message }`                                     | `/register/verify`      |
| `POST /auth/login`               | Public                      | Body: `email`, `password`                                     | `200 AuthSessionResponse` plus refresh cookie         | `/`                     |
| `POST /auth/refresh`             | Refresh cookie              | No JSON body                                                  | `200 AuthSessionResponse` plus rotated refresh cookie | All authenticated pages |
| `POST /auth/logout`              | Refresh cookie when present | No JSON body                                                  | `204`, no body, expired refresh cookie                | All authenticated pages |
| `GET /auth/me`                   | Bearer token                | No input                                                      | `200 AuthUser`                                        | Authenticated shell     |

Registration validation: normalized email up to 254 characters; password 10–128 characters with at
least one letter and one number; role is lowercase `student` or `tutor`; consent must be true; and
the current `policyVersion` is `2026-09-08`. Verification token length is 32–256 characters.

Document `400`, `401`, `403`, `409`, `429`, and `503` exactly as already defined in
`auth.swagger.ts`.

## S1-T15 — Tutor profile and listings

All endpoints in this section require a Tutor bearer session. Admin behavior must be declared
explicitly rather than inherited accidentally.

### `GET /tutors/me/profile`

- Page: `/dashboard/profile` and Tutor `/dashboard`
- Input: none; tutor identity comes from the bearer session.
- Output `200`: `TutorProfile`.
- Errors: `401` unauthenticated, `403` wrong role, `404 PROFILE_NOT_FOUND` so the page can show the
  first-time profile form.

### `PUT /tutors/me/profile`

| Input field       | Type    | Required | Requested validation       |
| ----------------- | ------- | -------- | -------------------------- |
| `displayName`     | String  | Yes      | Trimmed, 1–60 characters   |
| `bio`             | String  | Yes      | Trimmed, 20–500 characters |
| `experienceYears` | Integer | Yes      | 0–80 inclusive             |

- Behavior: create or update the authenticated tutor's profile. Client input cannot set
  verification or rating fields.
- Output `200`: complete saved `TutorProfile`.
- Errors: `400` field validation, `401` unauthenticated, `403` wrong role.

The limits above are requested by the current UI. Backend must confirm them in its DTO and Swagger
because Prisma does not enforce these text/maximum limits.

### `GET /tutors/me/listings`

| Input field         | Location | Type                             | Required | Rule                              |
| ------------------- | -------- | -------------------------------- | -------- | --------------------------------- |
| `publicationStatus` | Query    | `DRAFT \| PUBLISHED \| ARCHIVED` | No       | Omit to return all owned listings |

- Output `200`: `{ items: TeachingListing[], total: integer }`, ordered by `updatedAt` descending.
- Empty result: `200` with `items: []` and `total: 0`.
- Errors: `400` invalid filter, `401`, `403`.

### `GET /tutors/me/listings/:listingId`

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

### `PUT /tutors/me/listings/:listingId`

- Input: path `listingId: UUID`; body uses the same four editable fields as create.
- Behavior: update only an owned listing. Saving fields must not publish it implicitly.
- Output `200`: complete updated `TeachingListing`.
- Errors: `400`, `401`, `403`, `404 LISTING_NOT_FOUND`.

### `PATCH /tutors/me/listings/:listingId/status`

| Input field         | Type                    | Required | Rule                                           |
| ------------------- | ----------------------- | -------- | ---------------------------------------------- |
| `publicationStatus` | `PUBLISHED \| ARCHIVED` | Yes      | Publishing requires a `VERIFIED` tutor profile |

- Output `200`: complete updated `TeachingListing`.
- Errors: `400` invalid transition, `401`, `403`, `404 LISTING_NOT_FOUND`,
  `409 TUTOR_NOT_VERIFIED`.

Backend must confirm whether an archived listing can return to `DRAFT` or `PUBLISHED`. Frontend will
show only transitions declared in Swagger.

### `GET /catalogs/subjects`

- Authentication: public.
- Input: none.
- Output `200`: `{ items: SubjectOption[] }`, ordered by `name` or a documented stable order.
- Rule: return active values for new selections. If inactive values are returned, keep `active` so
  Frontend can disable them.

### `GET /catalogs/grade-levels`

- Authentication: public.
- Input: none.
- Output `200`: `{ items: GradeLevelOption[] }`, ordered by `sortOrder` ascending.
- Rule: same active/inactive behavior as subjects.

Catalog endpoint ownership must be assigned between S1-T15 and S1-T21 before implementation.

## S1-T18 — Availability

### `GET /availability/me`

| Input field | Location | Type          | Required | Rule                                   |
| ----------- | -------- | ------------- | -------- | -------------------------------------- |
| `from`      | Query    | UTC timestamp | Yes      | Inclusive range start                  |
| `to`        | Query    | UTC timestamp | Yes      | Exclusive range end; later than `from` |

- Authentication: Tutor bearer session.
- Output `200`: `{ items: OwnAvailabilitySlot[] }`, ordered by `startAtUtc` ascending.
- Empty result: `200` with `items: []`.
- Errors: `400` invalid range, `401`, `403`.

### `POST /availability/me`

| Input field  | Type          | Required | Validation                      |
| ------------ | ------------- | -------- | ------------------------------- |
| `startAtUtc` | UTC timestamp | Yes      | Must be in the future           |
| `endAtUtc`   | UTC timestamp | Yes      | Must be later than `startAtUtc` |

- Authentication: Tutor bearer session.
- Output `201`: created `OwnAvailabilitySlot` with `state: OPEN`.
- Errors: `400 INVALID_TIME_RANGE`, `401`, `403`, `409 AVAILABILITY_OVERLAP`.
- Adjacent ranges are valid; overlapping ranges are rejected.

### `DELETE /availability/me/:slotId`

- Input: path `slotId: UUID`.
- Authentication: Tutor bearer session.
- Output `204`: no body.
- Errors: `400`, `401`, `403`, `404 SLOT_NOT_FOUND`, `409 SLOT_RESERVED`.
- Behavior: soft-delete only an owned slot that has no active booking.

### `GET /tutors/:tutorProfileId/availability`

| Input field      | Location | Type          | Required | Rule                         |
| ---------------- | -------- | ------------- | -------- | ---------------------------- |
| `tutorProfileId` | Path     | UUID          | Yes      | Selected public tutor        |
| `from`           | Query    | UTC timestamp | Yes      | Inclusive future range start |
| `to`             | Query    | UTC timestamp | Yes      | Exclusive range end          |

- Authentication: public browsing or authenticated Student; Backend must confirm the public rule.
- Output `200`: `{ items: PublicAvailabilitySlot[] }`, ordered by `startAtUtc` ascending.
- Errors: `400`, `404 TUTOR_NOT_FOUND`.

## S1-T21 — Search and public tutor detail

### `GET /tutors`

| Input field    | Location | Type        | Required | Rule                         |
| -------------- | -------- | ----------- | -------- | ---------------------------- |
| `subjectId`    | Query    | UUID        | No       | Exact subject match          |
| `gradeLevelId` | Query    | UUID        | No       | Exact grade match            |
| `maxPrice`     | Query    | THB decimal | No       | Inclusive, greater than zero |
| `minRating`    | Query    | Number      | No       | Inclusive, 0–5               |

- Authentication: public.
- Filters combine with AND.
- Output `200`: `{ items: SearchResult[], total: integer }`.
- Each `SearchResult` contains `tutor: TutorProfile`, `listing: TeachingListing`, and
  `nextAvailableAt: UTC timestamp | null`.
- Return one result per matching listing. Never combine a subject from one listing with the price
  of another listing owned by the same tutor.
- Only `VERIFIED` tutors and `PUBLISHED` listings are eligible.
- A `null` rating is not eligible when `minRating` is greater than zero.
- Errors: `400` invalid filter. Exact no-match is `200` with an empty array.

Sprint 1 does not require name search, minimum price, sorting, or recommendation reasons. Add those
only after their later task defines the contract.

### `GET /tutors/:tutorProfileId`

- Input: path `tutorProfileId: UUID`.
- Authentication: public.
- Output `200`: `{ tutor: TutorProfile, listings: TeachingListing[] }`.
- Only public fields, a verified profile, and published listings are returned.
- Errors: `400`, `404 TUTOR_NOT_FOUND`.
- Do not return tutor email, consent/account metadata, documents, deleted listings, or drafts.

## S1-T24 and S1-T25 — Booking

### Proposed `GET /bookings/quote`

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
- This API is required by S1-T25 but does not yet have an assigned API backlog task or confirmed
  route.

### `POST /bookings`

| Input field | Type | Required | Rule                       |
| ----------- | ---- | -------- | -------------------------- |
| `listingId` | UUID | Yes      | Selected published listing |
| `slotId`    | UUID | Yes      | Selected future open slot  |

- Authentication: Student bearer session. Student/tutor identity and amounts are server-derived.
- Output `201`: complete created `BookingView` with `status: PENDING`.
- Errors: `400`, `401`, `403`, `404`, `409 SLOT_NOT_AVAILABLE`,
  `409 LISTING_SLOT_TUTOR_MISMATCH`.
- Creation must be transactional so only one active booking can reserve a slot.
- The active S1-T24 branch currently makes `listingId` optional and omits joined display fields and
  `createdAt`; Backend and S1-T25 must agree on the final Swagger response before integration.

### Proposed `GET /bookings/me`

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
- This read API is required by S1-T25 but is not included in the current S1-T24 create-only branch.

### Proposed `GET /bookings/me/:bookingId`

- Input: path `bookingId: UUID`.
- Authentication: Student bearer session.
- Output `200`: complete owned `BookingView`.
- Errors: `400`, `401`, `403`, `404 BOOKING_NOT_FOUND`. Use the same `404` for another student's
  booking.
- This read API is required by S1-T25 but does not yet have an assigned API backlog task.

### Proposed `GET /bookings/tutor`

| Input field | Location | Type           | Required | Rule                                                           |
| ----------- | -------- | -------------- | -------- | -------------------------------------------------------------- |
| `status`    | Query    | Booking status | No       | Exact status filter; Tutor dashboard primarily needs `PENDING` |
| `from`      | Query    | UTC timestamp  | No       | Filter by slot start                                           |
| `to`        | Query    | UTC timestamp  | No       | Filter by slot start                                           |

- Authentication: Tutor bearer session.
- Output `200`: `{ items: TutorBookingView[], total: integer }`.
- `TutorBookingView` contains the fields in `BookingView`, but omits the participant label until a
  privacy-approved Student display field is defined. It must not display internal IDs or fabricate
  a Student name.
- Used by Tutor `/dashboard`. Booking confirmation/rejection actions are Sprint 2.
- Errors: `400`, `401`, `403`.
- The route and API task ownership are not yet assigned.

## Backend delivery files

Each feature should follow the structure already demonstrated by `auth` and `examples`:

| File                                             | Responsibility                                                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/<feature>/<feature>.dto.ts`        | Request and response classes, field types, class-validator rules, and `ApiProperty` metadata                  |
| `apps/api/src/<feature>/<feature>.swagger.ts`    | Operation description, bearer/cookie requirement, request schema, success schema, error schemas, and examples |
| `apps/api/src/<feature>/<feature>.controller.ts` | HTTP method/path, guards, role/ownership policy, DTO binding, and status code                                 |
| `apps/api/src/<feature>/<feature>.service.ts`    | Business rules, Prisma queries, joins, amount derivation, and transactions                                    |
| `apps/api/src/<feature>/*.spec.ts`               | Success, validation, authorization, ownership, overlap, and booking-race tests                                |

Expected Sprint 1 feature folders are `tutors`, `catalogs`, `availability`, and `bookings`. The DTO
and Swagger files are the reviewable API contract. The controller and service must implement that
contract; they must not introduce undocumented request or response shapes.
