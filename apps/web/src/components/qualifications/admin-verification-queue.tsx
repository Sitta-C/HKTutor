'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { DocumentPreview } from '@/components/qualifications/document-preview';
import { qualificationCopy } from '@/components/qualifications/qualification-copy';
import { qualificationErrorKind } from '@/components/qualifications/qualification-model';
import { ReviewDecisionForm } from '@/components/qualifications/review-decision-form';
import { PaperCard, WashiTape } from '@/components/ui/notebook';
import {
  getAdminVerification,
  getAdminVerificationSignedUrl,
  listAdminVerifications,
  reviewAdminVerification,
} from '@/lib/api/qualifications';
import { formatBangkokDateTime } from '@/lib/date-time';
import { useLanguage } from '@/lib/i18n';

import type {
  QualificationDetailResponse,
  QualificationQueueResponse,
  QualificationStatus,
  ReviewQualificationPayload,
} from '@/lib/api/types';

type QueueItem = QualificationQueueResponse['items'][number];

const QUEUE_STATUS_STYLE = {
  PENDING: 'border-amber-300 bg-sticky-yellow text-amber-950',
  APPROVED: 'border-emerald-300 bg-sticky-green text-emerald-950',
  REJECTED: 'border-red-300 bg-red-50 text-red-900',
};

export function AdminVerificationQueue() {
  const { language } = useLanguage();
  const copy = qualificationCopy[language];
  const [status, setStatus] = useState<QualificationStatus>('PENDING');
  const [items, setItems] = useState<QueueItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<QualificationDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const queueRequest = useRef(0);
  const detailRequest = useRef(0);
  const selectedIdRef = useRef<string | null>(null);

  const reloadQueue = useCallback(
    async (filter: QualificationStatus) => {
      const requestId = ++queueRequest.current;
      setLoading(true);
      try {
        const response = await listAdminVerifications(filter);
        if (requestId !== queueRequest.current) {
          return;
        }
        setItems(response.items);
        setCursor(response.nextCursor);
        setError(null);
      } catch (caught) {
        if (requestId === queueRequest.current) {
          setItems([]);
          setCursor(null);
          setError(qualificationErrorKind(caught) === 'denied' ? copy.denied : copy.queueError);
        }
        throw caught;
      } finally {
        if (requestId === queueRequest.current) {
          setLoading(false);
        }
      }
    },
    [copy.denied, copy.queueError],
  );

  const reloadDetail = useCallback(
    async (documentId: string) => {
      if (documentId !== selectedIdRef.current) {
        return;
      }
      const requestId = ++detailRequest.current;
      setDetailLoading(true);
      try {
        const response = await getAdminVerification(documentId);
        if (requestId !== detailRequest.current || documentId !== selectedIdRef.current) {
          return;
        }
        setDetail(response);
        setDetailError(null);
      } catch (caught) {
        if (requestId === detailRequest.current && documentId === selectedIdRef.current) {
          setDetail(null);
          setDetailError(
            qualificationErrorKind(caught) === 'denied' ? copy.denied : copy.detailsError,
          );
        }
        throw caught;
      } finally {
        if (requestId === detailRequest.current && documentId === selectedIdRef.current) {
          setDetailLoading(false);
        }
      }
    },
    [copy.denied, copy.detailsError],
  );

  useEffect(() => {
    void Promise.resolve()
      .then(() => reloadQueue(status))
      .catch(() => undefined);
    return () => {
      queueRequest.current += 1;
    };
  }, [reloadQueue, status]);

  useEffect(() => {
    if (!selectedId) {
      return;
    }
    void Promise.resolve()
      .then(() => reloadDetail(selectedId))
      .catch(() => undefined);
    return () => {
      detailRequest.current += 1;
    };
  }, [reloadDetail, selectedId]);

  const selectStatus = (next: QualificationStatus) => {
    if (next === status || reviewing) {
      return;
    }
    setStatus(next);
    selectedIdRef.current = null;
    detailRequest.current += 1;
    setSelectedId(null);
    setDetail(null);
    setDetailLoading(false);
    setDetailError(null);
    setNotice(null);
    setItems([]);
    setCursor(null);
    setLoading(true);
  };

  const loadMore = async () => {
    if (!cursor || loading || moreLoading || reviewing) {
      return;
    }
    const requestedCursor = cursor;
    const requestId = queueRequest.current;
    setMoreLoading(true);
    try {
      const response = await listAdminVerifications(status, requestedCursor);
      if (requestId !== queueRequest.current) {
        return;
      }
      setItems((current) => [...current, ...response.items]);
      setCursor(response.nextCursor);
      setError(null);
    } catch {
      if (requestId === queueRequest.current) {
        setError(copy.queueError);
      }
    } finally {
      setMoreLoading(false);
    }
  };

  const review = async (payload: ReviewQualificationPayload): Promise<boolean> => {
    if (!selectedId || detail?.document.status !== 'PENDING' || reviewing) {
      return false;
    }
    const reviewedDocumentId = selectedId;
    setReviewing(true);
    setNotice(null);
    let saved = false;
    try {
      await reviewAdminVerification(reviewedDocumentId, payload);
      saved = true;
    } catch (caught) {
      setNotice(
        qualificationErrorKind(caught) === 'conflict' ? copy.reviewConflict : copy.reviewError,
      );
    }
    if (selectedIdRef.current === reviewedDocumentId) {
      setDetail(null);
    }
    setItems([]);
    setCursor(null);
    if (saved) {
      setNotice(copy.reviewSuccess);
    }
    await Promise.allSettled([
      ...(selectedIdRef.current === reviewedDocumentId ? [reloadDetail(reviewedDocumentId)] : []),
      reloadQueue(status),
    ]);
    setReviewing(false);
    return saved;
  };

  return (
    <section className="mt-6" aria-labelledby="admin-verification-title">
      <PaperCard className="relative p-5 sm:p-7">
        <WashiTape tone="yellow" className="-top-2 left-8 rotate-2" />
        <h2
          id="admin-verification-title"
          className="font-note text-2xl font-bold text-notebook-ink"
        >
          {copy.queueTitle}
        </h2>
        <p className="mt-2 text-sm text-notebook-muted">{copy.queueIntro}</p>
        <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label={copy.queueTitle}>
          {(['PENDING', 'APPROVED', 'REJECTED'] as const).map((option) => (
            <button
              key={option}
              type="button"
              disabled={reviewing}
              aria-pressed={status === option}
              className={`min-h-11 rounded-lg border px-3 py-2 text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-deep ${status === option ? 'border-amber-700 bg-sticky-yellow text-amber-950' : 'border-paper-edge bg-paper text-notebook-ink'}`}
              onClick={() => selectStatus(option)}
            >
              {copy.status[option]}
            </button>
          ))}
          <button
            type="button"
            disabled={reviewing}
            className="min-h-11 px-2 text-sm font-bold text-admin-deep underline underline-offset-4 focus-visible:outline-2"
            onClick={() => void reloadQueue(status).catch(() => undefined)}
          >
            {copy.refresh}
          </button>
        </div>
        {notice && (
          <p
            className="mt-3 rounded-lg bg-sticky-yellow/40 p-3 text-sm text-notebook-ink"
            role="status"
          >
            {notice}
          </p>
        )}
        {error && (
          <p className="mt-3 text-sm text-red-800" role="alert">
            {error}
          </p>
        )}
        <div className="mt-5 grid items-start gap-5 lg:grid-cols-[minmax(260px,0.85fr)_minmax(0,1.15fr)]">
          <div>
            {loading ? (
              <p role="status">{copy.loading}</p>
            ) : items.length === 0 ? (
              <p className="rounded-lg border border-dashed border-paper-edge p-4 text-notebook-muted">
                {copy.queueEmpty}
              </p>
            ) : (
              <ul className="space-y-2.5">
                {items.map((item) => (
                  <li key={item.documentId}>
                    <button
                      type="button"
                      aria-current={selectedId === item.documentId ? 'true' : undefined}
                      className={`w-full min-w-0 rounded-xl border p-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-deep sm:p-4 ${selectedId === item.documentId ? 'border-amber-700 bg-sticky-yellow/30' : 'border-paper-edge bg-paper hover:border-amber-600'}`}
                      onClick={() => {
                        if (selectedIdRef.current === item.documentId) {
                          if (detailError && !detailLoading) {
                            void reloadDetail(item.documentId).catch(() => undefined);
                          }
                          return;
                        }
                        selectedIdRef.current = item.documentId;
                        detailRequest.current += 1;
                        setSelectedId(item.documentId);
                        setDetail(null);
                        setDetailError(null);
                        setDetailLoading(true);
                        setNotice(null);
                      }}
                    >
                      <span className="flex min-w-0 flex-wrap items-start gap-3">
                        <span
                          aria-hidden="true"
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sticky-blue/50 text-[10px] font-extrabold text-tutor-deep"
                        >
                          {item.mimeType === 'application/pdf'
                            ? 'PDF'
                            : item.mimeType === 'image/jpeg'
                              ? 'JPG'
                              : 'PNG'}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block break-words font-bold text-notebook-ink">
                            {item.tutor.displayName}
                          </span>
                          <span className="block break-all text-sm text-notebook-muted">
                            {item.fileName}
                          </span>
                          <span className="mt-1 block text-xs text-notebook-muted">
                            {item.type === 'DEGREE' || item.type === 'CERTIFICATE'
                              ? copy.types[item.type]
                              : copy.unknownType}{' '}
                            · {formatBangkokDateTime(item.createdAt, language)}
                          </span>
                        </span>
                        <span
                          className={`rounded-full border px-2.5 py-1 text-xs font-bold ${QUEUE_STATUS_STYLE[item.status]}`}
                        >
                          {copy.status[item.status]}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {cursor && (
              <button
                type="button"
                disabled={loading || moreLoading || reviewing}
                onClick={() => void loadMore()}
                className="mt-3 min-h-11 rounded-lg border border-paper-edge bg-paper px-4 font-bold text-admin-deep focus-visible:outline-2 disabled:opacity-50"
              >
                {moreLoading ? copy.loading : copy.loadMore}
              </button>
            )}
          </div>
          <div className="min-w-0 rounded-lg border border-paper-edge bg-paper p-4 sm:p-5">
            {detailLoading ? (
              <p role="status">{copy.loading}</p>
            ) : detailError ? (
              <p role="alert" className="text-sm text-red-800">
                {detailError}
              </p>
            ) : detail ? (
              <div>
                <h3 className="break-words font-note text-xl font-bold text-notebook-ink">
                  {detail.tutor.displayName}
                </h3>
                <p className="mt-1 break-all text-sm text-notebook-muted">
                  {detail.document.fileName}
                </p>
                <p className="mt-2 text-sm text-notebook-muted">
                  {copy.submittedAt}: {formatBangkokDateTime(detail.document.createdAt, language)}
                </p>
                <p className="mt-1 text-sm font-semibold text-notebook-ink">
                  {copy.status[detail.document.status]}
                </p>
                {detail.document.rejectionReason && (
                  <p className="mt-2 rounded-md bg-red-50 p-2 text-sm text-red-900">
                    {copy.rejectionReason}: {detail.document.rejectionReason}
                  </p>
                )}
                <div className="mt-3">
                  <DocumentPreview
                    key={detail.document.documentId}
                    documentId={detail.document.documentId}
                    language={language}
                    copy={copy}
                    loadSignedUrl={getAdminVerificationSignedUrl}
                  />
                </div>
                {detail.reviewHistory.length > 0 && (
                  <div className="mt-4">
                    <h4 className="font-bold text-notebook-ink">{copy.reviewHistory}</h4>
                    <ul className="mt-2 space-y-2 text-sm text-notebook-muted">
                      {detail.reviewHistory.map((entry, index) => (
                        <li
                          key={`${entry.reviewedAt}-${index}`}
                          className="rounded-md border border-paper-edge p-2"
                        >
                          {copy.status[entry.status]} ·{' '}
                          {formatBangkokDateTime(entry.reviewedAt, language)}
                          {entry.reason && <p className="mt-1 break-words">{entry.reason}</p>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {detail.document.status === 'PENDING' && (
                  <ReviewDecisionForm copy={copy} onReview={review} disabled={reviewing} />
                )}
              </div>
            ) : (
              <p className="text-sm text-notebook-muted">{copy.selectDocument}</p>
            )}
          </div>
        </div>
      </PaperCard>
    </section>
  );
}
