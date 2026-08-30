CREATE TYPE "Role" AS ENUM ('student', 'tutor', 'admin');

CREATE TYPE "AccountStatus" AS ENUM ('active', 'suspended', 'deleted');

CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" extensions.CITEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "accountStatus" "AccountStatus" NOT NULL DEFAULT 'active',
    "consentAcceptedAt" TIMESTAMPTZ(3),
    "policyVersion" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
