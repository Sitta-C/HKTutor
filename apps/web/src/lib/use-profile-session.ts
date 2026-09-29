'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { getMyProfile } from '@/lib/api/profiles';
import { useAuth } from '@/lib/auth-context';
import {
  ONBOARDING_PROFILE_PATH,
  applyProfileDisplayName,
  isProfileSetupError,
  requiresPrivateProfile,
  resolveDashboardGate,
} from '@/lib/profile-navigation';
import { withReturnTo } from '@/lib/return-to';

import type { AuthUser, MyProfileResponse, UserRole } from '@/lib/api/types';

type ProfileMode = 'optional' | 'required';
type ProfileErrorMode = 'fallback' | 'report';

interface ProfileSessionOptions {
  allowGuest?: boolean;
  requiredRole?: UserRole;
  profileMode: ProfileMode;
  profileErrorMode?: ProfileErrorMode;
  preserveReturnTo?: boolean;
}

interface ProfileLoadState {
  authUser: AuthUser | null;
  error: string | null;
  profile: MyProfileResponse | null;
  settled: boolean;
}

const initialProfileState: ProfileLoadState = {
  authUser: null,
  error: null,
  profile: null,
  settled: false,
};

export function useProfileSession({
  allowGuest = false,
  requiredRole,
  profileMode,
  profileErrorMode = 'fallback',
  preserveReturnTo = false,
}: ProfileSessionOptions) {
  const { isLoading: authLoading, logout, user } = useAuth();
  const router = useRouter();
  const [state, setState] = useState<ProfileLoadState>(initialProfileState);

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

    let active = true;
    getMyProfile()
      .then((profile) => {
        if (!active) return;
        if (profileMode === 'required' && resolveDashboardGate(profile)) {
          router.replace(onboardingPath(preserveReturnTo));
          return;
        }
        setState({ authUser: user, error: null, profile, settled: true });
      })
      .catch((caught: unknown) => {
        if (!active) return;
        if (profileMode === 'required' && isProfileSetupError(caught)) {
          router.replace(onboardingPath(preserveReturnTo));
          return;
        }
        setState({
          authUser: user,
          error:
            profileErrorMode === 'report'
              ? caught instanceof Error
                ? caught.message
                : 'Unable to load profile'
              : null,
          profile: null,
          settled: true,
        });
      });

    return () => {
      active = false;
    };
  }, [
    allowGuest,
    authLoading,
    preserveReturnTo,
    profileErrorMode,
    profileMode,
    requiredRole,
    router,
    user,
  ]);

  const currentState = user && state.authUser === user ? state : initialProfileState;
  const profileUser = useMemo<AuthUser | null>(
    () => (user ? applyProfileDisplayName(user, currentState.profile) : null),
    [currentState.profile, user],
  );
  const roleAccepted = !user || !requiredRole || user.role === requiredRole;
  const profileSettled = !user || !requiresPrivateProfile(user.role) || currentState.settled;
  const isLoading = authLoading || (user ? !roleAccepted || !profileSettled : !allowGuest);

  return {
    isLoading,
    logout,
    profile: currentState.profile,
    profileError: currentState.error,
    profileUser,
    user,
  };
}

function onboardingPath(preserveReturnTo: boolean): string {
  if (!preserveReturnTo || typeof window === 'undefined') return ONBOARDING_PROFILE_PATH;
  const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  return withReturnTo(ONBOARDING_PROFILE_PATH, currentPath);
}
