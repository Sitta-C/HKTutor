'use client';

import { useEffect, useState } from 'react';

import {
  qualificationErrorKind,
  signedUrlIsExpired,
} from '@/components/qualifications/qualification-model';
import { formatBangkokDateTime } from '@/lib/date-time';

import type { QualificationCopy } from '@/components/qualifications/qualification-copy';
import type { QualificationSignedUrlResponse } from '@/lib/api/types';
import type { DateTimeLanguage } from '@/lib/date-time';

interface DocumentPreviewProps {
  documentId: string;
  language: DateTimeLanguage;
  copy: QualificationCopy;
  loadSignedUrl: (documentId: string) => Promise<QualificationSignedUrlResponse>;
}

export function DocumentPreview({
  documentId,
  language,
  copy,
  loadSignedUrl,
}: DocumentPreviewProps) {
  const [link, setLink] = useState<QualificationSignedUrlResponse | null>(null);
  const [error, setError] = useState<'expired' | 'denied' | 'missing' | 'other' | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!link) {
      return;
    }
    let timeout: number;
    const scheduleExpiry = () => {
      const remaining = Date.parse(link.expiresAt) - Date.now() - 5000;
      if (remaining <= 0) {
        setLink(null);
        setError('expired');
        return;
      }
      timeout = window.setTimeout(scheduleExpiry, Math.min(remaining, 2_147_483_647));
    };
    scheduleExpiry();
    return () => window.clearTimeout(timeout);
  }, [link]);

  const requestLink = async () => {
    setLoading(true);
    setError(null);
    setLink(null);
    try {
      const result = await loadSignedUrl(documentId);
      if (signedUrlIsExpired(result.expiresAt)) {
        setError('expired');
      } else {
        setLink(result);
      }
    } catch (caught) {
      const kind = qualificationErrorKind(caught);
      setError(kind === 'denied' || kind === 'missing' ? kind : 'other');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-w-0 text-sm">
      {link ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <a
            className="font-bold text-tutor-deep underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {copy.previewReady}
          </a>
          <span className="text-xs text-notebook-muted">
            {copy.previewExpiry}: {formatBangkokDateTime(link.expiresAt, language)}
          </span>
          <button
            type="button"
            className="min-h-11 font-bold text-tutor-deep underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
            onClick={() => void requestLink()}
          >
            {copy.previewRetry}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="min-h-11 font-bold text-tutor-deep underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50"
          disabled={loading}
          onClick={() => void requestLink()}
        >
          {loading ? copy.previewLoading : error ? copy.previewRetry : copy.preview}
        </button>
      )}
      {error && (
        <p className="mt-1 text-sm text-red-800" role="alert">
          {error === 'expired'
            ? copy.previewExpired
            : error === 'denied'
              ? copy.previewDenied
              : error === 'missing'
                ? copy.previewMissing
                : copy.previewError}
        </p>
      )}
      {link && <p className="mt-1 text-xs text-notebook-muted">{copy.previewHelp}</p>}
    </div>
  );
}
