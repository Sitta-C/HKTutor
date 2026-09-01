INSERT INTO "User" (
  "id", "email", "passwordHash", "role", "accountStatus", "createdAt", "updatedAt"
) VALUES
  ('30000000-0000-4000-8000-000000000001', 'admin@legacy-seed.test', 'legacy-seed-hash', 'admin', 'active', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z'),
  ('30000000-0000-4000-8000-000000000002', 'tutor@legacy-seed.test', 'legacy-seed-hash', 'tutor', 'active', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');

INSERT INTO "TutorProfile" (
  "userId", "displayName", "bio", "experienceYears", "verificationStatus",
  "reviewCount", "createdAt", "updatedAt"
) VALUES (
  '30000000-0000-4000-8000-000000000002', 'Anan',
  'Verified tutor seeded for disposable migration testing.', 5, 'verified', 0,
  '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z'
);

INSERT INTO "Subject" ("id", "code", "name", "active", "createdAt", "updatedAt")
VALUES ('40000000-0000-4000-8000-000000000001', 'mathematics', 'Mathematics', true, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');

INSERT INTO "GradeLevel" ("id", "code", "name", "sortOrder", "active", "createdAt", "updatedAt")
VALUES ('50000000-0000-4000-8000-000000000001', 'grade-10', 'Grade 10', 10, true, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');
