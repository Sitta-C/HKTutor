'use client';

import { useEffect, useRef, useState } from 'react';

import {
  EMPTY_COUPON_DRAFT,
  getCouponRequestError,
  getCouponServerErrors,
  reconcileCouponCode,
  validateCouponDraft,
} from '@/components/coupons/coupon-model';
import { DashboardIcon } from '@/components/dashboard/dashboard-icon';
import { LocalizedDatePicker } from '@/components/date-time/localized-date-picker';
import { TimeWheelPicker } from '@/components/date-time/time-wheel-picker';
import { notebookInputClass } from '@/components/ui/notebook';
import { useNotebookToast } from '@/components/ui/notebook-toast';
import { createAdminCoupon, listAdminCoupons } from '@/lib/api/coupons';
import { formatBangkokDateTime, getBangkokToday } from '@/lib/date-time';

import type { CouponCopy } from '@/components/coupons/coupon-copy';
import type { CouponDraft, CouponErrors, CouponField } from '@/components/coupons/coupon-model';
import type { AdminCoupon } from '@/lib/api/types';
import type { Language } from '@/lib/i18n';
import type { FormEvent } from 'react';

type Phase = 'idle' | 'saving' | 'uncertain' | 'checking';
type Notice = 'success' | 'invalid' | 'uncertain' | 'checkFailed' | 'found' | 'absent' | null;

export function CouponCreateForm({
  copy,
  language,
  onCreated,
  onReconciled,
  onDenied,
}: {
  copy: CouponCopy;
  language: Language;
  onCreated: (coupon: AdminCoupon) => void;
  onReconciled: () => void;
  onDenied: (kind: 'unauthorized' | 'forbidden') => void;
}) {
  const [draft, setDraft] = useState<CouponDraft>({ ...EMPTY_COUPON_DRAFT });
  const [errors, setErrors] = useState<CouponErrors>({});
  const [phase, setPhase] = useState<Phase>('idle');
  const [notice, setNotice] = useState<Notice>(null);
  const [recoveredCoupon, setRecoveredCoupon] = useState<AdminCoupon | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const lifetime = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const toast = useNotebookToast();

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, []);

  function focusError(nextErrors: CouponErrors): void {
    const field =
      (['code', 'percent', 'maxUses', 'expiry'] as const).find((key) => nextErrors[key]) ?? 'code';
    // Wait for the saving fieldset to be enabled before restoring focus after an API error.
    requestAnimationFrame(() => {
      formRef.current
        ?.querySelector<HTMLElement>(field === 'expiry' ? '#coupon-date' : `[name="${field}"]`)
        ?.focus();
    });
  }

  function update<K extends keyof CouponDraft>(field: K, value: CouponDraft[K]): void {
    setRecoveredCoupon(null);
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({
      ...current,
      [field === 'date' || field === 'time' ? 'expiry' : field]: undefined,
    }));
    setNotice(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy.current || phase !== 'idle') {
      return;
    }
    setRecoveredCoupon(null);
    const result = validateCouponDraft(draft, Date.now());
    if (result.errors) {
      setErrors(result.errors);
      setNotice('invalid');
      focusError(result.errors);
      toast.error(copy.invalid);
      return;
    }
    const controller = lifetime.current;
    if (!controller || controller.signal.aborted) {
      return;
    }
    busy.current = true;
    setPhase('saving');
    setErrors({});
    setNotice(null);
    try {
      const coupon = await createAdminCoupon(result.payload, controller.signal);
      if (controller.signal.aborted) {
        return;
      }
      setDraft({ ...EMPTY_COUPON_DRAFT });
      setPhase('idle');
      setNotice('success');
      toast.success(copy.success);
      onCreated(coupon);
      requestAnimationFrame(() => statusRef.current?.focus());
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      const kind = getCouponRequestError(error);
      if (kind === 'unauthorized' || kind === 'forbidden') {
        onDenied(kind);
      } else if (kind === 'duplicate' || kind === 'validation') {
        const nextErrors: CouponErrors =
          kind === 'duplicate' ? { code: 'duplicate' } : getCouponServerErrors(error);
        setErrors(nextErrors);
        setNotice('invalid');
        setPhase('idle');
        focusError(nextErrors);
        toast.error(kind === 'duplicate' ? copy.errors.duplicate : copy.invalid);
      } else {
        setPhase('uncertain');
        setNotice('uncertain');
        toast.error(copy.uncertain);
      }
    } finally {
      busy.current = false;
    }
  }

  async function checkResult(): Promise<void> {
    const controller = lifetime.current;
    if (busy.current || !controller || controller.signal.aborted) {
      return;
    }
    busy.current = true;
    setPhase('checking');
    setRecoveredCoupon(null);
    try {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]);
      const found = await reconcileCouponCode(
        draft.code,
        (cursor) => listAdminCoupons(cursor, signal),
        signal,
      );
      if (controller.signal.aborted) {
        return;
      }
      setPhase('idle');
      setNotice(found ? 'found' : 'absent');
      setErrors(found ? { code: 'duplicate' } : {});
      setRecoveredCoupon(found);
      onReconciled();
      if (found) {
        focusError({ code: 'duplicate' });
      }
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      const kind = getCouponRequestError(error);
      if (kind === 'unauthorized' || kind === 'forbidden') {
        onDenied(kind);
      } else {
        setPhase('uncertain');
        setNotice('checkFailed');
      }
    } finally {
      busy.current = false;
    }
  }

  const locked = phase !== 'idle';
  const labelClass = 'mb-[0.4rem] block text-sm font-bold';
  const hintClass = 'mt-[0.4rem] text-xs leading-[1.7] text-notebook-muted-deep';
  const pairClass = 'grid grid-cols-2 gap-3 @max-[550px]/coupons:grid-cols-1';
  function fieldProps(field: CouponField) {
    return {
      'aria-invalid': Boolean(errors[field]),
      'aria-describedby': `coupon-${field}-hint${errors[field] ? ` coupon-${field}-error` : ''}`,
      className: notebookInputClass({
        error: Boolean(errors[field]),
        className:
          'min-w-0 max-w-full text-base! focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-deep',
      }),
    };
  }
  function fieldError(field: CouponField) {
    const error = errors[field];
    return error ? (
      <p
        id={`coupon-${field}-error`}
        className="mt-3 text-sm leading-[1.7] wrap-anywhere text-red-800"
      >
        {copy.errors[error]}
      </p>
    ) : null;
  }

  return (
    <section
      className="min-w-0 rounded-lg border border-t-3 border-paper-edge border-t-admin-deep bg-paper p-[1.3rem] shadow-paper @max-[850px]/coupons:p-5 @max-[550px]/coupons:p-4"
      aria-labelledby="coupon-form-heading"
    >
      <header className="mb-[1.4rem] flex items-start gap-3">
        <span
          className="rounded-md bg-sticky-yellow p-[0.45rem] text-admin-deep"
          aria-hidden="true"
        >
          <DashboardIcon name="plus" />
        </span>
        <div>
          <h2 id="coupon-form-heading" className="text-lg font-bold">
            {copy.formTitle}
          </h2>
          <p className="mt-[0.4rem] text-[0.8rem] leading-[1.7] text-notebook-muted-deep">
            {copy.formIntro}
          </p>
        </div>
      </header>
      <form ref={formRef} noValidate onSubmit={(event) => void submit(event)}>
        <fieldset
          disabled={locked}
          className="m-0 grid min-w-0 gap-4 border-0 p-0 disabled:opacity-70 @max-[850px]/coupons:grid-cols-2 @max-[550px]/coupons:grid-cols-1"
        >
          <div className="@max-[850px]/coupons:col-span-full">
            <label className={labelClass} htmlFor="coupon-code">
              {copy.code}
            </label>
            <input
              id="coupon-code"
              name="code"
              value={draft.code}
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="characters"
              {...fieldProps('code')}
              onChange={(event) => update('code', event.target.value)}
            />
            <p id="coupon-code-hint" className={hintClass}>
              {copy.codeHint}
            </p>
            {fieldError('code')}
          </div>
          <div className={pairClass}>
            <div>
              <label className={labelClass} htmlFor="coupon-percent">
                {copy.percent}
              </label>
              <input
                id="coupon-percent"
                name="percent"
                type="number"
                inputMode="numeric"
                min="1"
                max="100"
                step="1"
                value={draft.percent}
                {...fieldProps('percent')}
                onChange={(event) => update('percent', event.target.value)}
              />
              <span id="coupon-percent-hint" className="sr-only">
                {copy.errors.percent}
              </span>
              {fieldError('percent')}
            </div>
            <div>
              <label className={labelClass} htmlFor="coupon-maxUses">
                {copy.maxUses}
              </label>
              <input
                id="coupon-maxUses"
                name="maxUses"
                type="number"
                inputMode="numeric"
                min="1"
                max="2147483647"
                step="1"
                value={draft.maxUses}
                {...fieldProps('maxUses')}
                onChange={(event) => update('maxUses', event.target.value)}
              />
              <span id="coupon-maxUses-hint" className="sr-only">
                {copy.errors.maxUses}
              </span>
              {fieldError('maxUses')}
            </div>
          </div>
          <div className="grid min-w-0 gap-3 @max-[850px]/coupons:col-span-full">
            <LocalizedDatePicker
              id="coupon-date"
              name="date"
              label={copy.date}
              placeholder={copy.chooseDate}
              value={draft.date}
              onChange={(value) => update('date', value)}
              min={getBangkokToday()}
              language={language}
              calendarLabel={copy.calendarLabel}
              previousMonthLabel={copy.previousMonth}
              nextMonthLabel={copy.nextMonth}
              disabled={locked}
              invalid={Boolean(errors.expiry)}
              describedBy={`coupon-expiry-hint${errors.expiry ? ' coupon-expiry-error' : ''}`}
              className="text-base! focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-deep"
            />
            <TimeWheelPicker
              id="coupon-time"
              name="time"
              label={copy.time}
              placeholder={copy.chooseTime}
              value={draft.time}
              onChange={(value) => update('time', value)}
              hourLabel={copy.hour}
              minuteLabel={copy.minute}
              disabled={locked}
              invalid={Boolean(errors.expiry)}
              describedBy={`coupon-expiry-hint${errors.expiry ? ' coupon-expiry-error' : ''}`}
              className="text-base! focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-deep"
            />
          </div>
          <div className="@max-[850px]/coupons:col-span-full">
            <p id="coupon-expiry-hint" className={hintClass}>
              {copy.timezone}
            </p>
            {fieldError('expiry')}
          </div>
          <div className="@max-[850px]/coupons:col-span-full">
            <label className="flex min-h-11 items-center gap-2.5 text-sm font-semibold">
              <input
                name="active"
                type="checkbox"
                checked={draft.active}
                className="h-[19px] w-[19px] accent-admin-deep"
                onChange={(event) => update('active', event.target.checked)}
              />
              <span>{copy.active}</span>
            </label>
            <p className={hintClass}>{copy.activeHint}</p>
          </div>
        </fieldset>
        <button
          type="submit"
          className="mt-[1.3rem] inline-flex min-h-12 w-full items-center justify-between gap-2.5 rounded-md border border-amber-800 bg-amber-800 px-4 py-2.5 text-sm font-bold text-paper shadow-[0_2px_0_var(--color-paper-edge)] transition-colors hover:bg-amber-900 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-admin-deep disabled:cursor-not-allowed disabled:opacity-60"
          disabled={locked}
        >
          {phase === 'saving' ? copy.creating : copy.create}
          <DashboardIcon name="arrow-right" />
        </button>
      </form>
      {notice && (
        <p
          ref={statusRef}
          tabIndex={-1}
          role={
            notice === 'invalid' || notice === 'uncertain' || notice === 'checkFailed'
              ? 'alert'
              : 'status'
          }
          className={`mt-3 text-sm leading-[1.7] wrap-anywhere ${notice === 'success' || notice === 'absent' ? 'text-student-deep' : 'text-red-800'}`}
        >
          {copy[notice]}
        </p>
      )}
      {recoveredCoupon && (
        <section
          className="mt-4 border-t border-paper-edge pt-4"
          aria-labelledby="coupon-recovery-heading"
        >
          <h3 id="coupon-recovery-heading" className="text-sm font-bold">
            {copy.recoveredTitle}
          </h3>
          <p className="mt-2 font-bold wrap-anywhere">
            {recoveredCoupon.code} · {recoveredCoupon.percent}%
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            {(['consumedUses', 'reservedUses', 'availableUses', 'maxUses'] as const).map(
              (field, index) => (
                <div key={field}>
                  <dt className="text-xs text-notebook-muted-deep">
                    {[copy.used, copy.reserved, copy.available, copy.limit][index]}
                  </dt>
                  <dd className="font-semibold tabular-nums wrap-anywhere">
                    {recoveredCoupon[field].toLocaleString(language === 'th' ? 'th-TH' : 'en-US')}
                  </dd>
                </div>
              ),
            )}
            <div className="col-span-full">
              <dt className="text-xs text-notebook-muted-deep">{copy.expiry}</dt>
              <dd>
                <time dateTime={recoveredCoupon.expiresAt}>
                  {formatBangkokDateTime(recoveredCoupon.expiresAt, language)}
                </time>
              </dd>
            </div>
            <div className="col-span-full">
              <dt className="text-xs text-notebook-muted-deep">{copy.activation}</dt>
              <dd>{recoveredCoupon.active ? copy.enabled : copy.statuses.inactive}</dd>
            </div>
          </dl>
        </section>
      )}
      {(phase === 'uncertain' || phase === 'checking') && (
        <button
          className="mt-3 inline-flex min-h-11 items-center justify-center gap-2.5 rounded-md border border-paper-edge bg-paper px-4 py-2.5 text-sm font-bold text-notebook-ink transition-colors hover:bg-paper-deep focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-admin-deep disabled:cursor-not-allowed disabled:opacity-60"
          type="button"
          disabled={phase === 'checking'}
          onClick={() => void checkResult()}
        >
          {phase === 'checking' ? copy.checking : copy.check}
        </button>
      )}
    </section>
  );
}
