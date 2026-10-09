'use client';

import { useRef, useState } from 'react';

import {
  canUploadType,
  qualificationErrorKind,
  validateQualificationFile,
} from '@/components/qualifications/qualification-model';
import { NotebookAction } from '@/components/ui/notebook-action';
import { uploadQualification } from '@/lib/api/qualifications';

import type { QualificationCopy } from '@/components/qualifications/qualification-copy';
import type { QualificationListItem } from '@/lib/api/qualifications';
import type { QualificationDocumentType } from '@/lib/api/types';
import type { FormEvent } from 'react';

interface QualificationUploaderProps {
  documents: QualificationListItem[];
  copy: QualificationCopy;
  onUploaded: () => Promise<void>;
}

function formatSelectedFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.ceil(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function QualificationUploader({ documents, copy, onUploaded }: QualificationUploaderProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [type, setType] = useState<QualificationDocumentType>('DEGREE');
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) {
      return;
    }
    setError(null);
    setSuccess(false);
    if (!file) {
      setError(copy.selectFile);
      return;
    }
    const fileError = validateQualificationFile(file);
    if (fileError) {
      setError(copy.fileErrors[fileError]);
      return;
    }
    if (!canUploadType(documents, type)) {
      setError(copy.pendingType);
      return;
    }

    setBusy(true);
    setProgress(0);
    try {
      await uploadQualification(file, type, setProgress);
      setFile(null);
      if (fileInput.current) {
        fileInput.current.value = '';
      }
      setSuccess(true);
      try {
        await onUploaded();
      } catch {
        setError(copy.loadError);
      }
    } catch (caught) {
      if (qualificationErrorKind(caught) === 'conflict') {
        setError(copy.uploadConflict);
        try {
          await onUploaded();
        } catch {
          setError(copy.loadError);
        }
      } else {
        setError(copy.uploadError);
      }
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <form className="min-w-0" onSubmit={(event) => void submit(event)}>
      <label
        htmlFor="qualification-type"
        className="mb-2 block text-sm font-bold text-notebook-ink"
      >
        {copy.typeLabel}
      </label>
      <select
        id="qualification-type"
        className="mb-3 min-h-11 w-full rounded-lg border border-paper-edge bg-paper px-3 text-notebook-ink focus-visible:outline-2 focus-visible:outline-tutor-deep"
        value={type}
        disabled={busy}
        onChange={(event) => {
          setType(event.target.value === 'CERTIFICATE' ? 'CERTIFICATE' : 'DEGREE');
          setError(null);
        }}
      >
        <option value="DEGREE">{copy.types.DEGREE}</option>
        <option value="CERTIFICATE">{copy.types.CERTIFICATE}</option>
      </select>
      <div className="group relative">
        <input
          ref={fileInput}
          id="qualification-file"
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
          className="sr-only"
          disabled={busy}
          onChange={(event) => {
            const selected = event.target.files?.[0] ?? null;
            setFile(selected);
            const issue = selected ? validateQualificationFile(selected) : null;
            setError(issue ? copy.fileErrors[issue] : null);
            setSuccess(false);
          }}
        />
        <label
          htmlFor="qualification-file"
          className={`flex min-h-[170px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-paper-edge bg-paper px-5 py-6 text-center transition-colors group-focus-within:border-tutor-deep group-focus-within:outline-2 group-focus-within:outline-offset-2 group-focus-within:outline-tutor-deep ${busy ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-tutor-deep hover:bg-sticky-blue/20'}`}
        >
          <span
            aria-hidden="true"
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-sticky-blue text-2xl font-bold text-tutor-deep"
          >
            ↑
          </span>
          <strong className="mt-3 text-sm text-notebook-ink">{copy.chooseFile}</strong>
          <span className="mt-1 text-xs leading-5 text-notebook-muted">{copy.fileLabel}</span>
        </label>
      </div>
      {file && (
        <div className="mt-3 flex min-w-0 items-center gap-3 rounded-xl border border-paper-edge bg-paper p-3">
          <span
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sticky-blue/50 text-[10px] font-extrabold text-tutor-deep"
          >
            {file.type === 'application/pdf'
              ? 'PDF'
              : file.type === 'image/jpeg'
                ? 'JPG'
                : file.type === 'image/png'
                  ? 'PNG'
                  : 'FILE'}
          </span>
          <div className="min-w-0 flex-1">
            <span className="block text-xs text-notebook-muted">{copy.selectedFile}</span>
            <strong className="block truncate text-sm text-notebook-ink" title={file.name}>
              {file.name}
            </strong>
            <span className="text-xs text-notebook-muted">{formatSelectedFileSize(file.size)}</span>
          </div>
          <button
            type="button"
            disabled={busy}
            aria-label={copy.removeSelection}
            className="min-h-11 min-w-11 rounded-lg text-xl text-notebook-muted focus-visible:outline-2 focus-visible:outline-tutor-deep disabled:opacity-50"
            onClick={() => {
              setFile(null);
              setError(null);
              if (fileInput.current) {
                fileInput.current.value = '';
              }
            }}
          >
            ×
          </button>
        </div>
      )}
      {busy && (
        <div className="mt-3" role="status" aria-live="polite">
          <p className="text-sm font-semibold text-tutor-deep">
            {copy.uploading}: {progress ?? 0}%
          </p>
          <progress className="mt-1 h-2 w-full accent-tutor-deep" value={progress ?? 0} max={100} />
        </div>
      )}
      {error && (
        <p className="mt-3 text-sm text-red-800" role="alert">
          {error}
        </p>
      )}
      {success && !error && (
        <p className="mt-3 text-sm text-emerald-900" role="status">
          {copy.uploadSuccess}
        </p>
      )}
      <NotebookAction
        className="mt-4"
        type="submit"
        disabled={busy || !canUploadType(documents, type)}
      >
        {busy ? copy.uploading : copy.upload}
      </NotebookAction>
      {!canUploadType(documents, type) && (
        <p className="mt-2 text-sm text-amber-900">{copy.pendingType}</p>
      )}
    </form>
  );
}
