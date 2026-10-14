BEGIN;

CREATE TYPE "RescheduleRequestStatus" AS ENUM ('pending', 'approved', 'rejected', 'withdrawn');

CREATE TABLE "RescheduleRequest" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "requestedById" UUID NOT NULL,
    "fromSlotId" UUID NOT NULL,
    "requestedSlotId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RescheduleRequestStatus" NOT NULL DEFAULT 'pending',
    "reviewedById" UUID,
    "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMPTZ(3),
    "withdrawnAt" TIMESTAMPTZ(3),

    CONSTRAINT "RescheduleRequest_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RescheduleRequest_distinct_slots_check" CHECK ("fromSlotId" <> "requestedSlotId"),
    CONSTRAINT "RescheduleRequest_reason_check" CHECK (
        "reason" = BTRIM("reason")
        AND CHAR_LENGTH("reason") BETWEEN 1 AND 500
        AND "reason" ~ '[^[:space:]]'
    ),
    CONSTRAINT "RescheduleRequest_lifecycle_check" CHECK (
        (
            "status" = 'pending'
            AND "reviewedById" IS NULL
            AND "decidedAt" IS NULL
            AND "withdrawnAt" IS NULL
        )
        OR
        (
            "status" IN ('approved', 'rejected')
            AND "reviewedById" IS NOT NULL
            AND "reviewedById" <> "requestedById"
            AND "decidedAt" IS NOT NULL
            AND "decidedAt" >= "requestedAt"
            AND "withdrawnAt" IS NULL
        )
        OR
        (
            "status" = 'withdrawn'
            AND "reviewedById" IS NULL
            AND "decidedAt" IS NULL
            AND "withdrawnAt" IS NOT NULL
            AND "withdrawnAt" >= "requestedAt"
        )
    )
);

-- Targets remain available until approval; competing requests may name the same target.
CREATE UNIQUE INDEX "RescheduleRequest_pending_booking_key"
ON "RescheduleRequest"("bookingId") WHERE "status" = 'pending';

CREATE INDEX "RescheduleRequest_bookingId_status_requestedAt_id_idx"
ON "RescheduleRequest"("bookingId", "status", "requestedAt", "id");

-- Counterparty inboxes join through the existing student/tutor Booking indexes.
CREATE INDEX "RescheduleRequest_requestedById_status_requestedAt_id_idx"
ON "RescheduleRequest"("requestedById", "status", "requestedAt", "id");
CREATE INDEX "RescheduleRequest_reviewedById_idx" ON "RescheduleRequest"("reviewedById");
CREATE INDEX "RescheduleRequest_fromSlotId_idx" ON "RescheduleRequest"("fromSlotId");
CREATE INDEX "RescheduleRequest_requestedSlotId_idx" ON "RescheduleRequest"("requestedSlotId");

ALTER TABLE "RescheduleRequest"
ADD CONSTRAINT "RescheduleRequest_bookingId_fkey"
FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "RescheduleRequest_requestedById_fkey"
FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "RescheduleRequest_reviewedById_fkey"
FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "RescheduleRequest_fromSlotId_fkey"
FOREIGN KEY ("fromSlotId") REFERENCES "AvailabilitySlot"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "RescheduleRequest_requestedSlotId_fkey"
FOREIGN KEY ("requestedSlotId") REFERENCES "AvailabilitySlot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "validate_reschedule_request"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    booking_student UUID;
    booking_tutor UUID;
    booking_slot UUID;
    booking_status "BookingStatus";
    requester_role "Role";
    reviewer_role "Role";
    source_tutor UUID;
    target_tutor UUID;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW."id" IS DISTINCT FROM OLD."id"
            OR NEW."bookingId" IS DISTINCT FROM OLD."bookingId"
            OR NEW."requestedById" IS DISTINCT FROM OLD."requestedById"
            OR NEW."fromSlotId" IS DISTINCT FROM OLD."fromSlotId"
            OR NEW."requestedSlotId" IS DISTINCT FROM OLD."requestedSlotId"
            OR NEW."reason" IS DISTINCT FROM OLD."reason"
            OR NEW."requestedAt" IS DISTINCT FROM OLD."requestedAt" THEN
            RAISE EXCEPTION USING ERRCODE = '23514',
                MESSAGE = 'Reschedule request identity is immutable',
                CONSTRAINT = 'RescheduleRequest_identity_immutable_check';
        END IF;
        IF OLD."status" <> 'pending' AND NEW IS DISTINCT FROM OLD THEN
            RAISE EXCEPTION USING ERRCODE = '23514',
                MESSAGE = 'Closed reschedule requests are immutable',
                CONSTRAINT = 'RescheduleRequest_terminal_check';
        END IF;
    END IF;

    IF TG_OP = 'INSERT' THEN
        -- Serialize creation with booking changes; the unique index is the final race guard.
        SELECT "studentUserId", "tutorProfileId", "slotId", "status"
        INTO booking_student, booking_tutor, booking_slot, booking_status
        FROM "Booking" WHERE "id" = NEW."bookingId" FOR UPDATE;
    ELSE
        SELECT "studentUserId", "tutorProfileId", "slotId", "status"
        INTO booking_student, booking_tutor, booking_slot, booking_status
        FROM "Booking" WHERE "id" = NEW."bookingId";
    END IF;
    IF NOT FOUND THEN
        RETURN NEW; -- The foreign key reports the missing booking.
    END IF;

    SELECT "role" INTO requester_role FROM "User" WHERE "id" = NEW."requestedById";
    IF NOT (
        (NEW."requestedById" = booking_student AND requester_role = 'student')
        OR (NEW."requestedById" = booking_tutor AND requester_role = 'tutor')
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '23514',
            MESSAGE = 'Requester must be a student or tutor participant',
            CONSTRAINT = 'RescheduleRequest_requester_participant_check';
    END IF;

    IF NEW."reviewedById" IS NOT NULL THEN
        SELECT "role" INTO reviewer_role FROM "User" WHERE "id" = NEW."reviewedById";
        IF NEW."reviewedById" = NEW."requestedById" OR NOT (
            (NEW."reviewedById" = booking_student AND reviewer_role = 'student')
            OR (NEW."reviewedById" = booking_tutor AND reviewer_role = 'tutor')
        ) THEN
            RAISE EXCEPTION USING ERRCODE = '23514',
                MESSAGE = 'Reviewer must be the other booking participant',
                CONSTRAINT = 'RescheduleRequest_reviewer_counterparty_check';
        END IF;
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW."status" <> 'pending'
            OR booking_status <> 'confirmed'
            OR NEW."fromSlotId" <> booking_slot THEN
            RAISE EXCEPTION USING ERRCODE = '23514',
                MESSAGE = 'New request requires a confirmed booking and its current slot',
                CONSTRAINT = 'RescheduleRequest_initial_state_check';
        END IF;
        SELECT "tutorProfileId" INTO source_tutor FROM "AvailabilitySlot" WHERE "id" = NEW."fromSlotId";
        SELECT "tutorProfileId" INTO target_tutor FROM "AvailabilitySlot" WHERE "id" = NEW."requestedSlotId";
        IF source_tutor IS DISTINCT FROM booking_tutor
            OR target_tutor IS DISTINCT FROM booking_tutor THEN
            RAISE EXCEPTION USING ERRCODE = '23514',
                MESSAGE = 'Both slots must belong to the booking tutor',
                CONSTRAINT = 'RescheduleRequest_same_tutor_check';
        END IF;
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER "RescheduleRequest_validate"
BEFORE INSERT OR UPDATE ON "RescheduleRequest"
FOR EACH ROW EXECUTE FUNCTION "validate_reschedule_request"();

-- Application-owned JWTs do not authorize direct Supabase table access.
ALTER TABLE "RescheduleRequest" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "RescheduleRequest" FROM PUBLIC;
DO $$
DECLARE
    client_role TEXT;
BEGIN
    FOR client_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
        EXECUTE format('REVOKE ALL ON TABLE "RescheduleRequest" FROM %I', client_role);
    END LOOP;
END
$$;

COMMIT;
