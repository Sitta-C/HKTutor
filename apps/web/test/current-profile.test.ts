import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getMyProfile } from '@/lib/api/profiles';
import { clearCurrentProfileCache, loadCurrentProfile } from '@/lib/current-profile';

import type { MyProfileResponse } from '@/lib/api/types';

vi.mock('@/lib/api/profiles', () => ({
  getMyProfile: vi.fn(),
}));

const profile: MyProfileResponse = {
  consentCurrent: true,
  policyVersion: '2026-09',
  profile: {
    firstName: 'Mali',
    gradeLevel: 'Grade 10',
    lastName: 'Dee',
    nickname: 'Mali',
    phone: '0812345678',
    school: 'Demo School',
  },
  profileComplete: true,
  role: 'STUDENT',
};

describe('current profile cache', () => {
  beforeEach(() => {
    clearCurrentProfileCache();
    vi.mocked(getMyProfile).mockReset().mockResolvedValue(profile);
  });

  it('deduplicates concurrent and repeated loads for the same signed-in user', async () => {
    const first = loadCurrentProfile('student-1');
    const second = loadCurrentProfile('student-1');

    await expect(first).resolves.toBe(profile);
    await expect(second).resolves.toBe(profile);
    await expect(loadCurrentProfile('student-1')).resolves.toBe(profile);
    expect(getMyProfile).toHaveBeenCalledOnce();
  });

  it('reloads after invalidation, an explicit refresh, or a user change', async () => {
    await loadCurrentProfile('student-1');
    await loadCurrentProfile('student-1', { force: true });
    await loadCurrentProfile('student-2');
    clearCurrentProfileCache();
    await loadCurrentProfile('student-2');

    expect(getMyProfile).toHaveBeenCalledTimes(4);
  });
});
