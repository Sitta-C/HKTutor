'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';

import { loadAvatar } from '@/lib/avatar';
import { useCurrentProfile } from '@/lib/current-profile';

import type { Avatar } from '@/lib/api/types';

interface ProfileAvatarProps {
  name: string;
  fallback: string;
  className: string;
  sizes: string;
  avatarUpdatedAt?: string | null | undefined;
  ownerUserId?: string;
  publicTutorId?: string;
  imageUrl?: string | null | undefined;
}

export function ProfileAvatar({
  name,
  fallback,
  className,
  sizes,
  avatarUpdatedAt,
  ownerUserId,
  publicTutorId,
  imageUrl,
}: ProfileAvatarProps) {
  const key = avatarUpdatedAt
    ? `${publicTutorId ? 'public' : 'owner'}:${publicTutorId ?? ownerUserId}:${avatarUpdatedAt}`
    : null;
  const [result, setResult] = useState<{ key: string; avatar: Avatar | null } | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!key || imageUrl) {
      return;
    }
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      clearTimeout(timer);
      try {
        const avatar = await loadAvatar(key, publicTutorId);
        if (!active) {
          return;
        }
        setResult({ key, avatar });
        const delay = avatar
          ? Math.max(1000, Date.parse(avatar.expiresAt) - Date.now() - 20000)
          : 60000;
        timer = setTimeout(() => void refresh(), delay);
      } catch {
        if (active) {
          setResult({ key, avatar: null });
          timer = setTimeout(() => void refresh(), 60000);
        }
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void refresh();
      }
    };
    void refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [imageUrl, key, publicTutorId]);

  const avatar = result?.key === key ? result.avatar : null;
  const signedUrl = avatar?.url ?? null;
  const url = imageUrl || signedUrl;
  return (
    <span
      className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-full ${className}`}
      role="img"
      aria-label={name}
      data-profile-avatar=""
    >
      {url && failedUrl !== url ? (
        <Image
          src={url}
          alt=""
          fill
          sizes={sizes}
          className="object-cover"
          unoptimized
          onError={() => setFailedUrl(url)}
        />
      ) : (
        <span aria-hidden="true">{fallback}</span>
      )}
    </span>
  );
}

export function OwnProfileAvatar({
  userId,
  enabled = true,
  ...props
}: Omit<ProfileAvatarProps, 'ownerUserId' | 'publicTutorId' | 'avatarUpdatedAt'> & {
  userId: string;
  enabled?: boolean;
}) {
  const { profile } = useCurrentProfile(userId, enabled);
  return (
    <ProfileAvatar {...props} ownerUserId={userId} avatarUpdatedAt={profile?.avatarUpdatedAt} />
  );
}
