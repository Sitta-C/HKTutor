'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { tutorSearchCopy } from '@/components/tutors/tutor-search-copy';
import {
  formatTutorSearchSummary,
  initialTutorSearchForm,
  toTutorSearchQuery,
  tutorRatingOptions,
  validateTutorSearch,
} from '@/components/tutors/tutor-search-model';
import {
  GraphPaper,
  NotebookHeading,
  PaperCard,
  StatusBadge,
  WashiTape,
  notebookButtonClass,
  notebookInputClass,
} from '@/components/ui/notebook';
import { NotebookLoadingRegion } from '@/components/ui/notebook-loading';
import {
  TUTOR_SEARCH_PAGE_SIZE,
  getGradeLevelCatalog,
  getSubjectCatalog,
  searchTutors,
} from '@/lib/api/tutors';
import { formatBangkokDateTime } from '@/lib/date-time';
import { useLanguage } from '@/lib/i18n';

import type { TutorSearchCopy } from '@/components/tutors/tutor-search-copy';
import type { TutorSearchErrors, TutorSearchForm } from '@/components/tutors/tutor-search-model';
import type {
  GradeLevelOption,
  SubjectOption,
  TutorSearchQuery,
  TutorSearchResult,
  TutorSearchResponse,
} from '@/lib/api/types';
import type { FormEvent } from 'react';

type SearchStatus = 'loading' | 'success' | 'error' | 'validation';
const initialPagination: Pick<TutorSearchResponse, 'page' | 'pageSize' | 'total' | 'totalPages'> = {
  page: 1,
  pageSize: TUTOR_SEARCH_PAGE_SIZE,
  total: 0,
  totalPages: 0,
};

export default function TutorSearchPage() {
  const { language } = useLanguage();
  const text = tutorSearchCopy[language];
  const [form, setForm] = useState<TutorSearchForm>(initialTutorSearchForm);
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [gradeLevels, setGradeLevels] = useState<GradeLevelOption[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState(false);
  const [results, setResults] = useState<TutorSearchResult[]>([]);
  const [pagination, setPagination] = useState(initialPagination);
  const [activeQuery, setActiveQuery] = useState<TutorSearchQuery>({
    page: 1,
    pageSize: TUTOR_SEARCH_PAGE_SIZE,
  });
  const [status, setStatus] = useState<SearchStatus>('loading');
  const [hasSearchError, setHasSearchError] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<TutorSearchErrors>({});
  const requestId = useRef(0);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;

    Promise.all([getSubjectCatalog(), getGradeLevelCatalog()])
      .then(([subjectOptions, gradeOptions]) => {
        if (!active) return;
        setSubjects(subjectOptions);
        setGradeLevels(gradeOptions);
        setCatalogError(false);
      })
      .catch(() => {
        if (active) setCatalogError(true);
      })
      .finally(() => {
        if (active) setCatalogLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const executeSearch = useCallback(async (query: TutorSearchQuery) => {
    const paginatedQuery = {
      ...query,
      page: query.page ?? 1,
      pageSize: query.pageSize ?? TUTOR_SEARCH_PAGE_SIZE,
    };
    const currentRequest = ++requestId.current;
    controller.current?.abort();
    const nextController = new AbortController();
    controller.current = nextController;
    setStatus('loading');
    setHasSearchError(false);
    setResults([]);
    setActiveQuery(paginatedQuery);

    try {
      const response = await searchTutors(paginatedQuery, { signal: nextController.signal });
      if (currentRequest !== requestId.current) return;
      setResults(response.items);
      setPagination({
        page: response.page,
        pageSize: response.pageSize,
        total: response.total,
        totalPages: response.totalPages,
      });
      setStatus('success');
    } catch {
      if (nextController.signal.aborted || currentRequest !== requestId.current) return;
      setResults([]);
      setPagination(initialPagination);
      setStatus('error');
      setHasSearchError(true);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const loadInitialResults = async () => {
      await Promise.resolve();
      if (active) {
        await executeSearch({ page: 1, pageSize: TUTOR_SEARCH_PAGE_SIZE });
      }
    };

    void loadInitialResults();
    return () => {
      active = false;
      requestId.current += 1;
      controller.current?.abort();
    };
  }, [executeSearch]);

  const updateField = <Key extends keyof TutorSearchForm>(
    key: Key,
    value: TutorSearchForm[Key],
  ) => {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: undefined }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validation = validateTutorSearch(form, text);
    setFieldErrors(validation);
    setHasSearchError(false);
    if (Object.keys(validation).length > 0) {
      requestId.current += 1;
      controller.current?.abort();
      setResults([]);
      setStatus('validation');
      return;
    }

    setFieldErrors({});
    void executeSearch({
      ...toTutorSearchQuery(form),
      page: 1,
      pageSize: TUTOR_SEARCH_PAGE_SIZE,
    });
  };

  const clearFilters = () => {
    setForm(initialTutorSearchForm);
    setFieldErrors({});
    void executeSearch({ page: 1, pageSize: TUTOR_SEARCH_PAGE_SIZE });
  };

  const changePage = (page: number) => {
    if (page < 1 || page > pagination.totalPages || page === pagination.page) return;
    void executeSearch({ ...activeQuery, page });
  };

  const filterCount = [form.subject, form.grade, form.maxPrice, form.minimumRating].filter(
    Boolean,
  ).length;
  const resultSummary = formatTutorSearchSummary(form, text);

  return (
    <div className="mx-auto max-w-[1120px] py-8 lg:py-10">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <NotebookHeading eyebrow={text.eyebrow} title={text.title} description={text.subtitle} />
        <StatusBadge tone="student" className="mb-1">
          <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-student-deep" aria-hidden="true" />
          {text.student}
        </StatusBadge>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)]">
        <PaperCard
          id="tutor-search-filters"
          className="relative h-fit overflow-hidden p-5 shadow-[0_8px_20px_-12px_rgba(46,39,25,0.1)] sm:p-6"
        >
          <WashiTape tone="yellow" className="-left-5 -top-2 -rotate-12" />
          <div className="relative z-10 mb-5 flex items-start justify-between gap-3">
            <div>
              <h2 className="font-note text-2xl font-bold tracking-[-0.03em]">{text.filters}</h2>
              <p className="mt-1 text-sm text-notebook-muted">{text.filtersHint}</p>
            </div>
            <StatusBadge tone="student">{filterCount}</StatusBadge>
          </div>

          {catalogLoading && (
            <NotebookLoadingRegion label={text.loadingCatalog} presentation="text" />
          )}
          {catalogError && (
            <p
              className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"
              role="alert"
            >
              {text.catalogError}
            </p>
          )}

          <form className="space-y-5" onSubmit={handleSubmit} noValidate>
            <SelectField
              id="tutor-search-subject"
              label={text.subject}
              value={form.subject}
              onChange={(value) => updateField('subject', value)}
              options={subjects.map((item) => ({ label: item.name, value: item.name }))}
              placeholder={text.allSubjects}
              disabled={catalogLoading || catalogError}
              error={fieldErrors.subject}
            />
            <SelectField
              id="tutor-search-grade"
              label={text.grade}
              value={form.grade}
              onChange={(value) => updateField('grade', value)}
              options={gradeLevels.map((item) => ({ label: item.name, value: item.name }))}
              placeholder={text.allGrades}
              disabled={catalogLoading || catalogError}
              error={fieldErrors.grade}
            />
            <NumberField
              id="tutor-search-max-price"
              label={text.maxPrice}
              value={form.maxPrice}
              onChange={(value) => updateField('maxPrice', value)}
              min="0"
              step="50"
              hint={text.maxPriceHint}
              error={fieldErrors.maxPrice}
            />
            <SelectField
              id="tutor-search-min-rating"
              label={text.minimumRating}
              value={form.minimumRating}
              onChange={(value) => updateField('minimumRating', value)}
              options={tutorRatingOptions.map((value) => ({
                label: `${value.toFixed(1)}+`,
                value: String(value),
              }))}
              placeholder={text.anyRating}
              hint={text.ratingHint}
              error={fieldErrors.minimumRating}
            />
            <div className="flex flex-wrap gap-3 pt-1">
              <button
                type="submit"
                className={notebookButtonClass()}
                disabled={status === 'loading'}
              >
                {text.apply}
              </button>
              <button
                type="button"
                className={notebookButtonClass({ tone: 'secondary' })}
                onClick={clearFilters}
              >
                {text.clear}
              </button>
            </div>
          </form>
        </PaperCard>

        <section aria-live="polite">
          <PaperCard className="relative overflow-hidden shadow-[0_8px_20px_-12px_rgba(46,39,25,0.1)]">
            <WashiTape tone="pink" className="-right-5 top-3 rotate-12" />
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-dashed border-paper-edge px-5 py-5 sm:px-6">
              <div>
                <h2 className="font-note text-3xl font-bold tracking-[-0.04em]">
                  {status === 'success' ? pagination.total : '—'} {text.exactMatches}
                </h2>
                <p className="mt-1 text-sm text-notebook-muted">{resultSummary}</p>
                {status === 'loading' && (
                  <p className="mt-1 text-sm text-notebook-muted">{text.loading}</p>
                )}
              </div>
              <StatusBadge tone="student" className="tracking-[0.08em]">
                {text.verifiedOnly}
              </StatusBadge>
            </div>

            <div className="space-y-4 p-5 sm:p-6">
              {status === 'error' && hasSearchError && (
                <SearchState tone="error" message={text.searchError} />
              )}
              {status === 'validation' && (
                <SearchState tone="error" message={text.validationError} />
              )}
              {status === 'loading' && <SearchState tone="loading" message={text.loading} />}
              {status === 'success' && results.length === 0 && (
                <SearchState
                  tone="empty"
                  message={text.noMatches}
                  hint={text.noMatchesHint}
                  clearLabel={text.clearAllFilters}
                  onClear={clearFilters}
                />
              )}
              {status === 'success' &&
                results.length > 0 &&
                results.map((result) => (
                  <TutorResultCard
                    key={result.listingId}
                    result={result}
                    text={text}
                    language={language}
                  />
                ))}
              {status === 'success' && pagination.totalPages > 1 && (
                <nav
                  className="flex flex-wrap items-center justify-between gap-3 border-t border-dashed border-paper-edge pt-5"
                  aria-label={`${text.page} ${pagination.page} ${text.pageOf} ${pagination.totalPages}`}
                >
                  <button
                    type="button"
                    className={notebookButtonClass({ tone: 'secondary' })}
                    disabled={pagination.page <= 1}
                    onClick={() => changePage(pagination.page - 1)}
                  >
                    {text.previousPage}
                  </button>
                  <span className="text-sm font-extrabold text-notebook-muted" aria-current="page">
                    {text.page} {pagination.page} {text.pageOf} {pagination.totalPages}
                  </span>
                  <button
                    type="button"
                    className={notebookButtonClass({ tone: 'secondary' })}
                    disabled={pagination.page >= pagination.totalPages}
                    onClick={() => changePage(pagination.page + 1)}
                  >
                    {text.nextPage}
                  </button>
                </nav>
              )}
            </div>
          </PaperCard>
        </section>
      </div>
    </div>
  );
}

function SelectField({
  id,
  label,
  value,
  onChange,
  options,
  placeholder,
  hint,
  disabled = false,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { label: string; value: string }[];
  placeholder: string;
  hint?: string | undefined;
  disabled?: boolean | undefined;
  error?: string | undefined;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-extrabold text-notebook-ink">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className={notebookInputClass({ error: Boolean(error), className: 'pr-10' })}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint && !error && (
        <p id={`${id}-hint`} className="mt-1.5 text-xs leading-5 text-notebook-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-xs leading-5 text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

function NumberField({
  id,
  label,
  value,
  onChange,
  min,
  step,
  hint,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  min: string;
  step: string;
  hint?: string | undefined;
  error?: string | undefined;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-extrabold text-notebook-ink">
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={min}
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={notebookInputClass({ error: Boolean(error) })}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
      />
      {hint && !error && (
        <p id={`${id}-hint`} className="mt-1.5 text-xs leading-5 text-notebook-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-xs leading-5 text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

function TutorResultCard({
  result,
  text,
  language,
}: {
  result: TutorSearchResult;
  text: TutorSearchCopy;
  language: 'en' | 'th';
}) {
  const rating =
    result.ratingAverage === null ? text.newTutor : `★ ${result.ratingAverage.toFixed(1)}`;
  const nextAvailable = result.nextAvailableAt
    ? `${text.next}: ${formatNextAvailable(result.nextAvailableAt, language)}`
    : text.noFutureSlots;

  return (
    <article className="relative flex flex-col gap-5 overflow-hidden rounded-[1.35rem] border border-paper-edge bg-paper p-5 shadow-[0_6px_16px_-12px_rgba(46,39,25,0.18)] transition hover:-translate-y-0.5 hover:shadow-[0_10px_22px_-14px_rgba(46,39,25,0.2)] sm:p-6 lg:flex-row lg:items-center">
      <WashiTape tone="blue" className="-right-7 top-2 rotate-12 opacity-60" />
      <div className="flex min-w-0 flex-1 gap-4">
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-student-deep text-lg font-black text-white shadow-sm"
          aria-hidden="true"
        >
          {getInitials(result.displayName)}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-lg font-extrabold text-notebook-ink">
              {result.displayName}
            </h3>
            <StatusBadge tone="student" className="text-[0.65rem] tracking-[0.08em]">
              {text.verified}
            </StatusBadge>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold text-notebook-muted">
            <span>{rating}</span>
            <span>
              {result.reviewCount} {text.reviews}
            </span>
            <span>
              {result.experienceYears} {text.years}
            </span>
            <span>{nextAvailable}</span>
          </div>
          <p className="mt-3 text-sm font-extrabold text-notebook-ink">
            {result.subject} · {result.grade}
          </p>
          <p className="mt-1.5 line-clamp-2 text-sm leading-6 text-notebook-muted">
            {result.description}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-between gap-4 border-t border-dashed border-paper-edge pt-4 lg:flex-col lg:items-end lg:border-t-0 lg:pt-0">
        <strong className="text-xl font-black text-notebook-ink">
          {formatPrice(result.pricePerHour, language)} ฿
          <span className="text-xs font-bold text-notebook-muted">/{text.hour}</span>
        </strong>
        <Link
          href={`/tutors/${encodeURIComponent(result.tutorId)}?listingId=${encodeURIComponent(result.listingId)}`}
          className={notebookButtonClass()}
        >
          {text.viewTimes}
        </Link>
      </div>
    </article>
  );
}

function SearchState({
  tone,
  message,
  hint,
  clearLabel,
  onClear,
}: {
  tone: 'loading' | 'empty' | 'error';
  message: string;
  hint?: string | undefined;
  clearLabel?: string | undefined;
  onClear?: (() => void) | undefined;
}) {
  if (tone === 'loading') return <NotebookLoadingRegion label={message} />;
  return (
    <GraphPaper
      className={`p-10 text-center ${
        tone === 'error'
          ? 'border-red-200 bg-red-50 text-red-800'
          : tone === 'empty'
            ? 'border-dashed text-notebook-ink'
            : 'text-notebook-muted'
      }`}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <p className="text-base font-extrabold">{message}</p>
      {hint && <p className="mt-2 text-sm text-notebook-muted">{hint}</p>}
      {clearLabel && onClear && (
        <button
          type="button"
          className={notebookButtonClass({ tone: 'secondary', className: 'mt-4' })}
          onClick={onClear}
        >
          {clearLabel}
        </button>
      )}
    </GraphPaper>
  );
}

function getInitials(displayName: string): string {
  const initials = displayName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('');
  return initials.toUpperCase() || 'T';
}

function formatPrice(price: number, language: 'en' | 'th'): string {
  return new Intl.NumberFormat(language === 'th' ? 'th-TH' : 'en-US', {
    maximumFractionDigits: 2,
  }).format(price);
}

function formatNextAvailable(value: string, language: 'en' | 'th'): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return formatBangkokDateTime(date, language);
}
