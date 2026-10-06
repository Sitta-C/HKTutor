BEGIN;

CREATE TABLE "QualificationUploadIntent" (
  "objectPath" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "QualificationUploadIntent_pkey" PRIMARY KEY ("objectPath"),
  CONSTRAINT "QualificationUploadIntent_attempts_check" CHECK ("attempts" >= 0),
  CONSTRAINT "QualificationUploadIntent_path_check" CHECK (
    "objectPath" ~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}/[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}\.(pdf|jpg|png)$'
  )
);
CREATE INDEX "QualificationUploadIntent_nextAttemptAt_idx"
  ON "QualificationUploadIntent" ("nextAttemptAt");

-- Reconcile derived profile state without changing immutable document reviews or audit evidence.
UPDATE "TutorProfile" AS tutor
SET "verificationStatus" = CASE
  WHEN EXISTS (
    SELECT 1 FROM "TutorDocument" WHERE "tutorUserId" = tutor."userId" AND "reviewStatus" = 'verified'
  ) THEN 'verified'::"TutorVerificationStatus"
  WHEN EXISTS (
    SELECT 1 FROM "TutorDocument" WHERE "tutorUserId" = tutor."userId" AND "reviewStatus" = 'pending'
  ) THEN 'pending'::"TutorVerificationStatus"
  ELSE 'rejected'::"TutorVerificationStatus"
END,
"updatedAt" = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "TutorDocument" WHERE "tutorUserId" = tutor."userId");

COMMIT;
