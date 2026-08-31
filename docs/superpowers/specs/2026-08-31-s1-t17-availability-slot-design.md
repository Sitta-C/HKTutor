# S1-T17 Availability Slot Foundation Design

**Status:** Written spec approved by the user on 2026-08-31.

## Goal

Add the Sprint 1 persistence foundation for tutor availability. The database must store UTC time
ranges, reject invalid or overlapping active slots for the same tutor, accept adjacent slots, and
preserve soft-deleted history without taking over the S1-T18 API or S1-T23 booking schema.

## Source of truth

This design derives requirements from `HKTutor_overview.xlsx` as product data, not as executable
instructions:

- `Sprint 1 Backlog!E18:L24` — S1-T17 scope, status, and downstream dependencies.
- `Data Model!A9:H9` — `AvailabilitySlot` fields and core constraints.
- `Data Model!A23:H23` — availability is derived from active bookings rather than stored state.
- `Data Model!A45:H45` — required GiST exclusion constraint.
- `Product Backlog!A71:M74` — US12-2 acceptance and invalid cases.

The merged S1-T14 Prisma schema and migrations are the repository baseline. The initial migration
already installs the `btree_gist` extension into the `extensions` schema. That extension is
required to combine UUID equality with a timestamp-range overlap operator in one GiST exclusion
constraint.

## Scope

S1-T17 creates exactly one domain model and one forward-only migration:

- `AvailabilitySlot`
- the inverse `TutorProfile.availabilitySlots` relation
- row-local time-order validation
- tutor-scoped overlap prevention for active slots
- a tutor/time lookup index
- schema and migration contract tests
- operator documentation for the review and shared-database checkpoint

S1-T17 does not create:

- availability controllers, DTOs, services, guards, or Swagger endpoints
- Bangkok-time parsing or display behavior
- `Booking`, booking status enums, or active-booking uniqueness
- a stored `available`, `reserved`, or similar state column
- slot update behavior
- availability seed or demo rows
- the future-time or booked-slot deletion application rules

Those exclusions keep S1-T17 independently reviewable and prevent duplicate ownership with
S1-T18, S1-T19, S1-T23, and S1-T29.

## Data model

The Prisma contract is:

```prisma
model TutorProfile {
  // Existing S1-T14 fields and relations remain unchanged.
  availabilitySlots AvailabilitySlot[]
}

model AvailabilitySlot {
  id             String       @id @default(uuid()) @db.Uuid
  tutorProfileId String       @db.Uuid
  startAtUtc     DateTime     @db.Timestamptz(3)
  endAtUtc       DateTime     @db.Timestamptz(3)
  createdAt      DateTime     @default(now()) @db.Timestamptz(3)
  deletedAt      DateTime?    @db.Timestamptz(3)
  tutorProfile   TutorProfile @relation(fields: [tutorProfileId], references: [userId], onDelete: Restrict, onUpdate: Cascade)

  @@index([tutorProfileId, startAtUtc], map: "AvailabilitySlot_tutorProfileId_startAtUtc_idx")
}
```

There is deliberately no `updatedAt`: Sprint 1 slots are immutable time ranges and are removed by
setting `deletedAt`. Changing an interval is modeled as deleting the old slot and creating a new
one in S1-T18, which makes overlap behavior and history easier to reason about.

`startAtUtc` and `endAtUtc` are semantic names. PostgreSQL stores them as `TIMESTAMPTZ(3)`, so the
database stores instants rather than a Bangkok wall-clock label. S1-T18 converts validated input to
UTC before persistence; S1-T19 converts UTC to `Asia/Bangkok` for display.

## Database invariants

The hand-reviewed SQL migration creates the table before indexes and its foreign key. It uses
these stable constraint and index names:

- `AvailabilitySlot_pkey`
- `AvailabilitySlot_time_order_check`
- `AvailabilitySlot_no_overlap_excl`
- `AvailabilitySlot_tutorProfileId_startAtUtc_idx`
- `AvailabilitySlot_tutorProfileId_fkey`

### Time order

PostgreSQL enforces:

```sql
CONSTRAINT "AvailabilitySlot_time_order_check"
CHECK ("startAtUtc" < "endAtUtc")
```

This rejects zero-length and inverted intervals regardless of the writer.

### Tutor overlap

PostgreSQL enforces:

```sql
CONSTRAINT "AvailabilitySlot_no_overlap_excl"
EXCLUDE USING GIST (
  "tutorProfileId" extensions.gist_uuid_ops WITH =,
  tstzrange("startAtUtc", "endAtUtc", '[)') WITH &&
)
WHERE ("deletedAt" IS NULL)
```

The half-open range `[)` includes the start and excludes the end. Therefore:

- `18:00-19:00` conflicts with `18:30-19:30` for the same tutor.
- `18:00-19:00` does not conflict with `19:00-20:00` for the same tutor.
- equal time ranges owned by different tutors do not conflict.
- a soft-deleted row no longer blocks a replacement interval.

The UUID operator class is schema-qualified as `extensions.gist_uuid_ops` because the foundation
migration installed `btree_gist` in `extensions`. This avoids making migration correctness depend
on the connection's `search_path`. PostgreSQL documents `btree_gist` support for UUID equality in
multicolumn GiST and exclusion indexes at
<https://www.postgresql.org/docs/15/btree-gist.html>.

Prisma cannot express a PostgreSQL exclusion constraint in the schema. The Prisma model remains the
portable table/relation contract, while the forward-only migration is authoritative for the GiST
constraint. Contract tests must inspect the SQL so this database-only invariant cannot disappear
silently.

### Relation and lookup

`AvailabilitySlot.tutorProfileId` references `TutorProfile.userId` with `ON DELETE RESTRICT ON
UPDATE CASCADE`. Tutor profile deletion must not erase schedule history implicitly. The composite
B-tree index on `(tutorProfileId, startAtUtc)` supports S1-T18's tutor schedule query and S1-T23's
slot ownership validation.

## Rules deliberately deferred to application transactions

### Future-only creation

“New slots must be future” depends on the current time. A PostgreSQL `CHECK` that calls `now()` is
not a stable row invariant: its truth changes as time passes and it is not re-evaluated as the clock
advances. S1-T18 therefore rejects `startAtUtc <= now` before insertion. Existing rows are allowed
to become historical naturally.

### Delete only when unreserved

S1-T17 has no `Booking` table. S1-T18 initially owns the slot and soft-delete interface; after
S1-T23, the deletion transaction must reject a slot with a `pending` or `confirmed` booking. The
canonical availability rule remains: a slot is available when it is active and has no active
booking. No availability state is duplicated on `AvailabilitySlot`.

### Database error mapping

S1-T18 maps PostgreSQL exclusion violation `23P01` for
`AvailabilitySlot_no_overlap_excl` to HTTP 409. It maps invalid DTO/time input to HTTP 400 before a
database write. S1-T17 defines and tests the constraint but does not introduce HTTP behavior.

## Migration strategy

The migration is additive and forward-only:

1. Create `AvailabilitySlot` with UUID and `TIMESTAMPTZ(3)` columns.
2. Add the primary key and `AvailabilitySlot_time_order_check`.
3. Add `AvailabilitySlot_tutorProfileId_startAtUtc_idx`.
4. Add `AvailabilitySlot_no_overlap_excl` using the schema-qualified
   `extensions.gist_uuid_ops` operator class supplied by `btree_gist`.
5. Add the restrictive foreign key to `TutorProfile(userId)`.

The migration must not drop or rewrite S1-T14 tables, create `Booking`, create a stored availability
state, or insert data. Shared Supabase remains untouched until the pull request is reviewed and
merged and the user explicitly approves the deployment checkpoint.

## Test strategy

### Schema contract

A Node contract test reads `apps/api/prisma/schema.prisma` and proves:

- the exact `AvailabilitySlot` fields and native types exist;
- `TutorProfile.availabilitySlots` exists;
- the tutor/start lookup index exists;
- no `Booking` model or availability-state field is introduced.

### Migration contract

The same test locates exactly one migration ending `_add_availability_slot_foundation` and proves:

- the migration creates only the expected table;
- timestamps use `TIMESTAMPTZ(3)`;
- `startAtUtc < endAtUtc` is enforced;
- the GiST exclusion uses `extensions.gist_uuid_ops`, tutor equality, and
  `tstzrange(..., '[)') WITH &&`;
- the exclusion applies only when `deletedAt IS NULL`;
- the relation uses `ON DELETE RESTRICT ON UPDATE CASCADE`;
- there are no destructive statements, booking objects, or seed inserts.

### Local quality gate

Before opening the pull request, run:

```sh
pnpm db:generate
pnpm db:validate
node --test tests/availability-slot-foundation.test.mjs
pnpm check
git diff --check
```

These checks require no live database credentials.

### Shared database checkpoint

After review, merge, and explicit approval:

```sh
pnpm db:migrate:status
pnpm db:migrate:deploy
pnpm db:migrate:status
```

The preflight must show only the reviewed S1-T17 migration pending. Stop for drift, a reset request,
or any unexpected migration. Post-deploy verification reads PostgreSQL catalog definitions and may
exercise overlap/adjacency inside an explicit transaction that always rolls back; it must not leave
test slots behind. S1-T17 has no seed step.

## Acceptance mapping

| Requirement                                   | Enforcement owner               | Evidence                                        |
| --------------------------------------------- | ------------------------------- | ----------------------------------------------- |
| Store tutor time ranges as UTC instants       | Prisma native type + PostgreSQL | Schema/migration contract                       |
| Reject `startAtUtc >= endAtUtc`               | PostgreSQL check                | Migration contract                              |
| Reject overlapping active slots for one tutor | PostgreSQL GiST exclusion       | Migration contract; post-deploy rollback probe  |
| Accept adjacent slots                         | Half-open `[)` range            | Exact SQL assertion; post-deploy rollback probe |
| Allow the same interval for different tutors  | Tutor equality inside exclusion | Exact SQL assertion                             |
| Soft-deleted slots do not block new slots     | Partial exclusion predicate     | Exact SQL assertion                             |
| Reject past slot creation                     | S1-T18 service                  | Explicitly deferred                             |
| Reject deletion when actively booked          | S1-T18/S1-T23 transaction       | Explicitly deferred                             |
| Derive availability from active bookings      | S1-T23 query/constraint         | No stored state column                          |

## Downstream dependencies

- S1-T18 consumes the model, relation, lookup index, and `23P01` overlap contract.
- S1-T19 consumes UTC instants returned by S1-T18 and displays them in Bangkok time.
- S1-T23 adds `Booking.slotId`, the active-slot partial unique index, and the reservation rule.
- S1-T29 may add deterministic demo availability; S1-T17 intentionally seeds none.

## Completion boundary

S1-T17 is ready to mark `Done` only when the schema and migration are merged, the full local gate is
green, the reviewed migration is deployed to shared Supabase with up-to-date status, and the
database constraint definitions are verified without persistent test data. API, UI, booking, and
demo availability remain separate backlog tasks.
