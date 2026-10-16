'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { getEmailFlow } from '@/lib/api/auth';

import type { EmailFlow, EmailFlowPurpose } from '@/lib/api/types';

export function emailResendSeconds(deadline: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

export function formatResendTime(seconds: number): string {
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}

interface EmailFlowState {
  flow: EmailFlow | null;
  remainingSeconds: number;
  loading: boolean;
  failed: boolean;
  accept(next: EmailFlow): void;
  refresh(): void;
}

export function useEmailFlow(purpose: EmailFlowPurpose, enabled = true): EmailFlowState {
  const [flow, setFlow] = useState<EmailFlow | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [loading, setLoading] = useState(enabled);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const deadline = useRef(0);
  const generation = useRef(0);

  const accept = useCallback((next: EmailFlow) => {
    generation.current += 1;
    deadline.current = Date.now() + next.retryAfterSeconds * 1000;
    setFlow(next);
    setRemainingSeconds(next.retryAfterSeconds);
    setFailed(false);
    setLoading(false);
  }, []);

  const refresh = useCallback(() => {
    setLoading(true);
    setRevision((current) => current + 1);
  }, []);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const controller = new AbortController();
    const current = ++generation.current;
    getEmailFlow(purpose, controller.signal)
      .then((result) => {
        if (current === generation.current && !controller.signal.aborted) {
          accept(result);
        }
      })
      .catch(() => {
        if (current === generation.current && !controller.signal.aborted) {
          setFailed(true);
        }
      })
      .finally(() => {
        if (current === generation.current && !controller.signal.aborted) {
          setLoading(false);
        }
      });
    return () => {
      controller.abort();
      generation.current += 1;
    };
  }, [enabled, purpose, revision, accept]);

  useEffect(() => {
    if (!flow) {
      return;
    }
    const update = () => setRemainingSeconds(emailResendSeconds(deadline.current, Date.now()));
    const interval = window.setInterval(update, 250);
    document.addEventListener('visibilitychange', update);
    window.addEventListener('focus', update);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('focus', update);
    };
  }, [flow]);

  return { flow, remainingSeconds, loading, failed, accept, refresh };
}
