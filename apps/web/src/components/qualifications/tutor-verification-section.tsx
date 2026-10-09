'use client';

import { useCallback, useEffect, useState } from 'react';

import { DocumentStatusList } from '@/components/qualifications/document-status-list';
import { qualificationCopy } from '@/components/qualifications/qualification-copy';
import { QualificationUploader } from '@/components/qualifications/qualification-uploader';
import { PaperCard, WashiTape } from '@/components/ui/notebook';
import { listMyQualifications } from '@/lib/api/qualifications';
import { useLanguage } from '@/lib/i18n';

import type { QualificationListItem } from '@/lib/api/qualifications';

interface TutorVerificationSectionProps {
  onDocumentChanged: () => Promise<void>;
}

export function TutorVerificationSection({ onDocumentChanged }: TutorVerificationSectionProps) {
  const { language } = useLanguage();
  const copy = qualificationCopy[language];
  const [documents, setDocuments] = useState<QualificationListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const response = await listMyQualifications();
    setDocuments(response.items);
    setError(null);
  }, []);

  useEffect(() => {
    let active = true;
    listMyQualifications()
      .then((response) => {
        if (active) {
          setDocuments(response.items);
        }
      })
      .catch(() => {
        if (active) {
          setError(copy.loadError);
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [copy.loadError]);

  const refresh = async () => {
    setRefreshNotice(null);
    await Promise.all([reload(), onDocumentChanged()]);
  };

  const manualRefresh = async () => {
    if (refreshing) {
      return;
    }
    setRefreshing(true);
    setRefreshNotice(null);
    setError(null);
    const [documentResult, profileResult] = await Promise.allSettled([
      reload(),
      onDocumentChanged(),
    ]);
    if (documentResult.status === 'rejected') {
      setError(copy.loadError);
    } else if (profileResult.status === 'rejected') {
      setError(copy.profileRefreshError);
    } else {
      setRefreshNotice(copy.refreshSuccess);
    }
    setRefreshing(false);
  };

  return (
    <section className="mt-6" aria-labelledby="tutor-qualification-title">
      <PaperCard className="relative p-5 sm:p-7">
        <WashiTape tone="blue" className="-top-2 left-9 rotate-2" />
        <div className="flex flex-col gap-2 border-b border-dashed border-paper-edge pb-5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div>
            <h2
              id="tutor-qualification-title"
              className="font-note text-2xl font-bold text-notebook-ink"
            >
              {copy.title}
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-notebook-muted">{copy.intro}</p>
          </div>
          <p className="text-xs font-semibold text-notebook-muted sm:max-w-40 sm:text-right">
            {copy.multipleHint}
          </p>
        </div>
        <div className="mt-5 grid items-start gap-5 min-[1061px]:grid-cols-[minmax(260px,.75fr)_minmax(0,1.25fr)]">
          <QualificationUploader documents={documents} copy={copy} onUploaded={refresh} />
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="font-bold text-notebook-ink">{copy.documentListTitle}</h3>
              <button
                type="button"
                disabled={loading || refreshing}
                aria-busy={refreshing}
                className="min-h-11 text-sm font-bold text-tutor-deep underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-wait disabled:opacity-60"
                onClick={() => void manualRefresh()}
              >
                {refreshing ? copy.refreshing : copy.refresh}
              </button>
            </div>
            {loading ? (
              <p role="status">{copy.loading}</p>
            ) : (
              <DocumentStatusList documents={documents} copy={copy} language={language} />
            )}
            {error && (
              <p className="mt-2 text-sm text-red-800" role="alert">
                {error}
              </p>
            )}
            {refreshNotice && (
              <p className="mt-2 text-sm text-tutor-deep" role="status">
                {refreshNotice}
              </p>
            )}
          </div>
        </div>
      </PaperCard>
    </section>
  );
}
