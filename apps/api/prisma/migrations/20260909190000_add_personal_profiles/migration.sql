BEGIN;

CREATE TABLE "StudentProfile" (
    "userId" UUID NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "school" TEXT NOT NULL,
    "gradeLevel" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "StudentProfile_pkey" PRIMARY KEY ("userId"),
    CONSTRAINT "StudentProfile_names_nonempty_check" CHECK (
      char_length(btrim("firstName")) BETWEEN 1 AND 100
      AND char_length(btrim("lastName")) BETWEEN 1 AND 100
      AND char_length(btrim("nickname")) BETWEEN 1 AND 60
    ),
    CONSTRAINT "StudentProfile_education_nonempty_check" CHECK (
      char_length(btrim("school")) BETWEEN 1 AND 160
      AND char_length(btrim("gradeLevel")) BETWEEN 1 AND 80
    ),
    CONSTRAINT "StudentProfile_phone_length_check" CHECK (
      char_length(btrim("phone")) BETWEEN 8 AND 32
    )
);

ALTER TABLE "StudentProfile"
ADD CONSTRAINT "StudentProfile_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TutorProfile"
ADD COLUMN "firstName" TEXT,
ADD COLUMN "lastName" TEXT,
ADD COLUMN "nickname" TEXT;

ALTER TABLE "TutorProfile"
ADD CONSTRAINT "TutorProfile_personal_names_check" CHECK (
  ("firstName" IS NULL OR char_length(btrim("firstName")) BETWEEN 1 AND 100)
  AND ("lastName" IS NULL OR char_length(btrim("lastName")) BETWEEN 1 AND 100)
  AND ("nickname" IS NULL OR char_length(btrim("nickname")) BETWEEN 1 AND 60)
);

COMMIT;
