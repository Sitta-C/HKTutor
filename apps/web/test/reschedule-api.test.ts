import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearAccessToken, setAccessToken } from '@/lib/api/client';
import {
  approveRescheduleRequest,
  createRescheduleRequest,
  getCurrentRescheduleRequest,
  rejectRescheduleRequest,
  withdrawRescheduleRequest,
} from '@/lib/api/reschedule-requests';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('reschedule API clients', () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    fetchMock.mockReset();
    setAccessToken('test-access');
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    clearAccessToken();
    vi.unstubAllGlobals();
  });
  it('keeps the existing pending-only current contract after a request has closed', async () => {
    const current = { request: null, targetSlot: null, allowedActions: ['CREATE'] };
    fetchMock.mockResolvedValue(response(current));
    await expect(getCurrentRescheduleRequest('booking')).resolves.toEqual(current);
  });
  it('uses authenticated encoded participant paths and sends only the create DTO', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(response({})));
    await getCurrentRescheduleRequest('booking/1');
    await createRescheduleRequest('booking/1', { targetSlotId: 'target', reason: '  Exam  ' });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/v1/bookings/booking%2F1/reschedule-requests/current',
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/v1/bookings/booking%2F1/reschedule-requests');
    const init = fetchMock.mock.calls[1]?.[1];
    expect(init?.credentials).toBe('include');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-access');
    expect(init?.body).toBe(JSON.stringify({ targetSlotId: 'target', reason: 'Exam' }));
    await createRescheduleRequest('booking', { targetSlotId: 'target', reason: '   ' });
    expect(fetchMock.mock.calls[2]?.[1]?.body).toBe(JSON.stringify({ targetSlotId: 'target' }));
  });
  it.each([
    ['approve', approveRescheduleRequest],
    ['reject', rejectRescheduleRequest],
    ['withdraw', withdrawRescheduleRequest],
  ] as const)('posts %s using only the request identity', async (action, act) => {
    fetchMock.mockResolvedValue(response({ requestId: 'request/1' }));
    await act('request/1');
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`/api/v1/reschedule-requests/request%2F1/${action}`);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('POST');
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(action === 'reject' ? '{}' : undefined);
  });
  it.each([400, 403, 404, 409, 500])(
    'preserves HTTP %s without automatic mutation retries',
    async (status) => {
      fetchMock.mockResolvedValue(response({ code: 'RESCHEDULE_RACE_CONFLICT' }, status));
      await expect(approveRescheduleRequest('request')).rejects.toMatchObject({
        status,
        details: { code: 'RESCHEDULE_RACE_CONFLICT' },
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
  it('propagates failed session refresh without retrying the mutation', async () => {
    fetchMock.mockResolvedValue(response({ code: 'UNAUTHENTICATED' }, 401));
    await expect(withdrawRescheduleRequest('request')).rejects.toMatchObject({ status: 401 });
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/api/v1/reschedule-requests/request/withdraw',
      '/api/v1/auth/refresh',
    ]);
  });
  it('does not retry an uncertain network write', async () => {
    fetchMock.mockRejectedValue(new TypeError('network'));
    await expect(rejectRescheduleRequest('request')).rejects.toThrow('network');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
