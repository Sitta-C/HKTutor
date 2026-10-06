'use client';

import { useEffect, useId, useRef, useState } from 'react';

import { NotebookPagination } from '@/components/ui/notebook-pagination';

import styles from './notebook.module.css';

import type { KeyboardEvent, ReactNode } from 'react';

interface BinderOption {
  value: string;
  label: string;
  description: string;
}

export function BinderDropdown({
  options,
  value,
  label,
  placeholder,
  hint,
  tabLabel,
  paginationLabel,
  pageSize = 5,
  onChange,
  children,
}: {
  options: BinderOption[];
  value: string | null;
  label: string;
  placeholder: string;
  hint: string;
  tabLabel: string;
  paginationLabel: string;
  pageSize?: number;
  onChange: (value: string) => void;
  children?: ReactNode;
}) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const selected = options.find((option) => option.value === value);
  const currentPage = Math.min(page, Math.max(1, Math.ceil(options.length / pageSize)));
  const choices = options.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (!open || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const buttons = [
      ...(rootRef.current?.querySelectorAll<HTMLButtonElement>('[data-binder-option]') ?? []),
    ];
    if (buttons.length === 0) return;
    const index = buttons.findIndex((button) => button === event.target);
    // Leave the pagination controls' native keyboard behavior intact.
    if (event.target !== triggerRef.current && index === -1) return;
    event.preventDefault();
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : index === -1
            ? event.key === 'ArrowDown'
              ? 0
              : buttons.length - 1
            : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }

  return (
    <div
      ref={rootRef}
      className="relative mt-8 min-w-0"
      onKeyDown={handleKeyDown}
      onBlur={(event) => {
        // A pagination button can lose focus when it becomes disabled on the last page.
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
        }
      }}
    >
      <span
        aria-hidden="true"
        className="absolute -top-5 left-0 rounded-t-lg border border-b-0 border-tutor-deep/25 bg-[color-mix(in_srgb,var(--color-tutor-deep)_9%,white)] px-4 pb-1 pt-1 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-tutor-deep"
      >
        {tabLabel}
      </span>
      <button
        ref={triggerRef}
        id={`${id}-trigger`}
        type="button"
        aria-label={selected ? `${label}: ${selected.label}` : placeholder}
        aria-expanded={open}
        aria-controls={`${id}-choices`}
        onClick={() => setOpen((current) => !current)}
        className="relative z-10 flex min-h-20 w-full items-center gap-3 rounded-b-lg rounded-tr-xl border border-tutor-deep/25 bg-[color-mix(in_srgb,var(--color-tutor-deep)_9%,white)] px-4 py-4 text-left transition-colors hover:bg-sticky-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tutor-deep focus-visible:ring-offset-2 sm:px-5"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-5 w-5 shrink-0 text-tutor-deep"
        >
          <path d="M3 8V6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v2M3 8h17l-2 10H3V8Z" />
        </svg>
        <span className="min-w-0 flex-1">
          <span className="block break-words text-sm font-bold text-notebook-ink sm:text-base">
            {selected?.label ?? placeholder}
          </span>
          <span className="mt-1 block text-xs leading-5 text-notebook-muted">
            {selected?.description ?? hint}
          </span>
        </span>
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`h-4 w-4 shrink-0 text-tutor-deep transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      <div
        id={`${id}-choices`}
        hidden={!open}
        className={`${styles.binderSheet} rounded-b-xl border border-t-0 border-tutor-deep/25 px-4 pb-4 pl-9 sm:pl-12`}
      >
        <ul aria-label={label} className="divide-y divide-dashed divide-tutor-deep/20">
          {choices.map((option) => (
            <li key={option.value}>
              <button
                type="button"
                data-binder-option
                aria-pressed={option.value === value}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
                className="flex min-h-20 w-full items-center gap-3 rounded-md px-2 py-4 text-left transition-colors hover:bg-sticky-blue/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tutor-deep"
              >
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-sm font-semibold">{option.label}</span>
                  <span className="mt-1 block text-xs leading-5 text-notebook-muted">
                    {option.description}
                  </span>
                </span>
                {option.value === value && (
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-4 w-4 shrink-0 text-tutor-deep"
                  >
                    <path d="m5 12 4 4 10-10" />
                  </svg>
                )}
              </button>
            </li>
          ))}
        </ul>
        <NotebookPagination
          page={currentPage}
          total={options.length}
          pageSize={pageSize}
          label={paginationLabel}
          onPageChange={setPage}
        />
      </div>
      {selected && !open && (
        <div
          className={`${styles.binderSheet} rounded-b-xl border border-t-0 border-tutor-deep/25 px-5 py-6 pl-10 sm:px-7 sm:pl-14`}
          aria-live="polite"
        >
          {children}
        </div>
      )}
    </div>
  );
}
