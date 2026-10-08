import styles from './notebook-action.module.css';

import type { ComponentProps, ReactNode } from 'react';

type ActionTone = 'primary' | 'secondary' | 'quiet' | 'danger';
type ActionRole = 'tutor' | 'student';

export function notebookActionClass({
  tone = 'primary',
  role = 'tutor',
  size = 'regular',
  className,
}: {
  tone?: ActionTone;
  role?: ActionRole;
  size?: 'regular' | 'compact';
  className?: string | undefined;
} = {}): string {
  return [
    styles.action,
    role === 'student' && styles.student,
    styles[tone],
    size === 'compact' && styles.compact,
    className,
  ]
    .filter(Boolean)
    .join(' ');
}

export function NotebookActionContent({
  children,
  icon,
  iconPosition = 'start',
}: {
  children: ReactNode;
  icon?: ReactNode;
  iconPosition?: 'start' | 'end';
}) {
  return (
    <span className={`${styles.content} ${iconPosition === 'end' ? styles.end : ''}`}>
      {icon && (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      )}
      <span className={styles.label}>{children}</span>
    </span>
  );
}

export function NotebookAction({
  tone = 'primary',
  role = 'tutor',
  size = 'regular',
  icon,
  iconPosition = 'start',
  className,
  children,
  type = 'button',
  ...props
}: Omit<ComponentProps<'button'>, 'role'> & {
  tone?: ActionTone;
  role?: ActionRole;
  size?: 'regular' | 'compact';
  icon?: ReactNode;
  iconPosition?: 'start' | 'end';
}) {
  return (
    <button type={type} className={notebookActionClass({ tone, role, size, className })} {...props}>
      <NotebookActionContent icon={icon} iconPosition={iconPosition}>
        {children}
      </NotebookActionContent>
    </button>
  );
}
