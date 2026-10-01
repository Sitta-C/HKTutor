'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo } from 'react';

import { useAuth } from '@/lib/auth-context';
import { clearCurrentProfileCache, useCurrentProfile } from '@/lib/current-profile';
import { useLanguage } from '@/lib/i18n';
import {
  ONBOARDING_PROFILE_PATH,
  applyProfileDisplayName,
  isProfileSetupError,
  requiresPrivateProfile,
  resolveDashboardGate,
} from '@/lib/profile-navigation';
import { withReturnTo } from '@/lib/return-to';

import type { AuthUser, UserRole } from '@/lib/api/types';

type ProfileMode = 'optional' | 'required';
type ProfileErrorMode = 'fallback' | 'report';

interface ProfileSessionOptions {
  allowGuest?: boolean;
  requiredRole?: UserRole;
  profileMode: ProfileMode;
  profileErrorMode?: ProfileErrorMode;
  preserveReturnTo?: boolean;
}

export function useProfileSession({
  allowGuest = false,
  requiredRole,
  profileMode,
  profileErrorMode = 'fallback',
  preserveReturnTo = false,
}: ProfileSessionOptions) {
  const { isLoading: authLoading, logout, user } = useAuth();
  const { copy } = useLanguage();
  const router = useRouter();
  const roleAccepted = !user || !requiredRole || user.role === requiredRole;
  const needsProfile = Boolean(
    !authLoading && user && roleAccepted && requiresPrivateProfile(user.role),
  );
  const currentProfile = useCurrentProfile(user?.id ?? null, needsProfile);
  const currentProfileError = currentProfile.error;
  const currentProfileResult = currentProfile.profile;
  const currentProfileStatus = currentProfile.status;

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      if (!allowGuest) router.replace('/');
      return;
    }
    if (requiredRole && user.role !== requiredRole) {
      router.replace('/dashboard');
      return;
    }

    if (!requiresPrivateProfile(user.role)) return;
    if (
      currentProfileStatus === 'success' &&
      profileMode === 'required' &&
      currentProfileResult &&
      resolveDashboardGate(currentProfileResult)
    ) {
      router.replace(onboardingPath(preserveReturnTo));
      return;
    }
    if (
      currentProfileStatus === 'error' &&
      profileMode === 'required' &&
      isProfileSetupError(currentProfileError)
    ) {
      router.replace(onboardingPath(preserveReturnTo));
    }
  }, [
    allowGuest,
    authLoading,
    preserveReturnTo,
    profileErrorMode,
    profileMode,
    requiredRole,
    router,
    user,
    currentProfileError,
    currentProfileResult,
    currentProfileStatus,
  ]);

  const profile = currentProfileStatus === 'success' ? currentProfileResult : null;
  const profileUser = useMemo<AuthUser | null>(
    () => (user ? applyProfileDisplayName(user, profile) : null),
    [profile, user],
  );
  const profileSettled = !needsProfile || ['success', 'error'].includes(currentProfileStatus);
  const isLoading = authLoading || (user ? !roleAccepted || !profileSettled : !allowGuest);
  const logoutWithProfileReset = useCallback(async () => {
    clearCurrentProfileCache();
    await logout();
  }, [logout]);

  return {
    isLoading,
    logout: logoutWithProfileReset,
    profile,
    profileError:
      currentProfileStatus === 'error' && profileErrorMode === 'report'
        ? copy.dashboard.common.loadProfileError
        : null,
    profileUser,
    user,
  };
}

function onboardingPath(preserveReturnTo: boolean): string {
  if (!preserveReturnTo || typeof window === 'undefined') return ONBOARDING_PROFILE_PATH;
  const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  return withReturnTo(ONBOARDING_PROFILE_PATH, currentPath);
}
