BEGIN;

-- Normalized Prisma code lookups resolve text equality when extensions is outside search_path.
-- Keep the existing CITEXT unique key as the authority for coupon identity.
CREATE INDEX "Coupon_code_text_idx" ON "Coupon" (("code"::text));

-- Reminder scans span all tutors; the existing tutor-first slot index cannot bound this window.
CREATE INDEX "AvailabilitySlot_startAtUtc_id_idx" ON "AvailabilitySlot" ("startAtUtc", "id");

COMMIT;
