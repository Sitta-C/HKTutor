CREATE TABLE "AvailabilitySlot" (
    "id" UUID NOT NULL,
    "tutorProfileId" UUID NOT NULL,
    "startAtUtc" TIMESTAMPTZ(3) NOT NULL,
    "endAtUtc" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "AvailabilitySlot_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AvailabilitySlot_time_order_check" CHECK ("startAtUtc" < "endAtUtc"),
    CONSTRAINT "AvailabilitySlot_no_overlap_excl" EXCLUDE USING GIST (
        "tutorProfileId" extensions.gist_uuid_ops WITH =,
        tstzrange("startAtUtc", "endAtUtc", '[)') WITH &&
    ) WHERE ("deletedAt" IS NULL)
);

CREATE INDEX "AvailabilitySlot_tutorProfileId_startAtUtc_idx"
ON "AvailabilitySlot"("tutorProfileId", "startAtUtc");

ALTER TABLE "AvailabilitySlot"
ADD CONSTRAINT "AvailabilitySlot_tutorProfileId_fkey"
FOREIGN KEY ("tutorProfileId") REFERENCES "TutorProfile"("userId")
ON DELETE RESTRICT ON UPDATE CASCADE;
