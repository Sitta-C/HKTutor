'use client';

import { getMyAvatar, getPublicTutorAvatar } from '@/lib/api/profiles';

import type { Avatar } from '@/lib/api/types';

const cache = new Map<string, { avatar: Avatar | null; request: Promise<Avatar | null> | null }>();
const EXPIRY_MARGIN_MS = 30_000;

export function clearAvatarCache(): void {
  cache.clear();
}

export async function loadAvatar(key: string, publicTutorId?: string): Promise<Avatar | null> {
  const existing = cache.get(key);
  if (existing?.avatar && Date.parse(existing.avatar.expiresAt) > Date.now() + EXPIRY_MARGIN_MS) {
    return existing.avatar;
  }
  if (existing?.request) {
    return existing.request;
  }
  if (cache.size >= 100) {
    cache.clear();
  }
  const entry: { avatar: Avatar | null; request: Promise<Avatar | null> | null } = {
    avatar: null,
    request: null,
  };
  cache.set(key, entry);
  entry.request = (publicTutorId ? getPublicTutorAvatar(publicTutorId) : getMyAvatar())
    .then(({ avatar }) => {
      entry.avatar = avatar;
      return avatar;
    })
    .finally(() => {
      entry.request = null;
    });
  return entry.request;
}

export function validateAvatarFile(file: Pick<File, 'size' | 'type'>): 'size' | 'type' | null {
  if (!file.size || file.size > 2 * 1024 * 1024) {
    return 'size';
  }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    return 'type';
  }
  return null;
}
