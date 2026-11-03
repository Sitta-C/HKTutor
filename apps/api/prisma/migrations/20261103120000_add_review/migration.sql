BEGIN;

CREATE TABLE "Review" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "authorStudentUserId" UUID NOT NULL,
    "tutorProfileId" UUID NOT NULL,
    "bookingStatus" "BookingStatus" NOT NULL DEFAULT 'completed',
    "clarity" INTEGER NOT NULL,
    "punctuality" INTEGER NOT NULL,
    "preparation" INTEGER NOT NULL,
    "feedback" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Review_completed_booking_check" CHECK ("bookingStatus" = 'completed'),
    CONSTRAINT "Review_clarity_check" CHECK ("clarity" BETWEEN 1 AND 5),
    CONSTRAINT "Review_punctuality_check" CHECK ("punctuality" BETWEEN 1 AND 5),
    CONSTRAINT "Review_preparation_check" CHECK ("preparation" BETWEEN 1 AND 5),
    -- The trim set matches ECMAScript String.trim(), including NBSP and BOM.
    -- CHAR_LENGTH counts Unicode code points, not JavaScript UTF-16 code units.
    CONSTRAINT "Review_feedback_check" CHECK (
        "feedback" = BTRIM("feedback", U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
        AND CHAR_LENGTH("feedback") BETWEEN 1 AND 1000
    )
);

-- The constant status and matching identities are enforced together by a native FK.
-- Native referential locks also protect reverse Booking changes at every isolation level.
CREATE UNIQUE INDEX "Booking_review_identity_key"
ON "Booking"("id", "studentUserId", "tutorProfileId", "status");

CREATE UNIQUE INDEX "Review_bookingId_key" ON "Review"("bookingId");
-- Prisma requires the full relation tuple to be declared unique for a 1:1 relation.
CREATE UNIQUE INDEX "Review_booking_identity_key"
ON "Review"("bookingId", "authorStudentUserId", "tutorProfileId", "bookingStatus");
CREATE INDEX "Review_tutorProfileId_createdAt_id_idx"
ON "Review"("tutorProfileId", "createdAt" DESC, "id" DESC);
CREATE INDEX "Review_authorStudentUserId_idx" ON "Review"("authorStudentUserId");

ALTER TABLE "Review"
ADD CONSTRAINT "Review_booking_evidence_fkey"
FOREIGN KEY ("bookingId", "authorStudentUserId", "tutorProfileId", "bookingStatus")
REFERENCES "Booking"("id", "studentUserId", "tutorProfileId", "status")
ON DELETE RESTRICT ON UPDATE RESTRICT,
ADD CONSTRAINT "Review_authorStudentUserId_fkey"
FOREIGN KEY ("authorStudentUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "Review_tutorProfileId_fkey"
FOREIGN KEY ("tutorProfileId") REFERENCES "TutorProfile"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- No historical Review rows are invented. All existing tutors have no Review yet.
UPDATE "TutorProfile" SET "ratingAverage" = NULL, "reviewCount" = 0, "ratingUpdatedAt" = NULL
WHERE NOT EXISTS (SELECT 1 FROM "Review" WHERE "tutorProfileId" = "TutorProfile"."userId");

-- Access goes through authenticated API authorization, never Supabase browser roles.
ALTER TABLE "Review" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "Review" FROM PUBLIC;
DO $$
DECLARE
    client_role TEXT;
BEGIN
    FOR client_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
        EXECUTE format('REVOKE ALL ON TABLE "Review" FROM %I', client_role);
    END LOOP;
END
$$;

COMMIT;
