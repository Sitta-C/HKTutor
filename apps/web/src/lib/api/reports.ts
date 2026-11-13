import { authenticatedFetch } from '@/lib/api/client';

import type { TutorReport } from '@/lib/api/types';

export function getMyTutorReport(signal?: AbortSignal): Promise<TutorReport> {
  return authenticatedFetch<TutorReport>('/reports/tutor/me', {
    method: 'GET',
    ...(signal ? { signal } : {}),
  });
}
