CREATE TABLE "PasswordResetToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "consumedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId")
      REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key"
ON "PasswordResetToken"("tokenHash");
CREATE INDEX "PasswordResetToken_userId_createdAt_idx"
ON "PasswordResetToken"("userId", "createdAt");
