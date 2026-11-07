import type {
  PublicAvailabilitySlot,
  PublicTeachingListing,
  PublicTutorDetail,
  PublicTutorProfile,
  TutorComparisonSelection,
} from '@/lib/api/types';

export const MAX_COMPARISON_TUTORS = 3;
export const COMPARISON_BUTTON_SIZE = 60;

export interface ComparisonChoice extends TutorComparisonSelection {
  displayName: string;
}

export type ComparisonColumn =
  | { choice: TutorComparisonSelection; state: 'loading' | 'unavailable' | 'error' }
  | {
      choice: TutorComparisonSelection;
      state: 'ready';
      tutor: PublicTutorProfile;
      listing: PublicTeachingListing;
      nextSlot: PublicAvailabilitySlot | null;
    };

export interface Point {
  x: number;
  y: number;
}

export interface Viewport {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function toggleComparisonChoice<T extends TutorComparisonSelection>(
  choices: T[],
  candidate: T,
): T[] {
  const index = choices.findIndex((choice) => choice.tutorId === candidate.tutorId);
  if (index >= 0) {
    if (choices[index]?.listingId === candidate.listingId) {
      return choices.filter((choice) => choice.tutorId !== candidate.tutorId);
    }
    return choices.map((choice, position) => (position === index ? candidate : choice));
  }
  return choices.length < MAX_COMPARISON_TUTORS ? [...choices, candidate] : choices;
}

export function buildComparisonColumn(
  choice: TutorComparisonSelection,
  detail: PublicTutorDetail,
  slots: PublicAvailabilitySlot[],
  now: number,
): ComparisonColumn {
  const listing = detail.listings.find((item) => item.listingId === choice.listingId);
  if (
    detail.tutor.tutorId !== choice.tutorId ||
    detail.tutor.verificationStatus !== 'VERIFIED' ||
    !listing
  ) {
    return { choice, state: 'unavailable' };
  }
  const nextSlot = slots.reduce<PublicAvailabilitySlot | null>((earliest, slot) => {
    const start = Date.parse(slot.startAtUtc);
    const end = Date.parse(slot.endAtUtc);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < now || end <= start) {
      return earliest;
    }
    return earliest === null || start < Date.parse(earliest.startAtUtc) ? slot : earliest;
  }, null);
  return { choice, state: 'ready', tutor: detail.tutor, listing, nextSlot };
}

export function floatingBounds(viewport: Viewport): { min: Point; max: Point } {
  const min = {
    x: viewport.left + 16,
    y: viewport.top + Math.max(16, Math.min(80, viewport.height - COMPARISON_BUTTON_SIZE - 16)),
  };
  return {
    min,
    max: {
      x: Math.max(min.x, viewport.left + viewport.width - COMPARISON_BUTTON_SIZE - 16),
      y: Math.max(min.y, viewport.top + viewport.height - COMPARISON_BUTTON_SIZE - 16),
    },
  };
}

export function clampFloatingPoint(point: Point, viewport: Viewport): Point {
  const { min, max } = floatingBounds(viewport);
  return {
    x: Math.max(min.x, Math.min(max.x, point.x)),
    y: Math.max(min.y, Math.min(max.y, point.y)),
  };
}

export function comparisonPanelPosition(
  button: { left: number; top: number; width: number; height: number },
  panel: { width: number; height: number },
  viewport: Viewport,
): Point {
  const minX = viewport.left + 12;
  const minY = viewport.top + 12;
  const maxX = Math.max(minX, viewport.left + viewport.width - panel.width - 12);
  const maxY = Math.max(minY, viewport.top + viewport.height - panel.height - 12);
  const above = button.top - panel.height - 12;
  const below = button.top + button.height + 12;
  const preferredY =
    above >= minY
      ? above
      : below <= maxY
        ? below
        : button.top + button.height / 2 - panel.height / 2;
  return {
    x: Math.max(minX, Math.min(maxX, button.left + button.width / 2 - panel.width / 2)),
    y: Math.max(minY, Math.min(maxY, preferredY)),
  };
}
