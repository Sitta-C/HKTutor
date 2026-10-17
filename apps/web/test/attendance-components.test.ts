import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SavedAttendanceSummary } from '@/components/bookings/saved-attendance-summary';

describe('saved attendance summary', () => {
  it('keeps the original UTC value while displaying the next Bangkok calendar day', () => {
    const markup = renderToStaticMarkup(
      createElement(SavedAttendanceSummary, {
        attendance: { attendance: 'ATTENDED', attendanceMarkedAt: '2026-10-16T18:30:00.000Z' },
        language: 'en',
      }),
    );
    expect(markup).toContain('Attended');
    expect(markup).toContain('dateTime="2026-10-16T18:30:00.000Z"');
    expect(markup).toContain('17 Oct 2026, 01:30');
  });
  it('renders absent in Thai with the Buddhist display year', () => {
    const markup = renderToStaticMarkup(
      createElement(SavedAttendanceSummary, {
        attendance: { attendance: 'ABSENT', attendanceMarkedAt: '2026-10-16T18:30:00.000Z' },
        language: 'th',
      }),
    );
    expect(markup).toContain('ขาดเรียน');
    expect(markup).toContain('17 ต.ค. 2569');
    expect(markup).toContain('01:30');
  });
  it('never fabricates a recorded time when receipt verification is unavailable', () => {
    const markup = renderToStaticMarkup(
      createElement(SavedAttendanceSummary, {
        attendance: { attendance: 'ABSENT', attendanceMarkedAt: null },
        language: 'en',
      }),
    );
    expect(markup).toContain('Absent');
    expect(markup).not.toContain('<time');
    expect(markup).not.toContain('Recorded:');
  });
});
