import { buildComparisonColumn } from '@/components/tutors/tutor-comparison-model';
import { ApiError } from '@/lib/api/error';
import { getPublicTutor, getPublicTutorAvailability } from '@/lib/api/tutors';

import type { ComparisonColumn } from '@/components/tutors/tutor-comparison-model';
import type { TutorComparisonSelection } from '@/lib/api/types';

export async function loadComparisonColumn(
  choice: TutorComparisonSelection,
  signal: AbortSignal,
): Promise<ComparisonColumn> {
  try {
    const detail = await getPublicTutor(choice.tutorId, { signal });
    const checked = buildComparisonColumn(choice, detail, [], Date.now());
    if (checked.state !== 'ready') {
      return checked;
    }
    const slots = await getPublicTutorAvailability(choice.tutorId, {}, { signal });
    return buildComparisonColumn(choice, detail, slots, Date.now());
  } catch (error: unknown) {
    const unavailable = error instanceof ApiError && [400, 403, 404].includes(error.status);
    return { choice, state: unavailable ? 'unavailable' : 'error' };
  }
}
