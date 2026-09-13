import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createBooking,
  createBookingOnce,
  getBookingQuote,
  getMyBooking,
  getMyBookings,
} from '@/lib/api/bookings';
import { clearAccessToken } from '@/lib/api/client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  });
}

const quote = {
  tutor: { tutorId: 'tutor-id', displayName: 'Anan' },
  listing: {
    id: 'listing-id',
    subjectId: 'subject-id',
    subjectName: 'Mathematics',
    gradeLevelId: 'grade-id',
    gradeLevelName: 'Grade 10',
    pricePerHour: '500.00',
    description: 'A published lesson',
  },
  slot: {
    id: 'slot-id',
    startAtUtc: '2026-09-15T03:00:00.000Z',
    endAtUtc: '2026-09-15T04:00:00.000Z',
  },
  subtotalAmount: '500.00',
  discountAmount: '0.00',
  netAmount: '500.00',
  currency: 'THB',
};

describe('student booking API clients', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    clearAccessToken();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    clearAccessToken();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('loads a server-authoritative quote with only listing and slot query fields', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(quote));

    await expect(getBookingQuote('listing-id', 'slot-id')).resolves.toEqual(quote);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/bookings/quote?listingId=listing-id&slotId=slot-id',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('sends only the finalized create-booking DTO and never client pricing or student identity', async () => {
    const created = {
      id: 'booking-id',
      status: 'PENDING',
      listingId: 'listing-id',
      slotId: 'slot-id',
      subtotalAmount: '500.00',
      discountAmount: '0.00',
      netAmount: '500.00',
      currency: 'THB',
      createdAt: '2026-09-12T05:00:00.000Z',
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(created, 201));

    await expect(createBooking({ listingId: 'listing-id', slotId: 'slot-id' })).resolves.toEqual(
      created,
    );

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      listingId: 'listing-id',
      slotId: 'slot-id',
    });
    expect(JSON.stringify(request.body)).not.toMatch(/student|price|amount|status/i);
  });

  it('prevents a duplicate create request while the first request is still pending', async () => {
    let resolveRequest!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveRequest = resolve;
      }),
    );
    const gate = { current: false };
    const first = createBookingOnce({ listingId: 'listing-id', slotId: 'slot-id' }, gate);
    const second = await createBookingOnce({ listingId: 'listing-id', slotId: 'slot-id' }, gate);

    expect(second).toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();

    resolveRequest(jsonResponse({ id: 'booking-id', status: 'PENDING' }, 201));
    await first;
    expect(gate.current).toBe(false);
  });

  it('uses Student-owned list and detail paths without accepting an owner id', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ items: [], total: 0 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'booking-id' }));

    await expect(
      getMyBookings({
        from: new Date('2026-09-01T00:00:00.000Z'),
        status: 'PENDING',
        to: '2026-09-30T23:59:59.999Z',
      }),
    ).resolves.toEqual({ items: [], total: 0 });
    await expect(getMyBooking('booking-id')).resolves.toEqual({ id: 'booking-id' });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/v1/bookings/me?status=PENDING&from=2026-09-01T00%3A00%3A00.000Z&to=2026-09-30T23%3A59%3A59.999Z',
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/v1/bookings/me/booking-id');
  });

  it.each([400, 401, 403, 409])(
    'preserves booking API error status %s for UI handling',
    async (status: number) => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'booking request failed' }, status));
      if (status === 401) {
        fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'refresh failed' }, 401));
      }

      await expect(getBookingQuote('listing-id', 'slot-id')).rejects.toMatchObject({ status });
    },
  );
});
