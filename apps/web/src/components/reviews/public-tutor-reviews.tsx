'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { ReviewEntry } from '@/components/reviews/review-entry';
import { PaperCard } from '@/components/ui/notebook';
import { NotebookAction } from '@/components/ui/notebook-action';
import { NotebookLoadingRegion } from '@/components/ui/notebook-loading';
import { ApiError } from '@/lib/api/error';
import { getPublicTutorReviews } from '@/lib/api/tutors';

import styles from './public-tutor-reviews.module.css';

import type { PublicTutorReview } from '@/lib/api/types';

const PAGE_SIZE = 20;

export function PublicTutorReviews({
  language,
  onTutorUnavailable,
  tutorId,
}: {
  language: 'en' | 'th';
  onTutorUnavailable: (error: ApiError) => void;
  tutorId: string;
}) {
  const text = copy[language];
  const [items, setItems] = useState<PublicTutorReview[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const active = useRef(false);
  const request = useRef(0);

  const load = useCallback(
    async (cursor?: string): Promise<void> => {
      const currentRequest = ++request.current;
      if (cursor === undefined) setLoading(true);
      else setLoadingMore(true);

      try {
        const response = await getPublicTutorReviews(tutorId, {
          ...(cursor === undefined ? {} : { cursor }),
          limit: PAGE_SIZE,
        });
        if (!active.current || currentRequest !== request.current) return;
        setItems((current) =>
          cursor === undefined ? response.items : [...current, ...response.items],
        );
        setNextCursor(response.nextCursor);
        setError(false);
      } catch (caught) {
        if (!active.current || currentRequest !== request.current) return;
        if (caught instanceof ApiError && caught.status === 404) {
          onTutorUnavailable(caught);
          return;
        }
        setError(true);
      } finally {
        if (active.current && currentRequest === request.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [onTutorUnavailable, tutorId],
  );

  useEffect(() => {
    active.current = true;
    const currentRequest = ++request.current;
    void getPublicTutorReviews(tutorId, { limit: PAGE_SIZE })
      .then((response) => {
        if (!active.current || currentRequest !== request.current) return;
        setItems(response.items);
        setNextCursor(response.nextCursor);
        setError(false);
      })
      .catch((caught: unknown) => {
        if (!active.current || currentRequest !== request.current) return;
        if (caught instanceof ApiError && caught.status === 404) {
          onTutorUnavailable(caught);
          return;
        }
        setError(true);
      })
      .finally(() => {
        if (active.current && currentRequest === request.current) {
          setLoading(false);
        }
      });
    return () => {
      active.current = false;
      request.current += 1;
    };
  }, [onTutorUnavailable, tutorId]);

  return (
    <PaperCard className={styles.card} aria-labelledby="public-tutor-reviews">
      <div className={styles.heading}>
        <div>
          <h2 id="public-tutor-reviews">{text.title}</h2>
          <p>{text.description}</p>
        </div>
      </div>

      {loading ? (
        <div className={styles.state}>
          <NotebookLoadingRegion label={text.loading} />
        </div>
      ) : error && items.length === 0 ? (
        <div className={styles.error} role="alert">
          <p>{text.error}</p>
          <button type="button" onClick={() => void load()}>
            {text.retry}
          </button>
        </div>
      ) : items.length === 0 ? (
        <p className={styles.empty}>{text.empty}</p>
      ) : (
        <>
          <ol className={styles.list}>
            {items.map((review) => (
              <li key={review.id} className={styles.review}>
                <ReviewEntry
                  review={review}
                  language={language}
                  author={review.author.displayName}
                />
              </li>
            ))}
          </ol>
          {error && (
            <p className={styles.moreError} role="alert">
              {text.moreError}
            </p>
          )}
          {nextCursor && (
            <div className={styles.actions}>
              <NotebookAction
                type="button"
                role="student"
                tone="secondary"
                disabled={loadingMore}
                onClick={() => void load(nextCursor)}
              >
                {loadingMore ? text.loadingMore : error ? text.retry : text.more}
              </NotebookAction>
            </div>
          )}
        </>
      )}
    </PaperCard>
  );
}

const copy = {
  en: {
    title: 'Student reviews',
    description: 'Feedback from completed lessons with this tutor.',
    loading: 'Loading student reviews',
    error: 'Student reviews could not be loaded.',
    moreError: 'More reviews could not be loaded. Try again.',
    retry: 'Try again',
    empty: 'No student reviews yet.',
    more: 'Load more reviews',
    loadingMore: 'Loading more reviews…',
  },
  th: {
    title: 'รีวิวจากนักเรียน',
    description: 'ความคิดเห็นจากคลาสที่เรียนจบกับติวเตอร์คนนี้',
    loading: 'กำลังโหลดรีวิวจากนักเรียน',
    error: 'ไม่สามารถโหลดรีวิวจากนักเรียนได้',
    moreError: 'ไม่สามารถโหลดรีวิวเพิ่มเติมได้ กรุณาลองอีกครั้ง',
    retry: 'ลองอีกครั้ง',
    empty: 'ยังไม่มีรีวิวจากนักเรียน',
    more: 'โหลดรีวิวเพิ่มเติม',
    loadingMore: 'กำลังโหลดรีวิวเพิ่มเติม…',
  },
} as const;
