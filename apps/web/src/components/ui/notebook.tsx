import styles from './notebook.module.css';

import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';

type NotebookBackground = 'plain' | 'ruled' | 'grid';
type NoteTone = 'yellow' | 'orange' | 'pink' | 'blue' | 'green';
type TapeTone = 'yellow' | 'pink' | 'blue';
type ButtonTone = 'primary' | 'secondary' | 'danger';
type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'student' | 'tutor';

function classes(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

const backgroundClass: Record<NotebookBackground, string> = {
  plain: '',
  ruled: styles.ruled!,
  grid: styles.grid!,
};

const noteToneClass: Record<NoteTone, string> = {
  yellow: 'bg-sticky-yellow',
  orange: 'bg-sticky-orange',
  pink: 'bg-sticky-pink',
  blue: 'bg-sticky-blue',
  green: 'bg-sticky-green',
};

const tapeToneClass: Record<TapeTone, string> = {
  yellow: 'bg-amber-200/75',
  pink: 'bg-pink-200/75',
  blue: 'bg-blue-200/75',
};

const statusToneClass: Record<StatusTone, string> = {
  neutral: 'border-stone-200 bg-stone-100 text-stone-700',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  danger: 'border-red-200 bg-red-50 text-red-800',
  student: 'border-emerald-200 bg-sticky-green text-emerald-800',
  tutor: 'border-blue-200 bg-sticky-blue text-blue-800',
};

export function NotebookPage({
  background = 'ruled',
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { background?: NotebookBackground }) {
  return (
    <div
      className={classes(
        styles.page,
        backgroundClass[background],
        'min-h-dvh text-notebook-ink',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function GraphPaper({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={classes(
        styles.grid,
        'rounded-[1.25rem] border border-blue-200/70 bg-paper',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function PaperCard({ className, children, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={classes(
        styles.paper,
        'rounded-[1.5rem] border border-paper-edge/80 bg-paper',
        className,
      )}
      {...props}
    >
      {children}
    </section>
  );
}

export function StickyNote({
  tone = 'yellow',
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { tone?: NoteTone }) {
  return (
    <div
      className={classes(
        styles.sticky,
        noteToneClass[tone],
        'rounded-sm border border-stone-900/5 p-4 text-notebook-ink',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function notebookArchiveClass(className?: string): string {
  return classes(styles.archivedItem, className);
}

export function WashiTape({ tone = 'yellow', className }: { tone?: TapeTone; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={classes(
        styles.tape,
        tapeToneClass[tone],
        'pointer-events-none absolute h-5 w-24 -rotate-2',
        className,
      )}
    />
  );
}

export function NotebookHeading({
  eyebrow,
  title,
  description,
  align = 'left',
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  align?: 'left' | 'center';
  className?: string;
}) {
  return (
    <div className={classes(align === 'center' && 'text-center', className)}>
      {eyebrow && (
        <p className="font-note text-xl font-semibold leading-none text-amber-700 sm:text-2xl">
          {eyebrow}
        </p>
      )}
      <h1 className="mt-2 text-3xl font-bold tracking-[-0.045em] text-notebook-ink sm:text-4xl">
        {title}
      </h1>
      {description && (
        <p
          className={classes(
            'mt-3 max-w-xl text-base leading-7 text-notebook-muted',
            align === 'center' && 'mx-auto',
          )}
        >
          {description}
        </p>
      )}
    </div>
  );
}

export function notebookButtonClass({
  tone = 'primary',
  className,
}: {
  tone?: ButtonTone;
  className?: string | undefined;
} = {}): string {
  const tones: Record<ButtonTone, string> = {
    primary:
      'border-notebook-ink bg-notebook-ink text-paper shadow-[0_3px_0_#57534e] hover:-translate-y-0.5 hover:shadow-[0_4px_0_#57534e]',
    secondary:
      'border-paper-edge bg-paper text-notebook-ink shadow-[0_2px_0_#ddd6c7] hover:-translate-y-0.5 hover:bg-sticky-yellow/40',
    danger: 'border-red-700 bg-red-700 text-white shadow-[0_3px_0_#991b1b] hover:-translate-y-0.5',
  };

  return classes(
    'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-bold transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-notebook-ink/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:translate-y-0 disabled:opacity-55',
    tones[tone],
    className,
  );
}

export function notebookInputClass({
  error = false,
  className,
}: {
  error?: boolean;
  className?: string;
} = {}): string {
  return classes(
    'min-h-12 w-full rounded-lg border bg-paper px-4 text-[0.98rem] text-notebook-ink outline-none transition placeholder:text-stone-400 hover:border-stone-400 focus:ring-4',
    error
      ? 'border-red-400 focus:border-red-600 focus:ring-red-100'
      : 'border-paper-edge focus:border-notebook-ink focus:ring-sticky-yellow/60',
    className,
  );
}

export function NotebookButton({
  tone = 'primary',
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: ButtonTone }) {
  return <button type={type} className={notebookButtonClass({ tone, className })} {...props} />;
}

export function NotebookField({
  label,
  htmlFor,
  hint,
  error,
  className,
  children,
}: {
  label: ReactNode;
  htmlFor: string;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-bold text-notebook-ink">
        {label}
      </label>
      {children}
      {error ? (
        <p className="mt-1.5 text-xs font-medium text-red-700" role="alert">
          {error}
        </p>
      ) : (
        hint && <p className="mt-1.5 text-xs text-notebook-muted">{hint}</p>
      )}
    </div>
  );
}

export function StatusBadge({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: StatusTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={classes(
        statusToneClass[tone],
        'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-bold',
        className,
      )}
    >
      {children}
    </span>
  );
}
