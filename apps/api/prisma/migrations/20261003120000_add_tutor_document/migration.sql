CREATE TYPE "TutorDocumentReviewStatus" AS ENUM ('pending', 'verified', 'rejected');

CREATE TABLE "TutorDocument" (
    "id" UUID NOT NULL,
    "tutorUserId" UUID NOT NULL,
    "documentType" TEXT NOT NULL,
    "objectPath" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "reviewStatus" "TutorDocumentReviewStatus" NOT NULL DEFAULT 'pending',
    "reviewerUserId" UUID,
    "reviewedAt" TIMESTAMPTZ(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TutorDocument_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TutorDocument_size_bytes_check" CHECK (
        "sizeBytes" > 0 AND "sizeBytes" <= 5242880
    ),
    CONSTRAINT "TutorDocument_text_metadata_check" CHECK (
        "documentType" = BTRIM("documentType")
        AND "documentType" <> ''
        AND "originalName" = BTRIM("originalName")
        AND "originalName" <> ''
        AND POSITION('/' IN "originalName") = 0
        AND POSITION(CHR(92) IN "originalName") = 0
    ),
    CONSTRAINT "TutorDocument_mime_type_check" CHECK (
        "mimeType" IN ('application/pdf', 'image/jpeg', 'image/png')
    ),
    CONSTRAINT "TutorDocument_private_object_path_check" CHECK (
        "objectPath" = BTRIM("objectPath")
        AND "objectPath" ~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$'
        AND RIGHT("objectPath", 1) <> '/'
        AND POSITION('//' IN "objectPath") = 0
        AND POSITION('/./' IN '/' || "objectPath" || '/') = 0
        AND POSITION('/../' IN '/' || "objectPath" || '/') = 0
        AND "objectPath" !~* '^[a-z][a-z0-9+.-]*://'
        AND "objectPath" !~ '[?#]'
    ),
    CONSTRAINT "TutorDocument_review_fields_check" CHECK (
        (
            "reviewStatus" = 'pending'
            AND "reviewerUserId" IS NULL
            AND "reviewedAt" IS NULL
            AND "rejectionReason" IS NULL
        )
        OR
        (
            "reviewStatus" = 'verified'
            AND "reviewerUserId" IS NOT NULL
            AND "reviewedAt" IS NOT NULL
            AND "rejectionReason" IS NULL
        )
        OR
        (
            "reviewStatus" = 'rejected'
            AND "reviewerUserId" IS NOT NULL
            AND "reviewedAt" IS NOT NULL
            AND "rejectionReason" IS NOT NULL
            AND "rejectionReason" = BTRIM("rejectionReason")
            AND "rejectionReason" <> ''
        )
    )
);

ALTER TABLE "TutorDocument"
ADD CONSTRAINT "TutorDocument_tutorUserId_fkey"
FOREIGN KEY ("tutorUserId") REFERENCES "TutorProfile"("userId")
ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "TutorDocument_reviewerUserId_fkey"
FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "TutorDocument_objectPath_key"
ON "TutorDocument"("objectPath");

CREATE INDEX "TutorDocument_tutorUserId_reviewStatus_createdAt_idx"
ON "TutorDocument"("tutorUserId", "reviewStatus", "createdAt");

CREATE INDEX "TutorDocument_reviewStatus_createdAt_idx"
ON "TutorDocument"("reviewStatus", "createdAt");

CREATE FUNCTION "validate_tutor_document_write"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    tutor_role "Role";
    reviewer_role "Role";
BEGIN
    SELECT "role"
    INTO tutor_role
    FROM "User"
    WHERE "id" = NEW."tutorUserId";

    IF tutor_role IS DISTINCT FROM 'tutor' THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'TutorDocument tutorUserId must belong to a tutor',
            CONSTRAINT = 'TutorDocument_tutor_role_check';
    END IF;

    IF NEW."reviewerUserId" IS NOT NULL THEN
        SELECT "role"
        INTO reviewer_role
        FROM "User"
        WHERE "id" = NEW."reviewerUserId";

        IF reviewer_role IS DISTINCT FROM 'admin' THEN
            RAISE EXCEPTION USING
                ERRCODE = '23514',
                MESSAGE = 'TutorDocument reviewerUserId must belong to an admin',
                CONSTRAINT = 'TutorDocument_reviewer_role_check';
        END IF;
    END IF;

    IF TG_OP = 'INSERT' AND NEW."reviewStatus" <> 'pending' THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'TutorDocument must be created in pending review status',
            CONSTRAINT = 'TutorDocument_initial_review_status_check';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF NEW."tutorUserId" IS DISTINCT FROM OLD."tutorUserId"
            OR NEW."documentType" IS DISTINCT FROM OLD."documentType"
            OR NEW."objectPath" IS DISTINCT FROM OLD."objectPath"
            OR NEW."originalName" IS DISTINCT FROM OLD."originalName"
            OR NEW."mimeType" IS DISTINCT FROM OLD."mimeType"
            OR NEW."sizeBytes" IS DISTINCT FROM OLD."sizeBytes" THEN
            RAISE EXCEPTION USING
                ERRCODE = '23514',
                MESSAGE = 'TutorDocument upload metadata is immutable',
                CONSTRAINT = 'TutorDocument_upload_metadata_immutable_check';
        END IF;

        IF NEW."reviewStatus" IS DISTINCT FROM OLD."reviewStatus"
            AND NOT (
                OLD."reviewStatus" = 'pending'
                AND NEW."reviewStatus" IN ('verified', 'rejected')
            ) THEN
            RAISE EXCEPTION USING
                ERRCODE = '23514',
                MESSAGE = 'TutorDocument review status transition is not allowed',
                CONSTRAINT = 'TutorDocument_review_transition_check';
        END IF;

        IF OLD."reviewStatus" <> 'pending'
            AND (
                NEW."reviewStatus" IS DISTINCT FROM OLD."reviewStatus"
                OR NEW."reviewerUserId" IS DISTINCT FROM OLD."reviewerUserId"
                OR NEW."reviewedAt" IS DISTINCT FROM OLD."reviewedAt"
                OR NEW."rejectionReason" IS DISTINCT FROM OLD."rejectionReason"
            ) THEN
            RAISE EXCEPTION USING
                ERRCODE = '23514',
                MESSAGE = 'TutorDocument completed review metadata is immutable',
                CONSTRAINT = 'TutorDocument_review_audit_immutable_check';
        END IF;
    END IF;

    RETURN NEW;
END
$$;

CREATE TRIGGER "TutorDocument_validate_write"
BEFORE INSERT OR UPDATE ON "TutorDocument"
FOR EACH ROW
EXECUTE FUNCTION "validate_tutor_document_write"();
