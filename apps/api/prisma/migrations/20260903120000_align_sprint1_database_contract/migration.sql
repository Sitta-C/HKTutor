DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "User"
        WHERE "primaryEmail" IS NOT NULL
          AND "deletedAt" IS NULL
        GROUP BY "primaryEmail"
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23505',
            MESSAGE = 'Sprint 1 email uniqueness alignment rejected: duplicate non-deleted primaryEmail',
            CONSTRAINT = 'User_active_primaryEmail_key';
    END IF;
END
$$;

DROP INDEX "User_active_primaryEmail_key";

CREATE UNIQUE INDEX "User_active_primaryEmail_key" ON "User"("primaryEmail")
WHERE "primaryEmail" IS NOT NULL
  AND "deletedAt" IS NULL;

ALTER TABLE "User"
ADD CONSTRAINT "User_consent_policy_pair_check" CHECK (
    ("consentAcceptedAt" IS NULL AND "policyVersion" IS NULL)
    OR
    (
        "consentAcceptedAt" IS NOT NULL
        AND NULLIF(BTRIM("policyVersion"), '') IS NOT NULL
    )
);
