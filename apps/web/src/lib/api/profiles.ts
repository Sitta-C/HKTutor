'use client';

import { authenticatedFetch } from '@/lib/api/client';
import { PRIVACY_POLICY_VERSION } from '@/lib/privacy-notice';

import type {
  MyProfileResponse,
  SaveStudentProfilePayload,
  SaveTutorProfilePayload,
  StudentProfile,
  TutorProfile,
} from '@/lib/api/types';

export function getMyProfile(): Promise<MyProfileResponse> {
  return authenticatedFetch('/profiles/me');
}

export function saveStudentProfile(payload: SaveStudentProfilePayload): Promise<StudentProfile> {
  return authenticatedFetch('/profiles/me/student', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function saveTutorProfile(payload: SaveTutorProfilePayload): Promise<TutorProfile> {
  return authenticatedFetch('/profiles/me/tutor', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function acceptCurrentPrivacyNotice(): Promise<{
  consentAcceptedAt: string;
  policyVersion: string;
}> {
  return authenticatedFetch('/auth/consent', {
    method: 'POST',
    body: JSON.stringify({ consent: true, policyVersion: PRIVACY_POLICY_VERSION }),
  });
}
