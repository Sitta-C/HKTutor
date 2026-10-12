-- Commit the enum addition before the following migration uses it in defaults and updates.
ALTER TYPE "TutorVerificationStatus" ADD VALUE 'unverified' BEFORE 'pending';
