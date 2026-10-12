BEGIN;

ALTER TABLE "TutorProfile"
  ALTER COLUMN "verificationStatus" SET DEFAULT 'unverified'::"TutorVerificationStatus";

-- Only pending profiles without submitted evidence are awaiting their first upload.
-- Preserve completed verification decisions, including provisioned/demo verified tutors.
UPDATE "TutorProfile" AS tutor
SET "verificationStatus" = 'unverified'::"TutorVerificationStatus",
    "updatedAt" = CURRENT_TIMESTAMP
WHERE tutor."verificationStatus" = 'pending'::"TutorVerificationStatus"
  AND NOT EXISTS (
    SELECT 1 FROM "TutorDocument" WHERE "tutorUserId" = tutor."userId"
  );

COMMIT;
