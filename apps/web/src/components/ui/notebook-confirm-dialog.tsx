'use client';

import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

import { DashboardIcon } from '@/components/dashboard/dashboard-icon';
import { NotebookAction } from '@/components/ui/notebook-action';
import { useLanguage } from '@/lib/i18n';

import styles from './notebook-confirm-dialog.module.css';

import type { ReactNode } from 'react';

const COPY = {
  en: { cancel: 'Cancel', working: 'Saving…' },
  th: { cancel: 'ยกเลิก', working: 'กำลังบันทึก…' },
};

/** Reuses the implemented availability/course alert, including its native modal top layer. */
export function NotebookConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onCancel,
  onConfirm,
  children,
  busy = false,
  disabled = false,
  error = null,
  tone = 'primary',
  role = 'tutor',
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
  children?: ReactNode;
  busy?: boolean;
  disabled?: boolean;
  error?: string | null;
  tone?: 'primary' | 'danger';
  role?: 'tutor' | 'student' | 'admin';
}) {
  const { language } = useLanguage();
  const text = COPY[language];
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const submitting = useRef(false);

  useEffect(() => {
    if (!open || !dialog.current) return;
    const element = dialog.current;
    const trigger = document.activeElement;
    element.showModal();
    cancel.current?.focus();
    return () => {
      element.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <dialog
      ref={dialog}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      aria-busy={busy}
      className={styles.dialog}
      data-tone={tone}
      data-notebook-confirmation
      data-role={role}
      onKeyDown={(event) => event.stopPropagation()}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy && !submitting.current) onCancel();
      }}
      onClose={() => {
        if (open && !busy && !submitting.current) onCancel();
      }}
    >
      <div>
        <div className={styles.header}>
          <span className={styles.icon} aria-hidden="true">
            <DashboardIcon name={tone === 'danger' ? 'close' : 'check'} />
          </span>
          <h2 id={`${id}-title`} className={styles.title}>
            {title}
          </h2>
        </div>
        <p id={`${id}-description`} className={styles.description}>
          {description}
        </p>
        {children && (
          <div className={styles.summary}>
            <div className={styles.binding} aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <div className={styles.content}>{children}</div>
          </div>
        )}
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        <div className={styles.actions}>
          <NotebookAction
            ref={cancel}
            tone="secondary"
            disabled={busy}
            onClick={() => {
              if (!busy && !submitting.current) onCancel();
            }}
          >
            {text.cancel}
          </NotebookAction>
          <NotebookAction
            type="button"
            tone={tone === 'danger' ? 'danger' : 'primary'}
            role={role === 'student' ? 'student' : 'tutor'}
            className={styles.confirm}
            disabled={busy || disabled}
            aria-busy={busy}
            onClick={async (event) => {
              event.stopPropagation();
              if (busy || disabled || submitting.current) return;
              submitting.current = true;
              try {
                await onConfirm();
              } finally {
                submitting.current = false;
              }
            }}
          >
            {busy ? text.working : confirmLabel}
          </NotebookAction>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
