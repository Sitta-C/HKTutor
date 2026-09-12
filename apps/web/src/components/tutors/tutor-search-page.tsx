'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '@/lib/api/error';
import { getGradeLevelCatalog, getSubjectCatalog, searchTutors } from '@/lib/api/tutors';
import { useLanguage } from '@/lib/i18n';

import type {
  GradeLevelOption,
  SubjectOption,
  TutorSearchQuery,
  TutorSearchResult,
} from '@/lib/api/types';
import type { FormEvent } from 'react';

type SearchStatus = 'loading' | 'success' | 'error' | 'validation';
type SearchForm = {
  subject: string;
  grade: string;
  maxPrice: string;
  minimumRating: string;
};
type SearchErrors = Partial<Record<keyof SearchForm, string>>;

const initialForm: SearchForm = {
  subject: '',
  grade: '',
  maxPrice: '',
  minimumRating: '',
};

const ratingOptions = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

const copy = {
  en: {
    eyebrow: 'Tutor search',
    title: 'Find an exact match',
    subtitle:
      'Filter published listings from verified tutors by subject, grade, maximum budget and minimum rating.',
    student: 'Student',
    filters: 'Filters',
    filtersHint: 'All selected filters are combined.',
    subject: 'Subject',
    allSubjects: 'All subjects',
    grade: 'Grade level',
    allGrades: 'All grades',
    maxPrice: 'Maximum budget (THB/hour)',
    maxPriceHint: 'The upper limit is inclusive.',
    minimumRating: 'Minimum rating',
    anyRating: 'Any rating',
    ratingHint: 'Tutors without a rating are excluded when a minimum is selected.',
    apply: 'Apply filters',
    clear: 'Clear',
    clearAllFilters: 'Clear all filters',
    exactMatches: 'exact matches',
    anySubject: 'Any subject',
    anyGrade: 'Any grade',
    anyBudget: 'Any budget',
    upTo: 'up to',
    ratingSummary: 'rating',
    verifiedOnly: 'VERIFIED ONLY',
    loading: 'Loading tutors…',
    loadingCatalog: 'Loading subjects and grade levels…',
    catalogError: 'Subject and grade options are temporarily unavailable.',
    searchError: 'We could not load tutors right now. Please try again.',
    validationError: 'Please check the highlighted filters.',
    noMatches: 'No exact matches found',
    noMatchesHint: 'Try clearing one or more filters to see other published Tutors.',
    years: 'years experience',
    newTutor: 'New tutor',
    reviews: 'reviews',
    noFutureSlots: 'No future slots',
    next: 'Next',
    hour: 'hour',
    viewTimes: 'View times',
    cardNote:
      "Each card represents one matching teaching listing. Prices and subjects are never mixed across a tutor's other listings.",
  },
  th: {
    eyebrow: 'ค้นหาติวเตอร์',
    title: 'ค้นหาติวเตอร์ที่ตรงกับคุณ',
    subtitle:
      'กรองคอร์สที่เผยแพร่จากติวเตอร์ที่ผ่านการตรวจสอบตามวิชา ระดับชั้น งบสูงสุด และคะแนนขั้นต่ำ',
    student: 'นักเรียน',
    filters: 'ตัวกรอง',
    filtersHint: 'ระบบจะใช้ตัวกรองที่เลือกทั้งหมดร่วมกัน',
    subject: 'วิชา',
    allSubjects: 'ทุกวิชา',
    grade: 'ระดับชั้น',
    allGrades: 'ทุกระดับชั้น',
    maxPrice: 'ราคาสูงสุด (บาท/ชั่วโมง)',
    maxPriceHint: 'ราคาที่เท่ากับค่าสูงสุดจะแสดงด้วย',
    minimumRating: 'คะแนนขั้นต่ำ',
    anyRating: 'ทุกคะแนน',
    ratingHint: 'ติวเตอร์ที่ยังไม่มีคะแนนจะไม่แสดงเมื่อเลือกคะแนนขั้นต่ำ',
    apply: 'ใช้ตัวกรอง',
    clear: 'ล้าง',
    clearAllFilters: 'ล้างตัวกรองทั้งหมด',
    exactMatches: 'ผลลัพธ์ที่ตรงกัน',
    anySubject: 'ทุกวิชา',
    anyGrade: 'ทุกระดับชั้น',
    anyBudget: 'ไม่จำกัดงบ',
    upTo: 'ไม่เกิน',
    ratingSummary: 'คะแนน',
    verifiedOnly: 'เฉพาะติวเตอร์ที่ยืนยันแล้ว',
    loading: 'กำลังโหลดข้อมูลติวเตอร์…',
    loadingCatalog: 'กำลังโหลดวิชาและระดับชั้น…',
    catalogError: 'ไม่สามารถโหลดตัวเลือกวิชาและระดับชั้นได้ชั่วคราว',
    searchError: 'ไม่สามารถโหลดข้อมูลติวเตอร์ได้ กรุณาลองใหม่อีกครั้ง',
    validationError: 'กรุณาตรวจสอบตัวกรองที่มีข้อความแจ้งเตือน',
    noMatches: 'ไม่พบผลลัพธ์ที่ตรงกัน',
    noMatchesHint: 'ลองล้างตัวกรองบางรายการเพื่อดูคอร์สอื่นที่เปิดสอน',
    years: 'ปีประสบการณ์',
    newTutor: 'ติวเตอร์ใหม่',
    reviews: 'รีวิว',
    noFutureSlots: 'ยังไม่มีเวลาว่างในอนาคต',
    next: 'ครั้งถัดไป',
    hour: 'ชั่วโมง',
    viewTimes: 'ดูเวลาว่าง',
    cardNote:
      'แต่ละการ์ดแทนหนึ่งคอร์สที่ตรงกับตัวกรอง ราคาและวิชาจะไม่ถูกนำมาปะปนกับคอร์สอื่นของติวเตอร์คนเดียวกัน',
  },
} as const;

type SearchCopy = { [Key in keyof (typeof copy)['en']]: string };

export default function TutorSearchPage() {
  const { language } = useLanguage();
  const text = copy[language];
  const [form, setForm] = useState<SearchForm>(initialForm);
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [gradeLevels, setGradeLevels] = useState<GradeLevelOption[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState(false);
  const [results, setResults] = useState<TutorSearchResult[]>([]);
  const [status, setStatus] = useState<SearchStatus>('loading');
  const [searchError, setSearchError] = useState<unknown | null>(null);
  const [fieldErrors, setFieldErrors] = useState<SearchErrors>({});
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
    const currentRequest = ++requestId.current;
    controller.current?.abort();
    const nextController = new AbortController();
    controller.current = nextController;
    setStatus('loading');
    setSearchError(null);
    setResults([]);

    try {
      const nextResults = await searchTutors(query, { signal: nextController.signal });
      if (currentRequest !== requestId.current) return;
      setResults(nextResults);
      setStatus('success');
    } catch (error: unknown) {
      if (nextController.signal.aborted || currentRequest !== requestId.current) return;
      setResults([]);
      setStatus('error');
      setSearchError(error);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const loadInitialResults = async () => {
      await Promise.resolve();
      if (active) await executeSearch({});
    };

    void loadInitialResults();
    return () => {
      active = false;
      requestId.current += 1;
      controller.current?.abort();
    };
  }, [executeSearch]);

  const updateField = <Key extends keyof SearchForm>(key: Key, value: SearchForm[Key]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: undefined }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validation = validateSearchForm(form, text);
    setFieldErrors(validation);
    setSearchError(null);
    if (Object.keys(validation).length > 0) {
      requestId.current += 1;
      controller.current?.abort();
      setResults([]);
      setStatus('validation');
      return;
    }

    setFieldErrors({});
    void executeSearch(toSearchQuery(form));
  };

  const clearFilters = () => {
    setForm(initialForm);
    setFieldErrors({});
    void executeSearch({});
  };

  const filterCount = [form.subject, form.grade, form.maxPrice, form.minimumRating].filter(
    Boolean,
  ).length;
  const resultSummary = formatSearchSummary(form, text);

  return (
    <main className="tutor-search-page text-[#171714]">
      <div className="mx-auto px-5 py-8 sm:px-8 lg:px-0 lg:py-10">
        <section className="mb-8 max-w-3xl">
          <p className="mb-2 text-xs font-extrabold uppercase tracking-[0.18em] text-[#c07a2e]">
            {text.eyebrow}
          </p>
          <h1 className="flex flex-wrap items-center gap-3 text-4xl font-black tracking-[-0.06em] sm:text-5xl">
            <span>{text.title}</span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-br from-[#3fd8b3] to-[#0c9a7c] px-3 py-1.5 text-xs font-extrabold tracking-[0.04em] text-white">
              <span className="h-1.5 w-1.5 rounded-full bg-[#eafff7]" aria-hidden="true" />
              {text.student}
            </span>
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-[#625b53]">{text.subtitle}</p>
        </section>

        <div className="grid gap-6 lg:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)]">
          <aside
            id="tutor-search-filters"
            className="h-fit rounded-[1.5rem] border border-[#ebe6dd] bg-white p-5 shadow-[0_18px_40px_-12px_rgba(46,39,25,0.14)] sm:p-6"
          >
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-extrabold tracking-[-0.03em]">{text.filters}</h2>
                <p className="mt-1 text-sm text-[#8a857b]">{text.filtersHint}</p>
              </div>
              <span className="rounded-full bg-[rgba(34,196,154,0.14)] px-2.5 py-1 text-xs font-extrabold text-[#0e8a73]">
                {filterCount}
              </span>
            </div>

            {catalogLoading && (
              <p className="mb-4 rounded-xl bg-[#f5f1e9] p-3 text-sm text-[#625b53]" role="status">
                {text.loadingCatalog}
              </p>
            )}
            {catalogError && (
              <p
                className="mb-4 rounded-xl border border-[#e2b7ae] bg-[#fff4f1] p-3 text-sm text-[#a34334]"
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
                options={ratingOptions.map((value) => ({
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
                  className="tutor-search-primary-button"
                  disabled={status === 'loading'}
                >
                  {text.apply}
                </button>
                <button
                  type="button"
                  className="tutor-search-secondary-button"
                  onClick={clearFilters}
                >
                  {text.clear}
                </button>
              </div>
            </form>
          </aside>

          <section aria-live="polite">
            <div className="overflow-hidden rounded-[1.5rem] border border-[#ebe6dd] bg-white shadow-[0_18px_40px_-12px_rgba(46,39,25,0.14)]">
              <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[#f0ebe3] px-5 py-5 sm:px-6">
                <div>
                  <h2 className="text-2xl font-extrabold tracking-[-0.04em]">
                    {status === 'success' ? results.length : '—'} {text.exactMatches}
                  </h2>
                  <p className="mt-1 text-sm text-[#8a857b]">{resultSummary}</p>
                  {status === 'loading' && (
                    <p className="mt-1 text-sm text-[#8a857b]">{text.loading}</p>
                  )}
                </div>
                <span className="rounded-full bg-[rgba(34,196,154,0.14)] px-3 py-1.5 text-xs font-extrabold tracking-[0.08em] text-[#0e8a73]">
                  {text.verifiedOnly}
                </span>
              </div>

              <div className="space-y-4 p-5 sm:p-6">
                {status === 'error' && (
                  <SearchState
                    tone="error"
                    message={
                      searchError === null
                        ? text.searchError
                        : readSearchError(searchError, text.searchError)
                    }
                  />
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
              </div>
            </div>
            <p className="px-2 py-3 text-xs leading-5 text-[#8a857b]">{text.cardNote}</p>
          </section>
        </div>
      </div>
    </main>
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
      <label htmlFor={id} className="mb-2 block text-sm font-extrabold text-[#332e28]">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className={`tutor-search-control ${error ? 'tutor-search-control-error' : ''}`}
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
        <p id={`${id}-hint`} className="mt-1.5 text-xs leading-5 text-[#8a857b]">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-xs leading-5 text-[#a34334]">
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
      <label htmlFor={id} className="mb-2 block text-sm font-extrabold text-[#332e28]">
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
        className={`tutor-search-control ${error ? 'tutor-search-control-error' : ''}`}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
      />
      {hint && !error && (
        <p id={`${id}-hint`} className="mt-1.5 text-xs leading-5 text-[#8a857b]">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-xs leading-5 text-[#a34334]">
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
  text: SearchCopy;
  language: 'en' | 'th';
}) {
  const rating =
    result.ratingAverage === null ? text.newTutor : `★ ${result.ratingAverage.toFixed(1)}`;
  const nextAvailable = result.nextAvailableAt
    ? `${text.next}: ${formatNextAvailable(result.nextAvailableAt, language)}`
    : text.noFutureSlots;

  return (
    <article className="flex flex-col gap-5 rounded-[1.35rem] border border-[#ebe6dd] bg-white p-5 shadow-[0_12px_28px_-16px_rgba(46,39,25,0.3)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_34px_-16px_rgba(46,39,25,0.35)] sm:p-6 lg:flex-row lg:items-center">
      <div className="flex min-w-0 flex-1 gap-4">
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#3fd8b3] to-[#0c9a7c] text-lg font-black text-white shadow-sm"
          aria-hidden="true"
        >
          {getInitials(result.displayName)}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-lg font-extrabold text-[#1a1916]">{result.displayName}</h3>
            <span className="rounded-full bg-[rgba(34,196,154,0.14)] px-2 py-1 text-[0.65rem] font-extrabold tracking-[0.08em] text-[#0e8a73]">
              VERIFIED
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold text-[#625b53]">
            <span>{rating}</span>
            <span>
              {result.reviewCount} {text.reviews}
            </span>
            <span>
              {result.experienceYears} {text.years}
            </span>
            <span>{nextAvailable}</span>
          </div>
          <p className="mt-3 text-sm font-extrabold text-[#332e28]">
            {result.subject} · {result.grade}
          </p>
          <p className="mt-1.5 line-clamp-2 text-sm leading-6 text-[#625b53]">
            {result.description}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-between gap-4 border-t border-[#f0ebe3] pt-4 lg:flex-col lg:items-end lg:border-t-0 lg:pt-0">
        <strong className="text-xl font-black text-[#1a1916]">
          {formatPrice(result.pricePerHour)} ฿
          <span className="text-xs font-bold text-[#625b53]">/{text.hour}</span>
        </strong>
        <Link
          href={`/tutors/${encodeURIComponent(result.tutorId)}?listingId=${encodeURIComponent(result.listingId)}`}
          className="tutor-search-primary-button"
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
  return (
    <div
      className={`rounded-[1.35rem] border p-10 text-center ${
        tone === 'error'
          ? 'border-[#e2b7ae] bg-[#fff4f1] text-[#a34334]'
          : tone === 'empty'
            ? 'border-dashed border-[#ded8ce] bg-[#fbf9f3] text-[#332e28]'
            : 'border-[#ebe6dd] bg-white text-[#625b53]'
      }`}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <p className="text-base font-extrabold">{message}</p>
      {hint && <p className="mt-2 text-sm text-[#625b53]">{hint}</p>}
      {clearLabel && onClear && (
        <button type="button" className="tutor-search-secondary-button mt-4" onClick={onClear}>
          {clearLabel}
        </button>
      )}
    </div>
  );
}

function validateSearchForm(form: SearchForm, text: SearchCopy): SearchErrors {
  const errors: SearchErrors = {};
  if (form.maxPrice !== '') {
    const value = Number(form.maxPrice);
    if (!Number.isFinite(value) || value < 0 || decimalPlaces(form.maxPrice) > 2) {
      errors.maxPrice = text.validationError;
    }
  }
  if (form.minimumRating !== '') {
    const value = Number(form.minimumRating);
    if (
      !Number.isFinite(value) ||
      value < 1 ||
      value > 5 ||
      decimalPlaces(form.minimumRating) > 2
    ) {
      errors.minimumRating = text.validationError;
    }
  }
  return errors;
}

function toSearchQuery(form: SearchForm): TutorSearchQuery {
  return {
    ...(form.subject ? { subject: form.subject } : {}),
    ...(form.grade ? { grade: form.grade } : {}),
    ...(form.maxPrice !== '' ? { maxPrice: Number(form.maxPrice) } : {}),
    ...(form.minimumRating !== '' ? { minimumRating: Number(form.minimumRating) } : {}),
  };
}

function decimalPlaces(value: string): number {
  const decimal = value.split('.')[1];
  return decimal?.length ?? 0;
}

function formatSearchSummary(form: SearchForm, text: SearchCopy): string {
  const subject = form.subject || text.anySubject;
  const grade = form.grade || text.anyGrade;
  const budget = form.maxPrice ? `${text.upTo} ${form.maxPrice}฿/${text.hour}` : text.anyBudget;
  const rating = form.minimumRating
    ? `${text.ratingSummary} ${Number(form.minimumRating).toFixed(1)}+`
    : text.anyRating;

  return [subject, grade, budget, rating].join(' · ');
}

function readSearchError(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.status === 400) {
    return error.message;
  }
  return fallback;
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

function formatPrice(price: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(price);
}

function formatNextAvailable(value: string, language: 'en' | 'th'): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(language === 'th' ? 'th-TH' : 'en-GB', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
  }).format(date);
}
