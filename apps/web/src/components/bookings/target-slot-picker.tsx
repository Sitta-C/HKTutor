'use client';

import { useId } from 'react';

import { formatBookingDocketSlot } from '@/components/bookings/booking-docket-model';
import { formatDuration } from '@/components/bookings/booking-ui';

import type { BookingText } from '@/components/bookings/booking-ui';
import type { RescheduleCopy } from '@/components/bookings/reschedule-copy';
import type { RescheduleTargetSlot } from '@/lib/api/types';
import type { Language } from '@/lib/i18n';

export function TargetSlotPicker({
  slots,
  selectedId,
  onSelect,
  disabled,
  language,
  copy,
  role,
  bookingText,
}: {
  slots: RescheduleTargetSlot[];
  selectedId: string;
  onSelect: (id: string) => void;
  disabled: boolean;
  language: Language;
  copy: RescheduleCopy;
  role: 'student' | 'tutor';
  bookingText: BookingText;
}) {
  const groupId = useId();
  const selectedRowClass =
    role === 'student'
      ? 'border-x border-student-deep/30 bg-[color-mix(in_srgb,var(--color-student-deep)_8%,var(--color-paper))]'
      : 'border-x border-tutor-deep/30 bg-[color-mix(in_srgb,var(--color-tutor-deep)_8%,var(--color-paper))]';
  const durationClass = role === 'student' ? 'text-student-deep' : 'text-tutor-deep';
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-2">
      <legend className="mb-2 font-semibold">{copy.choose}</legend>
      {slots.length === 0 ? (
        <p className="text-sm text-notebook-muted">{copy.empty}</p>
      ) : (
        <div className="max-h-64 overflow-y-auto rounded border border-paper-edge">
          {slots.map((slot) => (
            <label
              key={slot.id}
              className={`flex min-h-11 cursor-pointer items-center gap-3 border-b border-paper-edge p-3 last:border-b-0 focus-within:bg-paper-muted ${selectedId === slot.id ? selectedRowClass : ''}`}
            >
              <input
                type="radio"
                name={groupId}
                value={slot.id}
                checked={selectedId === slot.id}
                onChange={() => onSelect(slot.id)}
              />
              <span className="min-w-0 text-sm">
                <span className="block">{formatBookingDocketSlot(slot, language).label}</span>
                {selectedId === slot.id && (
                  <span className={`mt-0.5 block text-xs font-semibold ${durationClass}`}>
                    {formatDuration(slot.startAtUtc, slot.endAtUtc, bookingText)}
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}
