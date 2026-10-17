import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { classDetailsCopy } from '@/components/bookings/class-details-copy';
import { hasClassroomAccess, isSafeMeetingUrl } from '@/components/bookings/class-details-model';
import { getClassDetails, updateMeetingLink } from '@/lib/api/bookings';
import { clearAccessToken } from '@/lib/api/client';

import type { BookingClassDetails } from '@/lib/api/types';

describe('classroom access and link safety', () => {
  it.each(['CONFIRMED', 'COMPLETED'] as const)('shows meeting links for %s classes', (status) => {
    expect(hasClassroomAccess(status)).toBe(true);
  });
  it.each(['PENDING', 'CANCELED', 'EXPIRED'] as const)('hides links for %s', (status) => {
    expect(hasClassroomAccess(status)).toBe(false);
  });
  it.each([
    'https://meet.google.com/abc-defg-hij',
    'https://zoom.us/j/123?pwd=abc',
    'HTTPS://example.test',
    'https://teams.microsoft.com/l/meetup-join/room?context=%7B%7D',
    'https://meet.example.test:8443/join?token=a%2Fb#room',
    'https://ตัวอย่าง.ไทย/ห้องเรียน',
    'https://192.0.2.1/meeting',
    'https://[2001:db8::1]/meeting',
  ])('accepts %s', (url) => {
    expect(isSafeMeetingUrl(url)).toBe(true);
  });
  it('accepts long meeting links without adding a URL length limit', () => {
    expect(isSafeMeetingUrl(`https://example.test/${'a'.repeat(2500)}`)).toBe(true);
  });
  it.each([
    '',
    'not a URL',
    'http://example.test',
    'javascript:alert(1)',
    'data:text/html,hi',
    '//example.test',
    'https:example.test',
    'https://',
    'https://...',
    'https://./',
    'https://example..com',
    'https://.example.com',
    'https://-example.com',
    'https://example-.com',
    'https://exam_ple.com',
    `https://${'a'.repeat(64)}.test`,
    'https:///example.test',
    'https://example.test/a b',
    'https://example.test:70000/room',
    'https://bad host.test',
    ' https://example.test ',
    'https://user:secret@example.test',
    'https://user@example.test',
  ])('rejects unsafe URL %s', (url) => {
    expect(isSafeMeetingUrl(url)).toBe(false);
  });
  it('keeps bilingual copy keys aligned', () => {
    expect(Object.keys(classDetailsCopy.th).sort()).toEqual(
      Object.keys(classDetailsCopy.en).sort(),
    );
  });
});

describe('classroom API client', () => {
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
  function response(value: unknown, status = 200): Response {
    return new Response(JSON.stringify(value), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }
  it('reads the participant endpoint with an encoded booking ID', async () => {
    const details: BookingClassDetails = {
      bookingId: 'booking/id',
      status: 'COMPLETED',
      startAt: '2026-10-18T17:30:00.000Z',
      endAt: '2026-10-18T18:30:00.000Z',
      subject: { id: 'math', name: 'Mathematics' },
      meetingUrl: 'https://example.test/meeting',
      attendance: null,
      participants: {
        tutor: { id: 'tutor', detail: { displayName: 'Teacher Pim' } },
        student: {
          id: 'student',
          detail: { firstName: 'Mint', lastName: 'Preview', nickname: 'Mint' },
        },
      },
    };
    fetchMock.mockResolvedValueOnce(response(details));
    await expect(getClassDetails('booking/id')).resolves.toEqual(details);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/bookings/booking%2Fid/class-details',
      expect.objectContaining({ credentials: 'include' }),
    );
  });
  it('sends only the meeting URL to the tutor PUT endpoint', async () => {
    const meetingUrl = 'https://example.test/meeting';
    fetchMock.mockResolvedValueOnce(response({ bookingId: 'booking/id', meetingUrl }));
    await updateMeetingLink('booking/id', meetingUrl);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/bookings/tutor/booking%2Fid/meeting-link',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ meetingUrl }),
        credentials: 'include',
      }),
    );
  });
  it.each([400, 403, 404, 409, 500])(
    'preserves a %s save failure without an automatic retry',
    async (status) => {
      fetchMock.mockResolvedValueOnce(response({ message: 'Rejected' }, status));
      await expect(updateMeetingLink('id', 'https://example.test')).rejects.toMatchObject({
        status,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
  it('does not replay a save when its response is lost', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Network failure'));
    await expect(updateMeetingLink('id', 'https://example.test')).rejects.toThrow(
      'Network failure',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
