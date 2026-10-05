'use client';

import { useId, useRef, useState } from 'react';

import notebookStyles from './notebook.module.css';
import styles from './subject-course-index.module.css';

import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';

interface CourseChoice {
  value: string;
  label: string;
  description: string;
}

export interface SubjectCourseGroup {
  id: string;
  label: string;
  code: string;
  courses: CourseChoice[];
}

const SUBJECT_COLORS = [
  'var(--color-tutor-deep)',
  '#8060a0',
  'var(--color-admin-deep)',
  'var(--color-student-deep)',
  '#927829',
  '#a26480',
];

function subjectStyle(code: string): CSSProperties & { '--subject-accent': string } {
  const known: Record<string, number> = {
    MATH: 0,
    MATHEMATICS: 0,
    PHYS: 1,
    PHYSICS: 1,
    CHEM: 2,
    CHEMISTRY: 2,
    BIO: 3,
    BIOLOGY: 3,
    ENG: 4,
    ENGLISH: 4,
    COMPUTER: 5,
    CS: 5,
  };
  const normalized = code.toUpperCase();
  const hash = Array.from(normalized).reduce(
    (value, character) => (value * 31 + character.charCodeAt(0)) % 2147483647,
    0,
  );
  const index = known[normalized] ?? Math.abs(hash % SUBJECT_COLORS.length);
  return { '--subject-accent': SUBJECT_COLORS[index] ?? SUBJECT_COLORS[0] ?? 'currentColor' };
}

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M3 8V6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v2M3 8h17l-2 10H3V8Z" />
    </svg>
  );
}

export function SubjectCourseIndex({
  groups,
  value,
  subjectLabel,
  courseLabel,
  courseCountLabel,
  hint,
  onChange,
  children,
}: {
  groups: SubjectCourseGroup[];
  value: string | null;
  subjectLabel: string;
  courseLabel: string;
  courseCountLabel: string;
  hint: string;
  onChange: (value: string | null) => void;
  children: ReactNode;
}) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const selectedGroup = groups.find((group) =>
    group.courses.some((course) => course.value === value),
  );
  const activeGroup = groups.find((group) => group.id === subjectId) ?? selectedGroup ?? groups[0];
  const selectedCourse = activeGroup?.courses.find((course) => course.value === value);
  const showDetails = Boolean(selectedCourse) && detailsOpen;
  if (!activeGroup) {
    return null;
  }

  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, kind: 'subject' | 'course') {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      return;
    }
    const buttons = Array.from(
      rootRef.current?.querySelectorAll<HTMLButtonElement>(`[data-index-${kind}]`) ?? [],
    );
    const current = buttons.indexOf(event.currentTarget);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    event.preventDefault();
    buttons[next]?.focus();
  }

  return (
    <div
      ref={rootRef}
      className="mt-6 grid min-w-0 items-start gap-4 md:grid-cols-[11rem_minmax(0,1fr)]"
    >
      <div role="group" aria-label={subjectLabel} className="grid grid-cols-2 gap-2 md:grid-cols-1">
        {groups.map((group) => (
          <button
            key={group.id}
            type="button"
            data-index-subject
            aria-pressed={activeGroup.id === group.id}
            aria-controls={`${id}-courses`}
            style={subjectStyle(group.code)}
            onKeyDown={(event) => moveFocus(event, 'subject')}
            onClick={() => {
              setSubjectId(group.id);
              if (selectedGroup?.id !== group.id) {
                onChange(null);
              }
            }}
            className={`${styles.subject} flex min-h-12 min-w-0 items-center gap-2 px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tutor-deep focus-visible:ring-offset-2`}
          >
            <FolderIcon className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1 break-words font-medium">{group.label}</span>
            <span className="shrink-0 text-xs tabular-nums text-notebook-muted">
              {group.courses.length}
            </span>
          </button>
        ))}
      </div>

      <div
        id={`${id}-courses`}
        style={subjectStyle(activeGroup.code)}
        className={`${styles.folder} min-w-0 rounded-xl border bg-white`}
      >
        <div
          className={`${styles.heading} flex flex-wrap items-center justify-between gap-2 rounded-t-xl border-b px-4 py-4`}
        >
          <h4 className="flex min-w-0 items-center gap-2 text-sm font-bold">
            <FolderIcon className="h-5 w-5 shrink-0" />
            <span className="break-words">{activeGroup.label}</span>
          </h4>
          <span className="text-xs tabular-nums text-notebook-muted">
            {courseCountLabel.replace('{count}', String(activeGroup.courses.length))}
          </span>
        </div>
        <div
          className={`${notebookStyles.binderSheet} rounded-b-xl px-3 pb-4 pl-9 sm:px-5 sm:pl-12`}
        >
          <ul
            aria-label={courseLabel.replace('{subject}', activeGroup.label)}
            className="divide-y divide-dashed divide-paper-edge"
          >
            {activeGroup.courses.map((course) => (
              <li key={course.value}>
                <button
                  type="button"
                  data-index-course
                  aria-pressed={course.value === value}
                  onClick={() => {
                    setDetailsOpen(true);
                    onChange(course.value);
                  }}
                  onKeyDown={(event) => moveFocus(event, 'course')}
                  className={`${styles.course} flex min-h-18 w-full min-w-0 items-center gap-3 rounded-md px-2 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tutor-deep`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-sm font-semibold">{course.label}</span>
                    <span className="mt-1 block text-xs leading-5 text-notebook-muted">
                      {course.description}
                    </span>
                  </span>
                  <span aria-hidden="true" className={`${styles.mark} shrink-0 text-lg`}>
                    {course.value === value ? '✓' : '›'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-4 border-t border-dashed border-paper-edge pt-3">
            {selectedCourse && (
              <h5>
                <button
                  id={`${id}-details-toggle`}
                  type="button"
                  aria-expanded={showDetails}
                  aria-controls={`${id}-details`}
                  onClick={() => setDetailsOpen((open) => !open)}
                  className={`${styles.toggle} flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-1 text-left text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tutor-deep`}
                >
                  <span className="break-words">
                    {activeGroup.label} · {selectedCourse.label}
                  </span>
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`${styles.chevron} h-4 w-4 shrink-0`}
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
              </h5>
            )}
            <div
              id={`${id}-details`}
              role="region"
              aria-labelledby={selectedCourse ? `${id}-details-toggle` : undefined}
              aria-hidden={!showDetails}
              inert={!showDetails}
              data-open={showDetails}
              className={styles.collapse}
            >
              <div className={styles.collapseInner}>
                <div className="pt-3" aria-live="polite">
                  {children}
                </div>
              </div>
            </div>
            {!selectedCourse && <p className="text-xs leading-6 text-notebook-muted">{hint}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
