BEGIN;

LOCK TABLE "Booking", "AvailabilitySlot", "TeachingListing", "TutorProfile", "User"
IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
    user_count BIGINT;
    admin_count BIGINT;
    tutor_count BIGINT;
    profile_count BIGINT;
    listing_count BIGINT;
    known_synthetic_tutor_count BIGINT;
    invalid_synthetic_tutor_count BIGINT;
    invalid_profile_count BIGINT;
    known_listing_count BIGINT;
    invalid_listing_relation_count BIGINT;
BEGIN
    IF EXISTS (SELECT 1 FROM "User" WHERE "role" = 'student') THEN
        RAISE EXCEPTION 'S1-T07 Clerk migration rejected: student-user';
    END IF;
    IF EXISTS (
        SELECT 1 FROM "User"
        WHERE "accountStatus" <> 'active' OR "deletedAt" IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'S1-T07 Clerk migration rejected: account-state';
    END IF;
    IF EXISTS (
        SELECT 1 FROM "User"
        WHERE "consentAcceptedAt" IS NOT NULL OR "policyVersion" IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'S1-T07 Clerk migration rejected: consent-data';
    END IF;
    IF EXISTS (SELECT 1 FROM "Booking") THEN
        RAISE EXCEPTION 'S1-T07 Clerk migration rejected: booking-row';
    END IF;
    IF EXISTS (SELECT 1 FROM "AvailabilitySlot") THEN
        RAISE EXCEPTION 'S1-T07 Clerk migration rejected: availability-slot-row';
    END IF;

    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE "role" = 'admin'),
        COUNT(*) FILTER (WHERE "role" = 'tutor')
    INTO user_count, admin_count, tutor_count
    FROM "User";

    SELECT COUNT(*)
    INTO known_synthetic_tutor_count
    FROM "User"
    WHERE "role" = 'tutor'
      AND (
        ("id" = '20000000-0000-4000-8000-000000000001'::uuid AND "email" = 'mali@s1t20.hktutor.invalid') OR
        ("id" = '20000000-0000-4000-8000-000000000002'::uuid AND "email" = 'kiet@s1t20.hktutor.invalid') OR
        ("id" = '20000000-0000-4000-8000-000000000003'::uuid AND "email" = 'niran@s1t20.hktutor.invalid') OR
        ("id" = '20000000-0000-4000-8000-000000000004'::uuid AND "email" = 'pim@s1t20.hktutor.invalid')
      );

    SELECT COUNT(*)
    INTO invalid_synthetic_tutor_count
    FROM "User"
    WHERE (
        "id" IN (
          '20000000-0000-4000-8000-000000000001'::uuid,
          '20000000-0000-4000-8000-000000000002'::uuid,
          '20000000-0000-4000-8000-000000000003'::uuid,
          '20000000-0000-4000-8000-000000000004'::uuid
        )
        OR "email" IN (
          'mali@s1t20.hktutor.invalid',
          'kiet@s1t20.hktutor.invalid',
          'niran@s1t20.hktutor.invalid',
          'pim@s1t20.hktutor.invalid'
        )
      )
      AND NOT (
        "role" = 'tutor'
        AND (
          ("id" = '20000000-0000-4000-8000-000000000001'::uuid AND "email" = 'mali@s1t20.hktutor.invalid') OR
          ("id" = '20000000-0000-4000-8000-000000000002'::uuid AND "email" = 'kiet@s1t20.hktutor.invalid') OR
          ("id" = '20000000-0000-4000-8000-000000000003'::uuid AND "email" = 'niran@s1t20.hktutor.invalid') OR
          ("id" = '20000000-0000-4000-8000-000000000004'::uuid AND "email" = 'pim@s1t20.hktutor.invalid')
        )
      );

    SELECT COUNT(*)
    INTO profile_count
    FROM "TutorProfile";

    SELECT COUNT(*)
    INTO invalid_profile_count
    FROM "TutorProfile" AS profile
    LEFT JOIN "User" AS owner ON owner."id" = profile."userId"
    WHERE owner."id" IS NULL
       OR owner."role" <> 'tutor';

    SELECT COUNT(*)
    INTO listing_count
    FROM "TeachingListing";

    SELECT COUNT(*)
    INTO known_listing_count
    FROM "TeachingListing"
    WHERE "id" IN (
      '10000000-0000-4000-8000-000000000001'::uuid,
      '10000000-0000-4000-8000-000000000002'::uuid,
      '10000000-0000-4000-8000-000000000003'::uuid,
      '10000000-0000-4000-8000-000000000004'::uuid,
      '10000000-0000-4000-8000-000000000005'::uuid,
      '10000000-0000-4000-8000-000000000006'::uuid
    );

    SELECT COUNT(*)
    INTO invalid_listing_relation_count
    FROM "TeachingListing" AS listing
    LEFT JOIN "TutorProfile" AS profile ON profile."userId" = listing."tutorProfileId"
    LEFT JOIN "User" AS owner ON owner."id" = profile."userId"
    WHERE profile."userId" IS NULL
      OR owner."id" IS NULL
      OR owner."role" <> 'tutor'
      OR (listing."id" IN (
        '10000000-0000-4000-8000-000000000001'::uuid,
        '10000000-0000-4000-8000-000000000006'::uuid
      ) AND listing."tutorProfileId" IN (
        '20000000-0000-4000-8000-000000000001'::uuid,
        '20000000-0000-4000-8000-000000000002'::uuid,
        '20000000-0000-4000-8000-000000000003'::uuid,
        '20000000-0000-4000-8000-000000000004'::uuid
      ))
      OR (listing."id" = '10000000-0000-4000-8000-000000000002'::uuid AND listing."tutorProfileId" <> '20000000-0000-4000-8000-000000000001'::uuid)
      OR (listing."id" = '10000000-0000-4000-8000-000000000003'::uuid AND listing."tutorProfileId" <> '20000000-0000-4000-8000-000000000002'::uuid)
      OR (listing."id" = '10000000-0000-4000-8000-000000000004'::uuid AND listing."tutorProfileId" <> '20000000-0000-4000-8000-000000000003'::uuid)
      OR (listing."id" = '10000000-0000-4000-8000-000000000005'::uuid AND listing."tutorProfileId" <> '20000000-0000-4000-8000-000000000004'::uuid)
      OR (listing."id" = '10000000-0000-4000-8000-000000000006'::uuid
          AND listing."tutorProfileId" <> (
            SELECT "tutorProfileId"
            FROM "TeachingListing"
            WHERE "id" = '10000000-0000-4000-8000-000000000001'::uuid
          ));

    IF invalid_synthetic_tutor_count <> 0
       OR invalid_profile_count <> 0
       OR invalid_listing_relation_count <> 0 THEN
        RAISE EXCEPTION 'S1-T07 Clerk migration rejected: seed-shape';
    END IF;

    IF NOT (
      (user_count = 0 AND admin_count = 0 AND tutor_count = 0
        AND profile_count = 0 AND listing_count = 0
        AND known_synthetic_tutor_count = 0 AND known_listing_count = 0)
      OR
      (user_count = 2 AND admin_count = 1 AND tutor_count = 1
        AND profile_count = 1 AND listing_count = 0
        AND known_synthetic_tutor_count = 0 AND known_listing_count = 0)
      OR
      (user_count = 6 AND admin_count = 1 AND tutor_count = 5
        AND profile_count = 5 AND listing_count = 6
        AND known_synthetic_tutor_count = 4 AND known_listing_count = 6)
    ) THEN
        RAISE EXCEPTION 'S1-T07 Clerk migration rejected: seed-shape';
    END IF;
END
$$;

DELETE FROM "Booking";
DELETE FROM "AvailabilitySlot";
DELETE FROM "TeachingListing";
DELETE FROM "TutorProfile";
DELETE FROM "User";

DROP INDEX "User_email_key";
ALTER TABLE "User" RENAME COLUMN "email" TO "primaryEmail";
ALTER TABLE "User" ALTER COLUMN "primaryEmail" DROP NOT NULL;
ALTER TABLE "User" DROP COLUMN "passwordHash";
ALTER TABLE "User" ADD COLUMN "clerkUserId" TEXT NOT NULL;

CREATE UNIQUE INDEX "User_clerkUserId_key" ON "User"("clerkUserId");
CREATE UNIQUE INDEX "User_active_primaryEmail_key" ON "User"("primaryEmail")
WHERE "primaryEmail" IS NOT NULL
  AND "accountStatus" = 'active'
  AND "deletedAt" IS NULL;

CREATE TYPE "ClerkWebhookStatus" AS ENUM ('processed', 'failed');
CREATE TABLE "ClerkWebhookEvent" (
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "clerkUserId" TEXT NOT NULL,
    "status" "ClerkWebhookStatus" NOT NULL,
    "processedAt" TIMESTAMPTZ(3) NOT NULL,
    "payloadHash" TEXT,
    CONSTRAINT "ClerkWebhookEvent_pkey" PRIMARY KEY ("eventId")
);
CREATE INDEX "ClerkWebhookEvent_clerkUserId_idx"
ON "ClerkWebhookEvent"("clerkUserId");

COMMIT;
