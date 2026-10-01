/**
 * Redirect decisions shared by the dashboard and the profile onboarding editor.
 *
 * These are pure functions so the decision logic can be unit-tested without a DOM:
 * the web test runner executes in a node environment and renders no React tree.
 */

import { ApiError } from '@/lib/api/error';

import type { AuthUser, MyProfileResponse, StudentProfile, TutorProfile } from '@/lib/api/types';

export const ONBOARDING_PROFILE_PATH = '/onboarding/profile';
export const DASHBOARD_PATH = '/dashboard';

export interface ProfileGateStatus {
  consentCurrent: boolean;
  profileComplete: boolean;
}

/** Admin accounts have no Student/Tutor private profile and use the auth identity directly. */
export function requiresPrivateProfile(role: 'STUDENT' | 'TUTOR' | 'ADMIN'): boolean {
  return role === 'STUDENT' || role === 'TUTOR';
}

/**
 * Guards the dashboard: an incomplete profile or a stale privacy notice must finish
 * onboarding first. Returns the target to redirect to, or null to stay on the dashboard.
 */
export function resolveDashboardGate(status: ProfileGateStatus): string | null {
  return status.consentCurrent && status.profileComplete ? null : ONBOARDING_PROFILE_PATH;
}

/**
 * Hand-off from onboarding: a complete profile leaves onboarding for the dashboard.
 * Returns the target to redirect to, or null to stay in the editor.
 */
export function resolveOnboardingHandoff(status: ProfileGateStatus): string | null {
  return status.profileComplete ? DASHBOARD_PATH : null;
}

export function getStudentProfile(result: MyProfileResponse): StudentProfile | null {
  return result.role === 'STUDENT' && result.profile && 'school' in result.profile
    ? result.profile
    : null;
}

export function getTutorProfile(result: MyProfileResponse): TutorProfile | null {
  return result.role === 'TUTOR' && result.profile && 'displayName' in result.profile
    ? result.profile
    : null;
}

export function getProfileDisplayName(result: MyProfileResponse): string | null {
  const displayName =
    getStudentProfile(result)?.nickname ?? getTutorProfile(result)?.displayName ?? '';
  return displayName.trim() || null;
}

export function applyProfileDisplayName(
  user: AuthUser,
  result: MyProfileResponse | null,
): AuthUser {
  const displayName = result ? getProfileDisplayName(result) : null;
  return displayName ? { ...user, displayName } : { ...user };
}

export function isProfileSetupError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 400;
}
