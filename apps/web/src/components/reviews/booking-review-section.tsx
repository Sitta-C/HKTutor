'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { reviewCopy } from '@/components/reviews/review-copy';
import { ReviewForm } from '@/components/reviews/review-form';
import { reviewEligibility, reviewLoadErrorKey } from '@/components/reviews/review-model';
import { SubmittedReview } from '@/components/reviews/submitted-review';
import { NotebookLoadingRegion } from '@/components/ui/notebook-loading';
import { getMyBookingReview } from '@/lib/api/bookings';
import { useLanguage } from '@/lib/i18n';

import styles from './review.module.css';

import type { ReviewSubmitOutcome } from '@/components/reviews/review-model';
import type { BookingReview, BookingStatus } from '@/lib/api/types';

export function BookingReviewSection({
  bookingId,
  status,
  onRequiresBookingRefresh,
}: {
  bookingId: string;
  status: BookingStatus;
  onRequiresBookingRefresh: () => void;
}) {
  const { language } = useLanguage();
  const text = reviewCopy[language];
  const [review, setReview] = useState<BookingReview | null>(null);
  // A review can only exist once a booking reaches COMPLETED, so there is nothing to read for any
  // other status; skip the request and render the locked message immediately.
  const [loading, setLoading] = useState(status === 'COMPLETED');
  const [error, setError] = useState<unknown>(null);
  const [lockMessage, setLockMessage] = useState<string | undefined>(undefined);
  const [reconcileNote, setReconcileNote] = useState<string | undefined>(undefined);
  const active = useRef(false);
  const sequence = useRef(0);

  const load = useCallback((): Promise<void> => {
    const request = ++sequence.current;
    return getMyBookingReview(bookingId)
      .then((result) => {
        if (active.current && request === sequence.current) {
          setReview(result.review);
          setError(null);
        }
      })
      .catch((caught: unknown) => {
        if (active.current && request === sequence.current) {
          setError(caught);
        }
      })
      .finally(() => {
        if (active.current && request === sequence.current) {
          setLoading(false);
        }
      });
  }, [bookingId]);

  useEffect(() => {
    if (status !== 'COMPLETED') {
      return;
    }
    active.current = true;
    void load();
    return () => {
      active.current = false;
      sequence.current += 1;
    };
  }, [load, status]);

  /**
   * After an already-exists or uncertain POST outcome, read back before offering another manual
   * submission: a found review wins the race; otherwise unlock the form with an explanation.
   */
  async function reconcile(duringMessage: string, failureMessage: string): Promise<void> {
    setLockMessage(duringMessage);
    try {
      const result = await getMyBookingReview(bookingId);
      if (!active.current) {
        return;
      }
      if (result.review) {
        setReview(result.review);
        setLockMessage(undefined);
        return;
      }
      setLockMessage(undefined);
      setReconcileNote(failureMessage);
    } catch {
      if (active.current) {
        setLockMessage(undefined);
        setReconcileNote(failureMessage);
      }
    }
  }

  function handleOutcome(outcome: ReviewSubmitOutcome): void {
    setReconcileNote(undefined);
    if (outcome === 'alreadyExists') {
      void reconcile(text.checkingSaved, text.alreadyExists);
      return;
    }
    if (outcome === 'uncertain') {
      void reconcile(text.uncertain, text.uncertainFailed);
      return;
    }
    if (outcome === 'notCompleted') {
      setLockMessage(text.notCompleted);
      onRequiresBookingRefresh();
    }
  }

  const eligibility = review ? 'saved' : reviewEligibility(status, null);

  return (
    <section className={styles.section} aria-busy={loading}>
      {loading ? (
        <NotebookLoadingRegion label={text.loading} />
      ) : error ? (
        <p role="alert" className={styles.note}>
          {text[reviewLoadErrorKey(error)]}
        </p>
      ) : eligibility === 'saved' && review ? (
        <SubmittedReview review={review} language={language} />
      ) : eligibility === 'ready' ? (
        <>
          {reconcileNote && (
            <p role="alert" className={styles.note}>
              {reconcileNote}
            </p>
          )}
          <ReviewForm
            bookingId={bookingId}
            onSaved={(saved) => {
              // Show the response immediately, then confirm against the canonical GET. A
              // successful review does not change the booking's own status, so there is nothing
              // for the parent to refresh here; unmounting this section via a full booking
              // reload would only discard this state and flash the whole card.
              setReview(saved);
              setLockMessage(undefined);
              setReconcileNote(undefined);
              void load();
            }}
            onOutcome={handleOutcome}
            disabledMessage={lockMessage}
          />
        </>
      ) : (
        <p className={styles.note}>{text.locked}</p>
      )}
    </section>
  );
}
