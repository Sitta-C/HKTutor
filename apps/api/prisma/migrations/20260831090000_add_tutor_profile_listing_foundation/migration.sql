CREATE TYPE "TutorVerificationStatus" AS ENUM ('pending', 'verified', 'rejected');

CREATE TYPE "ListingPublicationStatus" AS ENUM ('draft', 'published', 'archived');

CREATE TABLE "TutorProfile" (
    "userId" UUID NOT NULL,
    "displayName" TEXT NOT NULL,
    "bio" TEXT NOT NULL,
    "experienceYears" INTEGER NOT NULL,
    "verificationStatus" "TutorVerificationStatus" NOT NULL DEFAULT 'pending',
    "ratingAverage" DECIMAL(3,2),
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "ratingUpdatedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TutorProfile_pkey" PRIMARY KEY ("userId"),
    CONSTRAINT "TutorProfile_experienceYears_check" CHECK ("experienceYears" >= 0),
    CONSTRAINT "TutorProfile_ratingAverage_check" CHECK (
        "ratingAverage" IS NULL OR ("ratingAverage" >= 1 AND "ratingAverage" <= 5)
    ),
    CONSTRAINT "TutorProfile_reviewCount_check" CHECK ("reviewCount" >= 0)
);

CREATE TABLE "Subject" (
    "id" UUID NOT NULL,
    "code" extensions.CITEXT NOT NULL,
    "name" extensions.CITEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Subject_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GradeLevel" (
    "id" UUID NOT NULL,
    "code" extensions.CITEXT NOT NULL,
    "name" extensions.CITEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "GradeLevel_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "GradeLevel_sortOrder_check" CHECK ("sortOrder" >= 0)
);

CREATE TABLE "TeachingListing" (
    "id" UUID NOT NULL,
    "tutorProfileId" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "gradeLevelId" UUID NOT NULL,
    "pricePerHour" DECIMAL(10,2) NOT NULL,
    "description" TEXT NOT NULL,
    "publicationStatus" "ListingPublicationStatus" NOT NULL DEFAULT 'draft',
    "publishedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "TeachingListing_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TeachingListing_pricePerHour_check" CHECK ("pricePerHour" > 0),
    CONSTRAINT "TeachingListing_description_length_check" CHECK (
        char_length(btrim("description")) BETWEEN 20 AND 1000
    ),
    CONSTRAINT "TeachingListing_publishedAt_check" CHECK (
        "publicationStatus" <> 'published' OR "publishedAt" IS NOT NULL
    )
);

CREATE UNIQUE INDEX "Subject_code_key" ON "Subject"("code");
CREATE UNIQUE INDEX "Subject_name_key" ON "Subject"("name");
CREATE UNIQUE INDEX "GradeLevel_code_key" ON "GradeLevel"("code");
CREATE UNIQUE INDEX "GradeLevel_name_key" ON "GradeLevel"("name");
CREATE INDEX "TeachingListing_tutorProfileId_idx" ON "TeachingListing"("tutorProfileId");
CREATE INDEX "TeachingListing_search_idx" ON "TeachingListing"(
    "publicationStatus",
    "subjectId",
    "gradeLevelId",
    "pricePerHour"
);

ALTER TABLE "TutorProfile"
ADD CONSTRAINT "TutorProfile_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TeachingListing"
ADD CONSTRAINT "TeachingListing_tutorProfileId_fkey"
FOREIGN KEY ("tutorProfileId") REFERENCES "TutorProfile"("userId")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TeachingListing"
ADD CONSTRAINT "TeachingListing_subjectId_fkey"
FOREIGN KEY ("subjectId") REFERENCES "Subject"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TeachingListing"
ADD CONSTRAINT "TeachingListing_gradeLevelId_fkey"
FOREIGN KEY ("gradeLevelId") REFERENCES "GradeLevel"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
