BEGIN;

-- Application JWT authorization lives in Nest. Supabase client roles must not access these tables.
ALTER TABLE "TutorDocument" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TutorDocumentAudit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "QualificationUploadIntent" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "TutorDocument", "TutorDocumentAudit", "QualificationUploadIntent" FROM PUBLIC;

-- Plain local PostgreSQL has no Supabase client roles; keep the same migrations portable.
DO $$
DECLARE
  client_role TEXT;
BEGIN
  FOR client_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') LOOP
    EXECUTE format(
      'REVOKE ALL ON TABLE "TutorDocument", "TutorDocumentAudit", "QualificationUploadIntent" FROM %I',
      client_role
    );
  END LOOP;
END $$;

COMMIT;
