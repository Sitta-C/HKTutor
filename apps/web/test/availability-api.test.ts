import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTutorAvailability } from '@/lib/api/availability';
import { clearAccessToken } from '@/lib/api/client';

describe('private availability API query', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    clearAccessToken();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(
      new Response('[]', { headers: { 'content-type': 'application/json' } }),
    );
  });

  afterEach(() => {
    clearAccessToken();
    vi.unstubAllGlobals();
  });

  it('serializes bounded overlap queries through the authenticated private endpoint', async () => {
    await expect(
      getTutorAvailability({
        from: new Date('2026-10-04T17:00:00.000Z'),
        to: '2026-10-11T17:00:00.000Z',
        rangeMode: 'overlap',
      }),
    ).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/tutors/me/availability?from=2026-10-04T17%3A00%3A00.000Z&to=2026-10-11T17%3A00%3A00.000Z&rangeMode=overlap',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('preserves the legacy query when overlap mode is omitted', async () => {
    await getTutorAvailability({ from: '2026-10-04T17:00:00.000Z' });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/v1/tutors/me/availability?from=2026-10-04T17%3A00%3A00.000Z',
    );
  });
});
