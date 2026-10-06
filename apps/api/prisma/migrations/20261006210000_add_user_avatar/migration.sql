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

COMMIT;
