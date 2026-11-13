import { beforeEach, describe, expect, it, vi } from 'vitest';

import { authenticatedFetch } from '@/lib/api/client';
import { getMyTutorReport } from '@/lib/api/reports';

vi.mock('@/lib/api/client', () => ({ authenticatedFetch: vi.fn() }));

describe('tutor report API', () => {
  beforeEach(() => vi.clearAllMocks());

  it('gets the current tutor report through the authenticated session flow', async () => {
    const controller = new AbortController();
    await getMyTutorReport(controller.signal);

    expect(authenticatedFetch).toHaveBeenCalledWith('/reports/tutor/me', {
      method: 'GET',
      signal: controller.signal,
    });
  });
});
