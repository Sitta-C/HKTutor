import { DocumentPreview } from '@/components/qualifications/document-preview';
import { getMyQualificationSignedUrl } from '@/lib/api/qualifications';
import { formatBangkokDateTime } from '@/lib/date-time';

import type { QualificationCopy } from '@/components/qualifications/qualification-copy';
import type { QualificationListItem } from '@/lib/api/qualifications';
import type { DateTimeLanguage } from '@/lib/date-time';

interface DocumentStatusListProps {
  documents: QualificationListItem[];
  copy: QualificationCopy;
  language: DateTimeLanguage;
}

const statusStyle = {
  PENDING: 'border-amber-300 bg-sticky-yellow text-amber-950',
  APPROVED: 'border-emerald-300 bg-sticky-green text-emerald-950',
  REJECTED: 'border-red-300 bg-red-50 text-red-900',
};

export function DocumentStatusList({ documents, copy, language }: DocumentStatusListProps) {
  if (documents.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-paper-edge p-4 text-notebook-muted">
        {copy.empty}
      </p>
    );
  }

  return (
    <ul className="space-y-2.5">
      {documents.map((document) => (
        <li
          className="min-w-0 rounded-xl border border-paper-edge bg-paper p-3 sm:p-4"
          key={document.documentId}
        >
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sticky-blue/50 text-[10px] font-extrabold text-tutor-deep"
            >
              {document.type === 'DEGREE'
                ? 'DEG'
                : document.type === 'CERTIFICATE'
                  ? 'CERT'
                  : 'DOC'}
            </span>
            <div className="min-w-0 flex-1">
              <strong className="block break-words text-sm text-notebook-ink">
                {document.type === 'DEGREE' || document.type === 'CERTIFICATE'
                  ? copy.types[document.type]
                  : copy.unknownType}
              </strong>
              {document.reviewedAt && (
                <span className="block text-xs text-notebook-muted">
                  {copy.reviewedAt}: {formatBangkokDateTime(document.reviewedAt, language)}
                </span>
              )}
            </div>
            <span
              className={`rounded-full border px-2.5 py-1 text-xs font-bold ${statusStyle[document.status]}`}
            >
              {copy.status[document.status]}
            </span>
          </div>
          {document.status === 'REJECTED' && document.rejectionReason && (
            <p className="mt-3 rounded-md bg-red-50 p-2 text-sm text-red-900">
              <strong>{copy.rejectionReason}:</strong> {document.rejectionReason}
            </p>
          )}
          <div className="mt-2 pl-0 sm:pl-12">
            <DocumentPreview
              key={document.documentId}
              documentId={document.documentId}
              language={language}
              copy={copy}
              loadSignedUrl={getMyQualificationSignedUrl}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
