-- Preserve prior uploads/reviews. Resolve existing duplicate pending types before deployment.
CREATE UNIQUE INDEX "TutorDocument_one_pending_type"
ON "TutorDocument" ("tutorUserId", "documentType")
WHERE "reviewStatus" = 'pending';

CREATE TYPE "TutorDocumentAuditAction" AS ENUM ('uploaded', 'signed_url_issued', 'reviewed');

CREATE TABLE "TutorDocumentAudit" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "actorUserId" UUID NOT NULL,
    "action" "TutorDocumentAuditAction" NOT NULL,
    "decision" "TutorDocumentReviewStatus",
    "reason" TEXT,
    "expiresAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TutorDocumentAudit_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TutorDocumentAudit_documentId_fkey" FOREIGN KEY ("documentId")
        REFERENCES "TutorDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TutorDocumentAudit_actorUserId_fkey" FOREIGN KEY ("actorUserId")
        REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TutorDocumentAudit_evidence_check" CHECK (
        ("action" = 'uploaded' AND "decision" IS NULL AND "reason" IS NULL AND "expiresAt" IS NULL)
        OR ("action" = 'signed_url_issued' AND "decision" IS NULL AND "reason" IS NULL AND "expiresAt" IS NOT NULL
            AND "expiresAt" > "createdAt" AND "expiresAt" <= "createdAt" + INTERVAL '5 minutes')
        OR ("action" = 'reviewed' AND "decision" IS NOT NULL AND "decision" IN ('verified', 'rejected')
            AND "expiresAt" IS NULL
            AND ("decision" <> 'rejected' OR "reason" IS NOT NULL))
    ),
    CONSTRAINT "TutorDocumentAudit_reason_check" CHECK (
        "reason" IS NULL OR ("reason" = BTRIM("reason") AND LENGTH("reason") BETWEEN 1 AND 500)
    )
);

CREATE INDEX "TutorDocumentAudit_documentId_createdAt_id_idx"
ON "TutorDocumentAudit" ("documentId", "createdAt", "id");

CREATE UNIQUE INDEX "TutorDocumentAudit_one_review"
ON "TutorDocumentAudit" ("documentId") WHERE "action" = 'reviewed';

CREATE FUNCTION "prevent_tutor_document_audit_mutation"()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION USING ERRCODE = '23514',
        MESSAGE = 'TutorDocumentAudit evidence is append-only';
END
$$;

CREATE TRIGGER "TutorDocumentAudit_append_only"
BEFORE UPDATE OR DELETE ON "TutorDocumentAudit"
FOR EACH ROW EXECUTE FUNCTION "prevent_tutor_document_audit_mutation"();
