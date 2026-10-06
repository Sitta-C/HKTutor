'use client';

import styles from './notebook.module.css';

import type { ButtonHTMLAttributes } from 'react';

export interface BookmarkNoteSwitchProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'role' | 'aria-checked' | 'onClick' | 'type'
> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

export function BookmarkNoteSwitch({
  checked,
  onCheckedChange,
  className,
  children,
  ...props
}: BookmarkNoteSwitchProps) {
  return (
    <button
      {...props}
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={[
        styles.bookmarkNoteSwitch,
        'flex min-h-14 w-full cursor-pointer items-center justify-between gap-3 py-3 pl-11 pr-4 text-left !text-sm text-notebook-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tutor-deep/40 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-55',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <span className="min-w-0 font-medium leading-6">{children}</span>
      <span
        aria-hidden="true"
        className={`relative h-6 w-10 shrink-0 rounded-full border transition-colors ${checked ? 'border-tutor-deep bg-sticky-blue/60' : 'border-notebook-muted/40 bg-paper'}`}
      >
        <span
          className={`absolute left-1 top-1 h-3.5 w-3.5 rounded-full transition-transform ${checked ? 'translate-x-4 bg-tutor-deep' : 'bg-notebook-muted'}`}
        />
      </span>
    </button>
  );
}
