'use client';

import { apiFetch, authenticatedFetch } from '@/lib/api/client';
import { PRIVACY_POLICY_VERSION } from '@/lib/privacy-notice';

import type {
  AvatarMutationResponse,
  AvatarReadResponse,
  MyProfileResponse,
  SaveStudentProfilePayload,
  SaveTutorProfilePayload,
  StudentProfile,
  TutorProfile,
} from '@/lib/api/types';

export function getMyAvatar(): Promise<AvatarReadResponse> {
  return authenticatedFetch('/profiles/me/avatar');
}

export function getPublicTutorAvatar(tutorId: string): Promise<AvatarReadResponse> {
  return apiFetch(`/tutors/${encodeURIComponent(tutorId)}/avatar`);
}

export function uploadAvatar(file: File): Promise<AvatarMutationResponse> {
  const body = new FormData();
  body.append('file', file);
  return authenticatedFetch('/profiles/me/avatar', { method: 'POST', body });
}

export function deleteAvatar(): Promise<AvatarMutationResponse> {
  return authenticatedFetch('/profiles/me/avatar', { method: 'DELETE' });
}

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
