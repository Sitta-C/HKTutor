CREATE TYPE "BookingStatus" AS ENUM ('pending', 'confirmed', 'completed', 'canceled');

CREATE TABLE "Booking" (
    "id" UUID NOT NULL,
    "studentUserId" UUID NOT NULL,
    "tutorProfileId" UUID NOT NULL,
    "listingId" UUID NOT NULL,
    "slotId" UUID NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'pending',
    "subtotalAmount" DECIMAL(10,2) NOT NULL,
    "discountAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(10,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'THB',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id"),
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
);

CREATE INDEX "Booking_studentUserId_status_createdAt_idx"
ON "Booking"("studentUserId", "status", "createdAt");

CREATE INDEX "Booking_tutorProfileId_status_createdAt_idx"
ON "Booking"("tutorProfileId", "status", "createdAt");

CREATE UNIQUE INDEX "Booking_active_slot_key"
ON "Booking"("slotId")
WHERE "status" IN ('pending', 'confirmed');

ALTER TABLE "Booking"
ADD CONSTRAINT "Booking_studentUserId_fkey"
FOREIGN KEY ("studentUserId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Booking"
ADD CONSTRAINT "Booking_tutorProfileId_fkey"
FOREIGN KEY ("tutorProfileId") REFERENCES "TutorProfile"("userId")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Booking"
ADD CONSTRAINT "Booking_listingId_fkey"
FOREIGN KEY ("listingId") REFERENCES "TeachingListing"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Booking"
ADD CONSTRAINT "Booking_slotId_fkey"
FOREIGN KEY ("slotId") REFERENCES "AvailabilitySlot"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "guard_active_booking_slot"()
RETURNS TRIGGER AS $$
DECLARE
    slot_deleted_at TIMESTAMPTZ;
BEGIN
    UPDATE "AvailabilitySlot"
    SET "id" = "id"
    WHERE "id" = NEW."slotId"
    RETURNING "deletedAt"
    INTO slot_deleted_at;

    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    IF slot_deleted_at IS NOT NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'Active booking requires a non-deleted availability slot',
            CONSTRAINT = 'Booking_active_slot_not_deleted_check';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Booking_active_slot_not_deleted_trg"
BEFORE INSERT OR UPDATE OF "slotId", "status" ON "Booking"
FOR EACH ROW
WHEN (NEW."status" IN ('pending', 'confirmed'))
EXECUTE FUNCTION "guard_active_booking_slot"();

CREATE FUNCTION "guard_availability_slot_active_booking_delete"()
RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "Booking"
        WHERE "slotId" = OLD."id"
          AND "status" IN ('pending', 'confirmed')
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'Availability slot has an active booking',
            CONSTRAINT = 'AvailabilitySlot_active_booking_delete_check';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AvailabilitySlot_active_booking_delete_trg"
BEFORE UPDATE OF "deletedAt" ON "AvailabilitySlot"
FOR EACH ROW
WHEN (OLD."deletedAt" IS NULL AND NEW."deletedAt" IS NOT NULL)
EXECUTE FUNCTION "guard_availability_slot_active_booking_delete"();
