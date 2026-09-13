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

INSERT INTO "User" (
  "id", "email", "passwordHash", "role", "accountStatus", "createdAt", "updatedAt"
) VALUES
  ('20000000-0000-4000-8000-000000000001', 'mali@s1t20.hktutor.invalid', 'legacy-seed-hash', 'tutor', 'active', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z'),
  ('20000000-0000-4000-8000-000000000002', 'kiet@s1t20.hktutor.invalid', 'legacy-seed-hash', 'tutor', 'active', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z'),
  ('20000000-0000-4000-8000-000000000003', 'niran@s1t20.hktutor.invalid', 'legacy-seed-hash', 'tutor', 'active', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z'),
  ('20000000-0000-4000-8000-000000000004', 'pim@s1t20.hktutor.invalid', 'legacy-seed-hash', 'tutor', 'active', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');

INSERT INTO "TutorProfile" (
  "userId", "displayName", "bio", "experienceYears", "verificationStatus",
  "ratingAverage", "reviewCount", "ratingUpdatedAt", "createdAt", "updatedAt"
) VALUES
  ('20000000-0000-4000-8000-000000000001', 'Mali', 'Mathematics tutor fixture for lowest-price search cases.', 4, 'verified', 4.40, 18, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z'),
  ('20000000-0000-4000-8000-000000000002', 'Kiet', 'Mathematics tutor fixture for inclusive budget boundary cases.', 3, 'verified', 4.00, 10, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z'),
  ('20000000-0000-4000-8000-000000000003', 'Niran', 'Physics tutor fixture for subject mismatch search cases.', 6, 'verified', 4.70, 12, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z'),
  ('20000000-0000-4000-8000-000000000004', 'Pim', 'Grade 11 mathematics tutor fixture for grade mismatch cases.', 5, 'verified', 4.60, 15, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');

UPDATE "TutorProfile"
SET "ratingAverage" = 4.80, "reviewCount" = 24, "ratingUpdatedAt" = '2026-09-01T00:00:00Z'
WHERE "userId" = '30000000-0000-4000-8000-000000000002';

INSERT INTO "Subject" ("id", "code", "name", "active", "createdAt", "updatedAt")
VALUES ('40000000-0000-4000-8000-000000000002', 'physics', 'Physics', true, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');

INSERT INTO "GradeLevel" ("id", "code", "name", "sortOrder", "active", "createdAt", "updatedAt")
VALUES ('50000000-0000-4000-8000-000000000002', 'grade-11', 'Grade 11', 11, true, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');

INSERT INTO "TeachingListing" (
  "id", "tutorProfileId", "subjectId", "gradeLevelId", "pricePerHour", "description",
  "publicationStatus", "publishedAt", "createdAt", "updatedAt"
) VALUES
  ('10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 400, 'Published Mathematics Grade 10 listing for exact-match search cases.', 'published', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z'),
  ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 350, 'Published Mathematics Grade 10 listing for lowest-price cases.', 'published', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z'),
  ('10000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 500, 'Published Mathematics Grade 10 listing at the inclusive budget boundary.', 'published', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z'),
  ('10000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000001', 400, 'Published Physics Grade 10 listing for subject mismatch cases.', 'published', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z'),
  ('10000000-0000-4000-8000-000000000005', '20000000-0000-4000-8000-000000000004', '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000002', 450, 'Published Mathematics Grade 11 listing for grade mismatch cases.', 'published', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z'),
  ('10000000-0000-4000-8000-000000000006', '30000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 300, 'Draft Mathematics Grade 10 listing that must stay out of public search.', 'draft', NULL, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z');
