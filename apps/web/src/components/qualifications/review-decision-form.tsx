'use client';

import { useState } from 'react';

import { validateReviewDecision } from '@/components/qualifications/qualification-model';

import type { QualificationCopy } from '@/components/qualifications/qualification-copy';
import type { ReviewQualificationPayload } from '@/lib/api/types';
import type { FormEvent } from 'react';

interface ReviewDecisionFormProps {
  copy: QualificationCopy;
  onReview: (payload: ReviewQualificationPayload) => Promise<boolean>;
  disabled?: boolean;
}

export function ReviewDecisionForm({ copy, onReview, disabled = false }: ReviewDecisionFormProps) {
  const [decision, setDecision] = useState<'APPROVED' | 'REJECTED'>('APPROVED');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || disabled) {
      return;
    }
    const payload = validateReviewDecision(decision, reason);
    if (!payload) {
      setError(reason.trim().length > 500 ? copy.noteTooLong : copy.noteRequired);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      if (await onReview(payload)) {
        setReason('');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="mt-4 rounded-lg border border-paper-edge bg-sticky-yellow/25 p-4"
      onSubmit={(event) => void submit(event)}
    >
      <h4 className="font-note text-xl font-bold text-notebook-ink">{copy.reviewTitle}</h4>
      <div className="mt-3 flex flex-wrap gap-4">
        <label className="flex min-h-11 items-center gap-2 font-semibold text-notebook-ink">
          <input
            type="radio"
            name="qualification-decision"
            value="APPROVED"
            checked={decision === 'APPROVED'}
            disabled={busy || disabled}
            onChange={() => {
              setDecision('APPROVED');
              setError(null);
            }}
          />
          {copy.approve}
        </label>
        <label className="flex min-h-11 items-center gap-2 font-semibold text-notebook-ink">
          <input
            type="radio"
            name="qualification-decision"
            value="REJECTED"
            checked={decision === 'REJECTED'}
            disabled={busy || disabled}
            onChange={() => {
              setDecision('REJECTED');
              setError(null);
            }}
          />
          {copy.reject}
        </label>
      </div>
      <label
        htmlFor="qualification-review-note"
        className="mt-2 block text-sm font-bold text-notebook-ink"
      >
        {copy.noteLabel}
      </label>
      <p id="qualification-review-help" className="text-xs text-notebook-muted">
        {copy.noteOptional}
      </p>
      <textarea
        id="qualification-review-note"
        className="mt-2 min-h-24 w-full rounded-lg border border-paper-edge bg-paper p-3 text-notebook-ink focus-visible:outline-2 focus-visible:outline-admin-deep"
        value={reason}
        disabled={busy || disabled}
        aria-describedby="qualification-review-help"
        aria-invalid={Boolean(error)}
        onChange={(event) => {
          setReason(event.target.value);
          setError(null);
        }}
      />
      {error && (
        <p className="mt-2 text-sm text-red-800" role="alert">
          {error}
        </p>
      )}
      <button
        className="mt-3 min-h-11 rounded-lg bg-admin-deep px-4 py-2 font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-deep disabled:opacity-50"
        type="submit"
        disabled={busy || disabled}
      >
        {busy ? copy.saving : decision === 'APPROVED' ? copy.approve : copy.reject}
      </button>
    </form>
  );
}
