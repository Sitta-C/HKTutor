BEGIN;

LOCK TABLE "Booking", "AvailabilitySlot", "TeachingListing", "TutorProfile", "User"
IN ACCESS EXCLUSIVE MODE;

-- This project contains demonstration identities only. Rebuild the identity-owned
-- fixture graph in foreign-key order while preserving Subject and GradeLevel.
DELETE FROM "Booking";
DELETE FROM "AvailabilitySlot";
DELETE FROM "TeachingListing";
DELETE FROM "TutorProfile";
DELETE FROM "User";

DROP TABLE "ClerkWebhookEvent";
DROP TYPE "ClerkWebhookStatus";

DROP INDEX "User_clerkUserId_key";
DROP INDEX "User_active_primaryEmail_key";

ALTER TABLE "User" RENAME COLUMN "primaryEmail" TO "email";
ALTER TABLE "User" ALTER COLUMN "email" SET NOT NULL;
ALTER TABLE "User" DROP COLUMN "clerkUserId";
ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMPTZ(3);

CREATE UNIQUE INDEX "User_active_email_key" ON "User"("email")
WHERE "deletedAt" IS NULL;

CREATE TABLE "EmailVerificationToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "consumedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "EmailVerificationToken_userId_fkey" FOREIGN KEY ("userId")
      REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "EmailVerificationToken_tokenHash_key"
ON "EmailVerificationToken"("tokenHash");
CREATE INDEX "EmailVerificationToken_userId_expiresAt_idx"
ON "EmailVerificationToken"("userId", "expiresAt");

CREATE TABLE "AuthSession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "lastUsedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId")
      REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AuthSession_refreshTokenHash_key"
ON "AuthSession"("refreshTokenHash");
CREATE INDEX "AuthSession_userId_revokedAt_idx"
ON "AuthSession"("userId", "revokedAt");

COMMIT;
