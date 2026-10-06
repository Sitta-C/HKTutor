BEGIN;

ALTER TABLE "User"
  ADD COLUMN "avatarObjectPath" TEXT,
  ADD COLUMN "avatarMimeType" TEXT,
  ADD COLUMN "avatarSizeBytes" INTEGER,
  ADD COLUMN "avatarUpdatedAt" TIMESTAMPTZ(3);

CREATE UNIQUE INDEX "User_avatarObjectPath_key" ON "User"("avatarObjectPath");

ALTER TABLE "User" ADD CONSTRAINT "User_avatar_metadata_check" CHECK (
  ("avatarObjectPath" IS NULL AND "avatarMimeType" IS NULL AND
   "avatarSizeBytes" IS NULL AND "avatarUpdatedAt" IS NULL)
  OR
  ("avatarObjectPath" IS NOT NULL AND "avatarMimeType" IS NOT NULL AND
   "avatarSizeBytes" IS NOT NULL AND "avatarUpdatedAt" IS NOT NULL AND
   "avatarMimeType" = 'image/webp' AND "avatarSizeBytes" BETWEEN 1 AND 2097152 AND
   "avatarObjectPath" ~ ('^' || "id"::text || '/[0-9a-f-]{36}\.webp$'))
);

CREATE TYPE "StorageObjectPurpose" AS ENUM ('AVATAR', 'QUALIFICATION_DOCUMENT');

-- Preserve all pending qualification cleanup work while converting its queue into the shared one.
ALTER TABLE "QualificationUploadIntent" RENAME TO "StorageCleanupIntent";
ALTER TABLE "StorageCleanupIntent"
  ADD COLUMN "purpose" "StorageObjectPurpose" NOT NULL DEFAULT 'QUALIFICATION_DOCUMENT';
ALTER TABLE "StorageCleanupIntent" ALTER COLUMN "purpose" DROP DEFAULT;

ALTER TABLE "StorageCleanupIntent"
  DROP CONSTRAINT "QualificationUploadIntent_pkey",
  DROP CONSTRAINT "QualificationUploadIntent_attempts_check",
  DROP CONSTRAINT "QualificationUploadIntent_path_check",
  ADD CONSTRAINT "StorageCleanupIntent_pkey" PRIMARY KEY ("purpose", "objectPath"),
  ADD CONSTRAINT "StorageCleanupIntent_attempts_check" CHECK ("attempts" >= 0),
  ADD CONSTRAINT "StorageCleanupIntent_path_check" CHECK (
    (
      "purpose" = 'AVATAR' AND
      "objectPath" ~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}/[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}\.webp$'
    )
    OR
    (
      "purpose" = 'QUALIFICATION_DOCUMENT' AND
      "objectPath" ~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}/[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}\.(pdf|jpg|png)$'
    )
  );

DROP INDEX "QualificationUploadIntent_nextAttemptAt_idx";
CREATE INDEX "StorageCleanupIntent_nextAttemptAt_purpose_idx"
  ON "StorageCleanupIntent" ("nextAttemptAt", "purpose");

COMMIT;
