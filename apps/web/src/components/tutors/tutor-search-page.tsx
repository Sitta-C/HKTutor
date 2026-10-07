'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { DashboardIcon } from '@/components/dashboard/dashboard-icon';
import { ProfileAvatar } from '@/components/profile/profile-avatar';
import { tutorSearchCopy } from '@/components/tutors/tutor-search-copy';
import {
  formatTutorSearchSummary,
  initialTutorSearchForm,
  toTutorSearchQuery,
  tutorRatingOptions,
  validateTutorSearch,
} from '@/components/tutors/tutor-search-model';
import {
  NotebookHeading,
  PaperCard,
  StatusBadge,
  notebookButtonClass,
  notebookInputClass,
} from '@/components/ui/notebook';
import { NotebookLoadingRegion } from '@/components/ui/notebook-loading';
import { NotebookSelect } from '@/components/ui/notebook-select';
import {
  TUTOR_SEARCH_PAGE_SIZE,
  getGradeLevelCatalog,
  getSubjectCatalog,
  searchTutors,
} from '@/lib/api/tutors';
import { formatBangkokDateTime } from '@/lib/date-time';
import { useLanguage } from '@/lib/i18n';

import styles from './tutor-search-page.module.css';

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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterToggle = useRef<HTMLButtonElement>(null);
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
      setFiltersOpen(true);
      const filterForm = event.currentTarget;
      requestAnimationFrame(() => {
        filterForm.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      });
      return;
    }

    setFieldErrors({});
    setFiltersOpen(false);
    if (filterToggle.current?.offsetParent !== null) {
      filterToggle.current?.focus();
    }
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
    <div className={styles.page}>
      <NotebookHeading
        eyebrow={text.eyebrow}
        title={text.title}
        description={text.subtitle}
        className={styles.heading ?? ''}
      />

      <div className={styles.layout}>
        <PaperCard id="tutor-search-filters" className={styles.filters}>
          <div className={styles.filterHeading}>
            <h2>{text.filters}</h2>
            <StatusBadge tone="student" className={styles.tag ?? ''}>
              {filterCount}
            </StatusBadge>
            <button
              type="button"
              className={styles.filterToggle}
              ref={filterToggle}
              aria-expanded={filtersOpen}
              aria-controls="tutor-search-filter-fields"
              onClick={() => setFiltersOpen((open) => !open)}
            >
              {filtersOpen ? text.hideFilters : text.showFilters}
              <span aria-hidden="true">{filtersOpen ? '−' : '+'}</span>
            </button>
          </div>
          <div
            id="tutor-search-filter-fields"
            className={styles.filterBody}
            data-open={filtersOpen}
          >
            <p className={styles.filterHint}>{text.filtersHint}</p>
            {catalogLoading && (
              <NotebookLoadingRegion label={text.loadingCatalog} presentation="text" />
            )}
            {catalogError && (
              <p className={styles.catalogError} role="alert">
                {text.catalogError}
              </p>
            )}
            <form className={styles.form} onSubmit={handleSubmit} noValidate>
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
              <div className={styles.filterActions}>
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
          </div>
        </PaperCard>

        <PaperCard className={styles.results} aria-live="polite" aria-busy={status === 'loading'}>
          <div className={styles.resultHeading}>
            <div>
              <h2>
                {status === 'success' ? pagination.total : '—'} {text.exactMatches}
              </h2>
              <p>{resultSummary}</p>
            </div>
            <StatusBadge tone="student" className={styles.tag ?? ''}>
              {text.verifiedOnly}
            </StatusBadge>
          </div>
          <div className={styles.resultBody}>
            {status === 'error' && hasSearchError && (
              <SearchState tone="error" message={text.searchError} />
            )}
            {status === 'validation' && <SearchState tone="error" message={text.validationError} />}
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
              results.map((result) => (
                <TutorResultCard
                  key={result.listingId}
                  result={result}
                  text={text}
                  language={language}
                />
              ))}
          </div>
          {status === 'success' && pagination.totalPages > 1 && (
            <nav
              className={styles.pagination}
              aria-label={`${text.page} ${pagination.page} ${text.pageOf} ${pagination.totalPages}`}
            >
              <span className={styles.paginationCount} aria-current="page" aria-live="polite">
                {text.page} {pagination.page} {text.pageOf} {pagination.totalPages}
              </span>
              <div className={styles.paginationTickets}>
                <button
                  type="button"
                  className={styles.paginationButton}
                  disabled={pagination.page <= 1}
                  onClick={() => changePage(pagination.page - 1)}
                >
                  <DashboardIcon name="arrow-right" className="h-4 w-4 rotate-180" />
                  <span>{text.previousPage}</span>
                </button>
                <button
                  type="button"
                  className={styles.paginationButton}
                  disabled={pagination.page >= pagination.totalPages}
                  onClick={() => changePage(pagination.page + 1)}
                >
                  <span>{text.nextPage}</span>
                  <DashboardIcon name="arrow-right" className="h-4 w-4" />
                </button>
              </div>
            </nav>
          )}
          <p className={styles.resultNote}>{text.cardNote}</p>
        </PaperCard>
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
      <NotebookSelect
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </NotebookSelect>
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
    <article className={styles.course}>
      <div className={styles.tutor}>
        <div className={styles.identity}>
          <ProfileAvatar
            name={result.displayName}
            publicTutorId={result.tutorId}
            avatarUpdatedAt={result.avatarUpdatedAt}
            fallback={getInitials(result.displayName)}
            sizes="34px"
            className={styles.avatar ?? ''}
          />
          <div className={styles.name}>
            <h3>{result.displayName}</h3>
            <StatusBadge tone="student" className={styles.tag ?? ''}>
              {text.verified}
            </StatusBadge>
          </div>
        </div>
        <div className={styles.metadata}>
          <span>
            {rating} · {result.reviewCount} {text.reviews}
          </span>
          <span>
            {result.experienceYears} {text.years}
          </span>
        </div>
      </div>
      <div className={styles.courseTitle}>
        <span className={styles.grade}>{result.grade}</span>
        <h4>{result.subject}</h4>
      </div>
      <div className={styles.price}>
        <strong>{formatPrice(result.pricePerHour, language)} ฿</strong>
        <span>/{text.hour}</span>
      </div>
      <p className={styles.description}>{result.description}</p>
      <p className={styles.availability}>{nextAvailable}</p>
      <Link
        href={`/tutors/${encodeURIComponent(result.tutorId)}?listingId=${encodeURIComponent(result.listingId)}`}
        className={notebookButtonClass({ className: styles.courseAction })}
      >
        {text.viewTimes}
      </Link>
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
    <div
      className={`${styles.state} ${tone === 'error' ? styles.stateError : ''}`}
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
    </div>
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
