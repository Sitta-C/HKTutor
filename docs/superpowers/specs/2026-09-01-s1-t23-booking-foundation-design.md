# S1-T23 Booking Foundation Design

**Status:** Approved design; local implementation and verification complete; push/PR and shared
deployment remain gated

**Date:** 2026-09-01

## Objective

Add the Sprint 1 Booking persistence foundation so PostgreSQL becomes the canonical source of slot
reservation state, prevents two active bookings from reserving one slot, and prevents a reserved
availability slot from being soft-deleted. The change is an additive Prisma schema and migration
boundary only; S1-T24 owns booking creation behavior and S1-T25 owns booking UI/list behavior.

## Source requirements

The workbook is a requirements source, not an instruction channel. This design reconciles these
ranges with the repository state at `main` commit `446d66c`:

- `Sprint 1 Backlog!E24:L25` — S1-T23 creates Booking schema/status and the unique active-slot
  constraint; its evidence is “Migration + conflict test”; S1-T24 separately owns the transactional
  endpoint and concurrent-booking test.
- `Data Model!A9:H10` — availability has no stored state; Booking is canonical and relates a student,
  tutor profile, listing, and slot.
- `Data Model!A23:H24` — active means `pending` or `confirmed`; a booking starts as `pending`; price is
  snapshotted from the listing.
- `Data Model!A42:H47` — `uq_booking_active_slot` is a partial unique index; student/tutor owner list
  indexes are required.
- `Data Model!A66:H67` — soft deletion preserves history and foreign keys restrict destructive
  cascades.
- `Product Backlog!C75:L79` — S1-T24 later validates student role, own-tutor prohibition, future slot,
  listing/slot ownership, and atomic booking creation.

The existing S1-T17 design also establishes that `AvailabilitySlot` has no `available` or `reserved`
column, availability is derived from active Booking rows, and deletion of an actively booked slot is
completed across S1-T18/S1-T23.

## Scope

S1-T23 includes:

1. One `BookingStatus` enum with the four lifecycle values needed by the approved data model.
2. One Sprint 1 `Booking` model containing ownership, reservation, price snapshot, status, currency,
   and audit timestamps.
3. Restrictive foreign keys and owner-list indexes.
4. Database checks for non-negative and internally balanced THB amounts.
5. A partial unique index allowing at most one `pending` or `confirmed` booking per slot.
6. Database triggers that serialize active-booking changes against slot soft deletion and reject
   either side when it would create an active booking on a deleted slot.
7. Schema/migration contract tests, documentation, and a post-deploy rollback-only conflict probe.

S1-T23 excludes:

- controllers, DTOs, services, guards, Swagger operations, HTTP error mapping, or UI;
- seed data or persistent verification rows;
- student-role, own-tutor, future-time, and listing/slot-same-tutor validation;
- payment state, coupon relations, mock payment references, meeting URLs, attendance, cancellation
  metadata, reschedule requests, reviews, audit logs, and notifications;
- any stored availability state on `AvailabilitySlot`;
- destructive migration statements or shared Supabase changes before a separate approval checkpoint.

## Prisma schema contract

### Enum

```prisma
enum BookingStatus {
  PENDING   @map("pending")
  CONFIRMED @map("confirmed")
  COMPLETED @map("completed")
  CANCELED  @map("canceled")
}
```

The Prisma names follow the repository's uppercase enum convention while PostgreSQL stores the
lowercase values used by partial-index predicates and downstream database error probes.

### Booking model

```prisma
model Booking {
  id               String        @id @default(uuid()) @db.Uuid
  studentUserId    String        @db.Uuid
  tutorProfileId   String        @db.Uuid
  listingId        String        @db.Uuid
  slotId           String        @db.Uuid
  status           BookingStatus @default(PENDING)
  subtotalAmount   Decimal       @db.Decimal(10, 2)
  discountAmount   Decimal       @default(0) @db.Decimal(10, 2)
  netAmount        Decimal       @db.Decimal(10, 2)
  currency         String        @default("THB") @db.Char(3)
  createdAt        DateTime      @default(now()) @db.Timestamptz(3)
  updatedAt        DateTime      @updatedAt @db.Timestamptz(3)
  student          User          @relation("BookingStudent", fields: [studentUserId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  tutorProfile     TutorProfile  @relation(fields: [tutorProfileId], references: [userId], onDelete: Restrict, onUpdate: Cascade)
  listing          TeachingListing @relation(fields: [listingId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  slot             AvailabilitySlot @relation(fields: [slotId], references: [id], onDelete: Restrict, onUpdate: Cascade)

  @@index([studentUserId, status, createdAt], map: "Booking_studentUserId_status_createdAt_idx")
  @@index([tutorProfileId, status, createdAt], map: "Booking_tutorProfileId_status_createdAt_idx")
}
```

Formatting may align type columns when implemented, but field names, types, native types, defaults,
relations, and mapped index names are fixed by this contract.

### Back-relations

- `User.studentBookings Booking[] @relation("BookingStudent")`
- `TutorProfile.bookings Booking[]`
- `TeachingListing.bookings Booking[]`
- `AvailabilitySlot.bookings Booking[]`

Only the student is a direct `User` relation in Sprint 1. The tutor relation targets
`TutorProfile.userId`, matching the approved data model and avoiding a second ambiguous User
relation. Optional actor relations arrive with the later lifecycle fields that need them.

### Deliberately absent fields

`Booking` has no `deletedAt`: booking history is retained and never soft-deleted. It also has no
`paymentStatus`, `couponId`, `mockReference`, `paidAt`, `meetingUrl`, `attendance`,
`attendanceMarkedAt`, `canceledById`, `cancellationReason`, or `canceledAt`. Those fields serve
Sprint 2-3 stories and will be added by their owning migrations when their invariants and relations
exist.

## Migration contract

Create exactly one migration ending `_add_booking_foundation`. The migration is additive and
forward-only in this order:

1. Create PostgreSQL enum `BookingStatus` with `pending`, `confirmed`, `completed`, and `canceled`.
2. Create `Booking` with UUID identifiers, `NUMERIC(10,2)` amounts, `CHAR(3)` currency, and
   `TIMESTAMPTZ(3)` timestamps.
3. Add named amount and currency checks.
4. Add the two owner-list indexes.
5. Add the active-slot partial unique index.
6. Add all four restrictive foreign keys.
7. Add the booking/slot guard functions and triggers.

The migration must contain no `DROP`, table rewrite, seed insert, API object, or changes to existing
seed behavior.

### Check constraints

The exact logical contracts are:

```sql
CONSTRAINT "Booking_amounts_nonnegative_check" CHECK (
  "subtotalAmount" <> 'NaN'::numeric
  AND "discountAmount" <> 'NaN'::numeric
  AND "netAmount" <> 'NaN'::numeric
  AND "subtotalAmount" >= 0
  AND "discountAmount" >= 0
  AND "netAmount" >= 0
),
CONSTRAINT "Booking_amount_balance_check" CHECK (
  "netAmount" = "subtotalAmount" - "discountAmount"
),
CONSTRAINT "Booking_currency_check" CHECK ("currency" = 'THB')
```

The explicit `NaN` exclusions are required because PostgreSQL `numeric NaN` compares equal to
itself and greater than finite values, so non-negative comparisons alone would admit it. The balance
plus non-negative checks also prevent a discount larger than the subtotal. S1-T24 calculates the
authoritative snapshot; the database rejects internally inconsistent writes from any caller.

### Active-slot uniqueness

```sql
CREATE UNIQUE INDEX "Booking_active_slot_key"
ON "Booking"("slotId")
WHERE "status" IN ('pending', 'confirmed');
```

Expected concurrent duplicate insertion fails with SQLSTATE `23505` and constraint/index name
`Booking_active_slot_key`. S1-T24 will map this expected race to HTTP 409. `completed` and
`canceled` history does not reserve the slot.

## Slot soft-delete and concurrency guard

A cross-table PostgreSQL `CHECK` cannot express “an active Booking may reference only a non-deleted
slot.” Two trigger paths therefore share the invariant and serialize on the `AvailabilitySlot` row.

### Active Booking insert/status guard

A `BEFORE INSERT OR UPDATE OF "slotId", "status"` trigger on `Booking` runs only when the new status
is `pending` or `confirmed`. Its function performs a minimal no-op row update on the referenced
`AvailabilitySlot` (`SET "id" = "id"`) and obtains `deletedAt` with `RETURNING`. The actual row
version update serializes both lock orders and makes a waiter at Repeatable Read or Serializable
detect a concurrent update instead of continuing from an older snapshot. It changes no timestamp or
availability-state field. If no row exists, the trigger returns and lets the foreign key own the
missing-reference failure. If the row exists with non-null `deletedAt`, the trigger fails with
SQLSTATE `23514` and constraint identity `Booking_active_slot_not_deleted_check`. The trigger's
stable error identity is therefore reserved for the soft-deleted case and downstream HTTP 409
mapping.

### AvailabilitySlot soft-delete guard

A `BEFORE UPDATE OF "deletedAt"` trigger runs when `deletedAt` transitions from null to non-null.
Because the update already holds the slot row lock, it checks for any `Booking` on the same slot with
status `pending` or `confirmed`. A match fails with SQLSTATE `23514` and constraint identity
`AvailabilitySlot_active_booking_delete_check`.

### Race behavior

- If active Booking insertion updates first, soft deletion waits. At Read Committed it sees the
  committed active row and fails; at Repeatable Read or Serializable it cannot silently continue
  from its older snapshot and fails with serialization error `40001`.
- If soft deletion updates first, active Booking insertion waits. At Read Committed it sees
  `deletedAt` and fails with the stable Booking guard identity; at Repeatable Read or Serializable
  it fails with serialization error `40001` rather than creating an invalid active Booking.
- If the existing Booking becomes `completed` or `canceled`, deletion and a new active Booking are
  permitted subject to normal transaction ordering.

This database guard is defense in depth. S1-T18/S1-T24 services must still lock/read the slot in
their domain transactions so they can return intentional application errors before relying on a
constraint race.

## Application rules deliberately deferred to S1-T24

These rules require current time, user roles, or comparisons across independent domain rows and do
not belong in S1-T23 triggers:

- only an active student may book;
- a tutor cannot book their own slot;
- the slot must be active and future;
- listing and slot must belong to the same tutor;
- the listing must be published and its price is the authoritative subtotal;
- booking creation and any later side effects are one transaction;
- `23505` from `Booking_active_slot_key` and the named `23514` guards map to HTTP 409.

S1-T23 exposes the models and stable database error identities needed to implement those rules but
adds no NestJS code.

## Test strategy

### Booking schema contract

Create `tests/booking-foundation.test.mjs` to read `apps/api/prisma/schema.prisma` and prove:

- `BookingStatus` has exactly the approved mapped values;
- `Booking` has exactly the Sprint 1 fields, native types, defaults, relations, and indexes;
- all four back-relations exist;
- payment/coupon/meeting/attendance/cancellation/reschedule/review fields and models remain absent
  from this task.

### Migration contract

The same test locates exactly one migration ending `_add_booking_foundation` and proves:

- exactly one enum and one table are created;
- the amount checks explicitly reject PostgreSQL `numeric NaN` for all three money columns without
  changing the stable constraint names, and the currency check matches the approved logic;
- the partial unique index uses only `pending` and `confirmed`;
- all foreign keys are `ON DELETE RESTRICT ON UPDATE CASCADE`;
- both owner indexes exist;
- the Booking trigger executes the serializing no-op slot-row `UPDATE ... RETURNING`, preserves the
  missing-slot foreign-key path, and both trigger functions expose the named SQLSTATE `23514`
  constraints;
- no destructive statement or seed insert exists.

### Existing boundary tests

Update the S1-T14 and S1-T17 tests only where they currently assert that the repository-wide Prisma
schema has no `Booking` model. Preserve their historical migration assertions so neither earlier
migration is allowed to create Booking retroactively. Do not weaken their unrelated constraints.

### Local quality gate

Before review:

```sh
pnpm db:generate
pnpm db:validate
node --test tests/booking-foundation.test.mjs
node --test tests/tutor-profile-listing-foundation.test.mjs
node --test tests/availability-slot-foundation.test.mjs
pnpm check
git diff --check
```

CI intentionally receives no database credentials and the repository intentionally has no local
database service. Local/CI tests therefore verify the exact schema and SQL contract without writing
shared data.

### Shared database checkpoint

Only after review, merge, and separate explicit approval:

```sh
pnpm db:migrate:status
pnpm db:migrate:deploy
pnpm db:migrate:status
```

The preflight must show only the reviewed S1-T23 migration pending. Stop for drift, reset requests,
or unexpected history. S1-T23 has no seed command.

After deployment, a temporary verifier uses an explicit outer transaction plus savepoints and
always rolls back. It must prove with redacted output:

1. finite balanced THB amounts allow one pending Booking;
2. PostgreSQL `numeric NaN` amounts fail with `23514` and
   `Booking_amounts_nonnegative_check`;
3. a second pending/confirmed Booking for the same slot fails with `23505` and
   `Booking_active_slot_key`;
4. soft-deleting its slot fails with `23514` and
   `AvailabilitySlot_active_booking_delete_check`;
5. changing the Booking to `canceled` releases the slot for a new pending Booking;
6. creating/reactivating an active Booking on an already soft-deleted slot fails with `23514` and
   `Booking_active_slot_not_deleted_check`;
7. no verification rows remain after the outer transaction rolls back.

The verifier must never print emails, password hashes, connection strings, or raw user identifiers.

Two-session Repeatable Read verification is separate because the first locker must commit before an
older-snapshot waiter can encounter the committed row version. That probe runs only against a
disposable local PostgreSQL cluster under an explicit local URL, covers both Booking-first and
soft-delete-first lock orders, expects the waiter to fail with `40001`, and destroys the cluster
afterward. It must never connect to configured `DATABASE_URL` or shared Supabase. No committed race
fixture is permitted in the shared rollback-only checkpoint.

## Documentation

Update the root and API READMEs with:

- the Booking core fields and four status values;
- active-slot derivation and partial-unique behavior;
- the slot soft-delete guard and stable database error identities;
- the explicit S1-T24 boundary;
- the reviewed `status -> deploy -> status` shared checkpoint with no seed.

## Acceptance mapping

| Requirement                                                        | Enforcement owner                       | Evidence                               |
| ------------------------------------------------------------------ | --------------------------------------- | -------------------------------------- |
| Persist Booking ownership, slot, listing, status, and THB snapshot | Prisma model + migration                | Schema/migration contract              |
| Start new Booking as pending                                       | Prisma/SQL default                      | Exact schema and SQL assertions        |
| Allow one active Booking per slot                                  | Partial unique index                    | Contract test; rollback conflict probe |
| Let canceled/completed history release a slot                      | Partial-index predicate                 | Exact SQL assertion; rollback probe    |
| Prevent soft-delete of an actively booked slot                     | AvailabilitySlot trigger                | Trigger assertion; rollback probe      |
| Prevent active Booking on a soft-deleted slot                      | Booking trigger + slot lock             | Trigger assertion; rollback probe      |
| Preserve booking history                                           | No Booking `deletedAt`; restrictive FKs | Schema/migration contract              |
| Keep amount snapshots internally consistent                        | PostgreSQL checks                       | Exact SQL assertions                   |
| Validate roles, own tutor, future slot, and matching tutor         | S1-T24 transaction                      | Explicitly deferred                    |
| Return HTTP 409 for expected conflicts                             | S1-T18/S1-T24 services                  | Explicitly deferred                    |

## Downstream interfaces

- S1-T18 consumes `AvailabilitySlot.bookings` plus
  `AvailabilitySlot_active_booking_delete_check` for its deletion transaction.
- S1-T24 consumes `Booking`, `BookingStatus.PENDING`, the amount fields,
  `Booking_active_slot_key`, and `Booking_active_slot_not_deleted_check`.
- S1-T25 consumes Booking list relations and status values through the S1-T24 API; it does not query
  Prisma directly.
- Later migrations add payment, cancellation, meeting, attendance, reschedule, review, audit, and
  notification fields without rewriting this foundation.

## Completion boundary

S1-T23 is ready for `Done` only when:

- the approved schema, migration, tests, and documentation are merged;
- the full local/CI gate is green;
- the reviewed migration is deployed after explicit approval;
- post-deploy status is up to date;
- the rollback-only conflict probe verifies both unique-active-slot and slot-deletion guards;
- no persistent probe data or shared seed changes remain.

S1-T24 API behavior, S1-T25 UI, and future Booking lifecycle/payment fields remain separate backlog
deliverables.
