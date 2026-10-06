import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getMyAvatar, getPublicTutorAvatar } from '@/lib/api/profiles';
import { clearAvatarCache, loadAvatar, validateAvatarFile } from '@/lib/avatar';

vi.mock('@/lib/api/profiles', () => ({ getMyAvatar: vi.fn(), getPublicTutorAvatar: vi.fn() }));

describe('avatar display and file validation', () => {
  beforeEach(() => {
    clearAvatarCache();
    vi.resetAllMocks();
  });

  it('accepts supported files at the inclusive size limit', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
      expect(validateAvatarFile({ type, size: 2097152 })).toBeNull();
    }
    expect(validateAvatarFile({ type: 'image/png', size: 0 })).toBe('size');
    expect(validateAvatarFile({ type: 'image/png', size: 2097153 })).toBe('size');
    expect(validateAvatarFile({ type: 'image/svg+xml', size: 50 })).toBe('type');
  });

  it('deduplicates URL requests across sidebar and previews', async () => {
    const avatar = {
      url: 'https://storage.example.test/photo',
      expiresAt: new Date(Date.now() + 300000).toISOString(),
      updatedAt: 'version1',
    };
    vi.mocked(getMyAvatar).mockResolvedValue({ avatar });
    const [first, second] = await Promise.all([
      loadAvatar('owner:student:version1'),
      loadAvatar('owner:student:version1'),
    ]);
    expect(first).toEqual(avatar);
    expect(second).toEqual(avatar);
    await loadAvatar('owner:student:version1');
    expect(getMyAvatar).toHaveBeenCalledOnce();
  });

  it('renews expiring URLs and uses the public tutor endpoint for public images', async () => {
    vi.mocked(getPublicTutorAvatar).mockResolvedValue({
      avatar: {
        url: 'https://storage.example.test/photo',
        expiresAt: new Date(Date.now() + 10000).toISOString(),
        updatedAt: 'version1',
      },
    });
    await loadAvatar('public:tutor:version1', 'tutor');
    await loadAvatar('public:tutor:version1', 'tutor');
    expect(getPublicTutorAvatar).toHaveBeenCalledTimes(2);
    expect(getPublicTutorAvatar).toHaveBeenCalledWith('tutor');
    expect(getMyAvatar).not.toHaveBeenCalled();
  });

  it('retries failed requests and clears signed URLs on account reset', async () => {
    vi.mocked(getMyAvatar)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ avatar: null });
    await expect(loadAvatar('owner:student:version1')).rejects.toThrow('offline');
    await expect(loadAvatar('owner:student:version1')).resolves.toBeNull();
    clearAvatarCache();
    await loadAvatar('owner:student:version1');
    expect(getMyAvatar).toHaveBeenCalledTimes(3);
  });
});
