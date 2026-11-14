'use client';

import { useId, useRef, useState } from 'react';

import { DashboardIcon } from '@/components/dashboard/dashboard-icon';
import { reviewCopy } from '@/components/reviews/review-copy';
import {
  REVIEW_FEEDBACK_MAX_LENGTH,
  canSubmitReview,
  reviewFeedbackLength,
  reviewSubmitOutcome,
} from '@/components/reviews/review-model';
import { NotebookAction } from '@/components/ui/notebook-action';
import { NotebookConfirmDialog } from '@/components/ui/notebook-confirm-dialog';
import { useNotebookToast } from '@/components/ui/notebook-toast';
import { submitBookingReview } from '@/lib/api/bookings';
import { useLanguage } from '@/lib/i18n';

import styles from './review.module.css';

import type { ReviewSubmitOutcome } from '@/components/reviews/review-model';
import type { BookingReview } from '@/lib/api/types';

const RATING_VALUES = [1, 2, 3, 4, 5] as const;

export function ReviewForm({
  bookingId,
  onSaved,
  onOutcome,
  disabled = false,
  disabledMessage,
}: {
  bookingId: string;
  onSaved: (review: BookingReview) => void;
  onOutcome: (outcome: ReviewSubmitOutcome) => void;
  disabled?: boolean;
  disabledMessage?: string | undefined;
}) {
  const { language } = useLanguage();
  const text = reviewCopy[language];
  const toast = useNotebookToast();
  const feedbackId = useId();
  const [clarity, setClarity] = useState<number | null>(null);
  const [punctuality, setPunctuality] = useState<number | null>(null);
  const [preparation, setPreparation] = useState<number | null>(null);
  const [feedback, setFeedback] = useState('');
  const [feedbackTouched, setFeedbackTouched] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const gate = useRef(false);
  const length = reviewFeedbackLength(feedback);
  const overLimit = length > REVIEW_FEEDBACK_MAX_LENGTH;
  const locked = disabled || Boolean(disabledMessage) || pending;
  const feedbackInvalid = (feedbackTouched || submitAttempted) && (length === 0 || overLimit);
  const ratingsInvalid =
    submitAttempted && (clarity === null || punctuality === null || preparation === null);

  async function submit(): Promise<void> {
    setSubmitAttempted(true);
    if (locked || gate.current) {
      return;
    }
    const fields = { clarity, punctuality, preparation, feedback };
    if (!canSubmitReview(fields)) {
      toast.error(
        clarity === null || punctuality === null || preparation === null
          ? text.ratingsRequired
          : length === 0
            ? text.feedbackBlank
            : text.feedbackTooLong,
      );
      return;
    }
    if (!confirming) {
      setConfirming(true);
      return;
    }
    gate.current = true;
    setPending(true);
    setError(null);
    try {
      const review = await submitBookingReview(bookingId, {
        clarity: fields.clarity,
        punctuality: fields.punctuality,
        preparation: fields.preparation,
        feedback: fields.feedback.trim(),
      });
      toast.success(text.submitted);
      setConfirming(false);
      onSaved(review);
    } catch (caught: unknown) {
      const outcome = reviewSubmitOutcome(caught);
      const message =
        outcome === 'unauthenticated'
          ? text.unauthenticated
          : outcome === 'forbidden'
            ? text.forbidden
            : outcome === 'notFound'
              ? text.notFound
              : outcome === 'notCompleted'
                ? text.notCompleted
                : outcome === 'alreadyExists'
                  ? text.alreadyExists
                  : outcome === 'uncertain'
                    ? text.uncertain
                    : text.failed;
      toast.error(message);
      setConfirming(false);
      // The parent takes over messaging for outcomes it reconciles or locks on; avoid a stale
      // duplicate once it sets its own disabledMessage/note.
      const parentHandles =
        outcome === 'alreadyExists' || outcome === 'uncertain' || outcome === 'notCompleted';
      if (!parentHandles) {
        setError(message);
      }
      onOutcome(outcome);
    } finally {
      gate.current = false;
      setPending(false);
    }
  }

  const ratingGroups = [
    {
      legend: text.clarityLegend,
      value: clarity,
      setValue: setClarity,
      name: `review-clarity-${bookingId}`,
    },
    {
      legend: text.punctualityLegend,
      value: punctuality,
      setValue: setPunctuality,
      name: `review-punctuality-${bookingId}`,
    },
    {
      legend: text.preparationLegend,
      value: preparation,
      setValue: setPreparation,
      name: `review-preparation-${bookingId}`,
    },
  ] as const;

  return (
    <section className={styles.form} aria-labelledby="review-title" aria-busy={pending}>
      <h2 className={styles.heading} id="review-title">
        {text.title}
      </h2>
      <p className={styles.note} id="review-help">
        {disabledMessage ?? text.help}
      </p>
      {error && !disabledMessage && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <p className={styles.scaleGuidance} id="review-rating-scale">
        {text.ratingScale}
      </p>
      <fieldset
        className={styles.ratingGroups}
        disabled={locked}
        aria-describedby={
          ratingsInvalid
            ? 'review-rating-scale review-help review-ratings-error'
            : 'review-rating-scale review-help'
        }
      >
        {ratingGroups.map((group) => {
          const labelId = `${group.name}-label`;
          return (
            <div
              key={group.name}
              className={styles.ratingGroup}
              role="radiogroup"
              aria-labelledby={labelId}
            >
              <span className={styles.caption} id={labelId}>
                {group.legend}
              </span>
              <div className={styles.ratingChoices}>
                {RATING_VALUES.map((value) => (
                  <label className={styles.ratingChoice} key={value}>
                    <input
                      type="radio"
                      name={group.name}
                      value={value}
                      checked={group.value === value}
                      onChange={() => group.setValue(value)}
                    />
                    <span className="sr-only">{group.legend} </span>
                    {value}
                    <span className="sr-only"> {text.ratingOption}</span>
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </fieldset>
      {ratingsInvalid && (
        <p role="alert" id="review-ratings-error" className={styles.error}>
          {text.ratingsRequired}
        </p>
      )}
      <div className={styles.feedbackField}>
        <label htmlFor={feedbackId}>{text.feedbackLabel}</label>
        <p className={styles.note} id={`${feedbackId}-help`}>
          {text.feedbackHelp}
        </p>
        <textarea
          id={feedbackId}
          rows={4}
          value={feedback}
          placeholder={text.feedbackPlaceholder}
          disabled={locked}
          aria-describedby={
            feedbackInvalid
              ? `${feedbackId}-help ${feedbackId}-error ${feedbackId}-counter`
              : `${feedbackId}-help ${feedbackId}-counter`
          }
          aria-invalid={feedbackInvalid}
          onChange={(event) => setFeedback(event.target.value)}
          onBlur={() => setFeedbackTouched(true)}
        />
        <div className={styles.feedbackFooter}>
          {feedbackInvalid && (
            <p role="alert" id={`${feedbackId}-error`}>
              {length === 0 ? text.feedbackBlank : text.feedbackTooLong}
            </p>
          )}
          <span
            className={styles.feedbackCounter}
            id={`${feedbackId}-counter`}
            data-over-limit={overLimit}
          >
            {length} {text.feedbackCounterSuffix}
          </span>
        </div>
      </div>
      <NotebookConfirmDialog
        open={confirming}
        role="student"
        title={text.confirmTitle}
        description={text.finality}
        confirmLabel={text.submit}
        busy={pending}
        disabled={disabled || Boolean(disabledMessage)}
        error={error}
        onCancel={() => setConfirming(false)}
        onConfirm={submit}
      >
        <dl>
          {ratingGroups.map(({ legend, value }) => (
            <div key={legend}>
              <dt>{legend}</dt>
              <dd>{value} / 5</dd>
            </div>
          ))}
        </dl>
        <blockquote>{feedback.trim()}</blockquote>
      </NotebookConfirmDialog>
      {!disabledMessage && (
        <p className={styles.note} id="review-finality">
          {text.finality}
        </p>
      )}
      <div className={styles.formActions}>
        <NotebookAction
          type="button"
          role="student"
          icon={<DashboardIcon name="check" />}
          disabled={locked}
          aria-busy={pending}
          aria-describedby={disabledMessage ? 'review-help' : 'review-finality'}
          onClick={() => void submit()}
        >
          {pending ? text.submitting : text.submit}
        </NotebookAction>
      </div>
    </section>
  );
}
