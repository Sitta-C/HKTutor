import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/api/error';
import {
  DASHBOARD_PATH,
  ONBOARDING_PROFILE_PATH,
  applyProfileDisplayName,
  getProfileDisplayName,
  getStudentProfile,
  getTutorProfile,
  isProfileSetupError,
  requiresPrivateProfile,
  resolveDashboardGate,
  resolveOnboardingHandoff,
} from '@/lib/profile-navigation';

import type { AuthUser, MyProfileResponse } from '@/lib/api/types';

const studentProfileResponse: MyProfileResponse = {
  role: 'STUDENT',
  consentCurrent: true,
  policyVersion: '2026-01',
  profileComplete: true,
  profile: {
    firstName: 'Mali',
    lastName: 'Sukjai',
    nickname: '  Mali  ',
    school: 'Bangkok School',
    gradeLevel: 'Grade 10',
    phone: '0812345678',
  },
};

const tutorProfileResponse: MyProfileResponse = {
  role: 'TUTOR',
  consentCurrent: true,
  policyVersion: '2026-01',
  profileComplete: true,
  profile: {
    firstName: 'Anan',
    lastName: 'Dee',
    nickname: 'Anan',
    displayName: '  Teacher Anan  ',
    bio: 'Patient mathematics tutor.',
    experienceYears: 5,
    verificationStatus: 'VERIFIED',
    ratingAverage: '4.80',
    reviewCount: 24,
  },
};

describe('dashboard gate', () => {
  it('loads private profiles for students and tutors but bypasses them for admins', () => {
    expect(requiresPrivateProfile('STUDENT')).toBe(true);
    expect(requiresPrivateProfile('TUTOR')).toBe(true);
    expect(requiresPrivateProfile('ADMIN')).toBe(false);
  });

  it('sends a student whose profile is incomplete to onboarding', () => {
    expect(resolveDashboardGate({ consentCurrent: true, profileComplete: false })).toBe(
      ONBOARDING_PROFILE_PATH,
    );
  });

  it('sends a student whose privacy notice is stale to onboarding', () => {
    expect(resolveDashboardGate({ consentCurrent: false, profileComplete: true })).toBe(
      ONBOARDING_PROFILE_PATH,
    );
  });

  it('keeps a complete and consented profile on the dashboard', () => {
    expect(resolveDashboardGate({ consentCurrent: true, profileComplete: true })).toBeNull();
  });
});

describe('onboarding hand-off', () => {
  it('leaves onboarding for the dashboard once the profile is complete', () => {
    expect(resolveOnboardingHandoff({ consentCurrent: true, profileComplete: true })).toBe(
      DASHBOARD_PATH,
    );
  });

  it('stays in the editor while the profile is incomplete', () => {
    expect(resolveOnboardingHandoff({ consentCurrent: true, profileComplete: false })).toBeNull();
  });
});

describe('profile session helpers', () => {
  it('narrows student and tutor profiles without repeating property checks', () => {
    expect(getStudentProfile(studentProfileResponse)?.nickname).toBe('  Mali  ');
    expect(getTutorProfile(studentProfileResponse)).toBeNull();
    expect(getTutorProfile(tutorProfileResponse)?.displayName).toBe('  Teacher Anan  ');
    expect(getStudentProfile(tutorProfileResponse)).toBeNull();
  });

  it('normalizes the profile display name and applies it without mutating the auth user', () => {
    const user: AuthUser = {
      id: 'student-1',
      email: 'student@example.test',
      role: 'STUDENT',
      displayName: 'Account name',
    };

    expect(getProfileDisplayName(studentProfileResponse)).toBe('Mali');
    expect(applyProfileDisplayName(user, studentProfileResponse)).toEqual({
      ...user,
      displayName: 'Mali',
    });
    expect(user.displayName).toBe('Account name');
  });

  it('keeps the auth display name when no private profile is available', () => {
    const user: AuthUser = {
      id: 'admin-1',
      email: 'admin@example.test',
      role: 'ADMIN',
      displayName: 'Admin',
    };
    expect(applyProfileDisplayName(user, null)).toEqual(user);
  });

  it('recognizes only the missing-profile API response as a setup error', () => {
    expect(isProfileSetupError(new ApiError('Missing profile', 400))).toBe(true);
    expect(isProfileSetupError(new ApiError('Unauthorized', 401))).toBe(false);
    expect(isProfileSetupError(new Error('Network error'))).toBe(false);
  });
});
