'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { WashiTape } from '@/components/ui/notebook';
import { useLanguage } from '@/lib/i18n';

import type { ReactNode } from 'react';

export type NotebookToastTone = 'success' | 'error';

interface NotebookToast {
  id: string;
  message: string;
  tone: NotebookToastTone;
  visible: boolean;
}

interface ShowToastOptions {
  durationMs?: number;
  message: string;
  tone: NotebookToastTone;
}

interface NotebookToastContextValue {
  dismiss: (id: string) => void;
  error: (message: string, durationMs?: number) => string;
  show: (options: ShowToastOptions) => string;
  success: (message: string, durationMs?: number) => string;
}

const NotebookToastContext = createContext<NotebookToastContextValue | null>(null);
const defaultDuration = { success: 2000, error: 2000 } satisfies Record<NotebookToastTone, number>;
const exitDuration = 200;
let toastSequence = 0;

export function NotebookToastProvider({ children }: { children: ReactNode }) {
  const { copy } = useLanguage();
  const [toasts, setToasts] = useState<NotebookToast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    setToasts((current) =>
      current.map((toast) => (toast.id === id ? { ...toast, visible: false } : toast)),
    );
    const removalTimer = setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
      timers.current.delete(id);
    }, exitDuration);
    timers.current.set(id, removalTimer);
  }, []);

  const show = useCallback(
    ({ durationMs, message, tone }: ShowToastOptions) => {
      const id = `notebook-toast-${++toastSequence}`;
      setToasts((current) => [...current, { id, message, tone, visible: true }].slice(-4));
      const timer = setTimeout(() => dismiss(id), durationMs ?? defaultDuration[tone]);
      timers.current.set(id, timer);
      return id;
    },
    [dismiss],
  );

  const success = useCallback(
    (message: string, durationMs?: number) =>
      show({
        message,
        tone: 'success',
        ...(durationMs === undefined ? {} : { durationMs }),
      }),
    [show],
  );
  const error = useCallback(
    (message: string, durationMs?: number) =>
      show({
        message,
        tone: 'error',
        ...(durationMs === undefined ? {} : { durationMs }),
      }),
    [show],
  );

  useEffect(
    () => () => {
      timers.current.forEach((timer) => clearTimeout(timer));
      timers.current.clear();
    },
    [],
  );

  const value = useMemo(() => ({ dismiss, error, show, success }), [dismiss, error, show, success]);

  return (
    <NotebookToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed left-1/2 top-3 z-[100] flex w-[calc(100vw-1.5rem)] max-w-sm -translate-x-1/2 flex-col items-center gap-3 sm:top-5"
        aria-label={copy.common.toastRegion}
      >
        {toasts.map((toast) => (
          <NotebookToastItem key={toast.id} toast={toast} />
        ))}
      </div>
    </NotebookToastContext.Provider>
  );
}

export function useNotebookToast(): NotebookToastContextValue {
  const context = useContext(NotebookToastContext);
  if (!context) throw new Error('useNotebookToast must be used inside NotebookToastProvider');
  return context;
}

function NotebookToastItem({ toast }: { toast: NotebookToast }) {
  const success = toast.tone === 'success';

  return (
    <div
      className={`pointer-events-auto relative w-fit max-w-full origin-top overflow-hidden rounded-xl border bg-paper px-3 py-2.5 shadow-paper ${
        toast.visible
          ? 'motion-safe:animate-[toast-in_350ms_cubic-bezier(0.21,1.02,0.73,1)_both]'
          : 'pointer-events-none motion-safe:animate-[toast-out_200ms_ease-in_forwards]'
      } ${success ? 'border-emerald-300' : 'border-red-300'}`}
      role={success ? 'status' : 'alert'}
      aria-live={success ? 'polite' : 'assertive'}
      aria-atomic="true"
    >
      <WashiTape
        tone={success ? 'yellow' : 'pink'}
        className="-left-5 top-[-4] h-3 w-14 rotate-[-24deg]"
      />
      <div className="flex items-center gap-2.5">
        <span
          className={`inline-flex h-7 w-7 shrink-0 origin-center items-center justify-center rounded-full text-sm font-black text-white motion-safe:animate-[toast-icon-in_400ms_cubic-bezier(0.21,1.02,0.73,1)_both] ${
            success ? 'bg-emerald-600' : 'bg-red-600'
          }`}
          aria-hidden="true"
        >
          {success ? <SuccessMark /> : <ErrorMark />}
        </span>
        <p className="min-w-0 flex-1 break-words text-sm font-semibold leading-6 text-notebook-ink [overflow-wrap:anywhere]">
          {toast.message}
        </p>
      </div>
    </div>
  );
}

function SuccessMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none">
      <path
        d="m5.5 12.5 4 4 9-9"
        className="motion-safe:animate-[toast-stroke-in_300ms_ease-out_120ms_both]"
        stroke="currentColor"
        strokeWidth="2.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ErrorMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none">
      <path
        d="m7.5 7.5 9 9"
        className="motion-safe:animate-[toast-stroke-in_220ms_ease-out_100ms_both]"
        stroke="currentColor"
        strokeWidth="2.75"
        strokeLinecap="round"
      />
      <path
        d="m16.5 7.5-9 9"
        className="motion-safe:animate-[toast-stroke-in_220ms_ease-out_180ms_both]"
        stroke="currentColor"
        strokeWidth="2.75"
        strokeLinecap="round"
      />
    </svg>
  );
}
