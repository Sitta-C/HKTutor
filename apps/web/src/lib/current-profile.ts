'use client';

import { useEffect, useMemo, useState } from 'react';

import { getMyProfile } from '@/lib/api/profiles';
import { clearAvatarCache } from '@/lib/avatar';

import type { MyProfileResponse } from '@/lib/api/types';

type CurrentProfileState =
  | { status: 'idle' | 'loading'; profile: null; error: null }
  | { status: 'success'; profile: MyProfileResponse; error: null }
  | { status: 'error'; profile: null; error: unknown };

interface ProfileCache {
  userId: string;
  profile: MyProfileResponse | null;
  request: Promise<MyProfileResponse> | null;
}

const idleState: CurrentProfileState = { status: 'idle', profile: null, error: null };
const loadingState: CurrentProfileState = { status: 'loading', profile: null, error: null };
let cache: ProfileCache | null = null;
const listeners = new Set<() => void>();

export function clearCurrentProfileCache(): void {
  cache = null;
  clearAvatarCache();
}

export function updateCurrentProfileAvatar(userId: string, avatarUpdatedAt: string | null): void {
  clearAvatarCache();
  if (cache?.userId === userId && cache.profile) {
    cache.profile = { ...cache.profile, avatarUpdatedAt };
    for (const listener of listeners) {
      listener();
    }
  }
}

export function loadCurrentProfile(
  userId: string,
  options: { force?: boolean } = {},
): Promise<MyProfileResponse> {
  if (options.force || cache?.userId !== userId) {
    cache = { userId, profile: null, request: null };
  }

  if (cache.profile) return Promise.resolve(cache.profile);
  if (cache.request) return cache.request;

  const activeCache = cache;
  activeCache.request = getMyProfile()
    .then((profile) => {
      if (cache === activeCache) activeCache.profile = profile;
      return profile;
    })
    .finally(() => {
      if (cache === activeCache) activeCache.request = null;
    });

  return activeCache.request;
}

export function useCurrentProfile(userId: string | null, enabled: boolean) {
  const [result, setResult] = useState<{
    userId: string;
    state: CurrentProfileState;
  } | null>(null);

  useEffect(() => {
    if (!enabled || !userId) return;

    let active = true;
    const syncAvatar = () => {
      if (active && cache?.userId === userId && cache.profile) {
        setResult({ userId, state: { status: 'success', profile: cache.profile, error: null } });
      }
    };
    listeners.add(syncAvatar);
    loadCurrentProfile(userId)
      .then((profile) => {
        if (active) {
          setResult({ userId, state: { status: 'success', profile, error: null } });
        }
      })
      .catch((error: unknown) => {
        if (active) setResult({ userId, state: { status: 'error', profile: null, error } });
      });

    return () => {
      active = false;
      listeners.delete(syncAvatar);
    };
  }, [enabled, userId]);

  return useMemo(() => {
    if (!enabled || !userId) return idleState;
    if (result?.userId === userId) return result.state;
    if (cache?.userId === userId && cache.profile) {
      return { status: 'success', profile: cache.profile, error: null };
    }
    return loadingState;
  }, [enabled, result, userId]);
}
