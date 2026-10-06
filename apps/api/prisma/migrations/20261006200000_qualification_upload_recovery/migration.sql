BEGIN;

CREATE TYPE "StorageObjectPurpose" AS ENUM ('AVATAR', 'QUALIFICATION_DOCUMENT');

CREATE TABLE "StorageCleanupIntent" (
  "purpose" "StorageObjectPurpose" NOT NULL,
  "objectPath" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "StorageCleanupIntent_pkey" PRIMARY KEY ("purpose", "objectPath"),
  CONSTRAINT "StorageCleanupIntent_attempts_check" CHECK ("attempts" >= 0),
  CONSTRAINT "StorageCleanupIntent_path_check" CHECK (
    (
      "purpose" = 'AVATAR' AND
      "objectPath" ~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}/[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}\.webp$'
    )
    OR
    (
      "purpose" = 'QUALIFICATION_DOCUMENT' AND
      "objectPath" ~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}/[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}\.(pdf|jpg|png)$'
    )
  )
);
CREATE INDEX "StorageCleanupIntent_nextAttemptAt_purpose_idx"
  ON "StorageCleanupIntent" ("nextAttemptAt", "purpose");

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
