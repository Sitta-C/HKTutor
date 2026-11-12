'use client';

import { useEffect, useState } from 'react';

import { getCouponStatuses } from '@/components/coupons/coupon-model';
import { DashboardIcon } from '@/components/dashboard/dashboard-icon';
import { NotebookLoadingRegion } from '@/components/ui/notebook-loading';
import { formatBangkokDateTime } from '@/lib/date-time';

import type { CouponCopy } from '@/components/coupons/coupon-copy';
import type { AdminCoupon } from '@/lib/api/types';
import type { Language } from '@/lib/i18n';

export function CouponList({
  items,
  copy,
  language,
  loading,
  loadingMore,
  failed,
  nextCursor,
  onMore,
  onRefresh,
  onRetry,
  changingId,
  uncertainIds,
  onActivationChange,
}: {
  items: AdminCoupon[];
  copy: CouponCopy;
  language: Language;
  loading: boolean;
  loadingMore: boolean;
  failed: boolean;
  nextCursor: string | null;
  onMore: () => void;
  onRefresh: () => void;
  onRetry: () => void;
  changingId: string | null;
  uncertainIds: string[];
  onActivationChange: (coupon: AdminCoupon) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const statusClasses = {
    active: 'bg-sticky-green text-green-800',
    inactive: 'bg-paper-deep text-notebook-muted-deep',
    expired: 'bg-sticky-pink text-red-800',
    exhausted: 'bg-sticky-yellow text-yellow-800',
  };
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const nextExpiry = Math.min(
      ...items.map((item) => Date.parse(item.expiresAt)).filter((expiry) => expiry > now),
    );
    const timer = setTimeout(tick, Math.min(30_000, Math.max(1, nextExpiry - Date.now())));
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [items, now]);

  return (
    <section
      className="min-w-0 rounded-lg border border-paper-edge bg-paper shadow-paper"
      aria-labelledby="coupon-list-heading"
    >
      <header className="flex items-start justify-between gap-4 border-b border-paper-edge p-[1.3rem] @max-[550px]/coupons:p-4">
        <div>
          <h2 id="coupon-list-heading" className="text-lg font-bold">
            {copy.listTitle}
          </h2>
          <p className="mt-[0.4rem] text-[0.8rem] leading-[1.7] text-notebook-muted-deep @max-[550px]/coupons:max-w-[24ch]">
            {copy.listIntro}
          </p>
          <p className="mt-2 max-w-[65ch] text-xs leading-[1.7] text-notebook-muted-deep">
            {copy.activationHint}
          </p>
        </div>
        <button
          type="button"
          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md border border-paper-edge bg-paper p-2.5 text-notebook-ink transition-colors hover:bg-paper-deep focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-admin-deep disabled:cursor-not-allowed disabled:opacity-60"
          disabled={loading || loadingMore || changingId !== null}
          aria-label={copy.refresh}
          onClick={onRefresh}
        >
          <DashboardIcon name="refresh" />
        </button>
      </header>
      {loading && <NotebookLoadingRegion label={copy.loading} />}
      {!loading && !failed && items.length === 0 && (
        <p className="p-6 text-sm leading-[1.7]">{copy.empty}</p>
      )}
      <ul
        className="m-0 list-none px-[1.3rem] @max-[550px]/coupons:px-4"
        aria-busy={loading || loadingMore}
      >
        {items.map((coupon) => (
          <li key={coupon.id} className="min-w-0 border-b border-paper-edge py-[1.3rem]">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 className="text-base font-bold tracking-[0.025em] wrap-anywhere">
                  {coupon.code}
                </h3>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {getCouponStatuses(coupon, now).map((status) => (
                    <span
                      key={status}
                      className={`inline-flex rounded px-2 py-[0.2rem] text-xs font-semibold ${statusClasses[status]}`}
                    >
                      {copy.statuses[status]}
                    </span>
                  ))}
                </div>
              </div>
              <span className="shrink-0 -rotate-2 rounded-[3px] bg-sticky-yellow px-3 py-[0.4rem] text-[1.2rem] font-bold text-notebook-ink">
                {coupon.percent}%
              </span>
            </div>
            <p className="my-[0.8rem] flex items-start gap-2 text-[0.8rem] text-notebook-muted-deep">
              <DashboardIcon name="calendar" className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {copy.expiry}{' '}
                <time className="text-notebook-ink" dateTime={coupon.expiresAt}>
                  {formatBangkokDateTime(coupon.expiresAt, language)}
                </time>
              </span>
            </p>
            <dl className="grid grid-cols-4 gap-2 border-t border-dashed border-paper-edge pt-[0.7rem] @max-[550px]/coupons:grid-cols-2 @max-[550px]/coupons:gap-y-3">
              {(['consumedUses', 'reservedUses', 'availableUses', 'maxUses'] as const).map(
                (field, index) => (
                  <div key={field}>
                    <dt className="text-xs wrap-anywhere text-notebook-muted-deep">
                      {[copy.used, copy.reserved, copy.available, copy.limit][index]}
                    </dt>
                    <dd className="mt-[0.2rem] text-base font-bold tabular-nums wrap-anywhere">
                      {coupon[field].toLocaleString(language === 'th' ? 'th-TH' : 'en-US')}
                    </dd>
                  </div>
                ),
              )}
            </dl>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                aria-label={`${coupon.active ? copy.deactivate : copy.activate} ${coupon.code}`}
                aria-busy={changingId === coupon.id}
                disabled={
                  loading || loadingMore || changingId !== null || uncertainIds.includes(coupon.id)
                }
                onClick={() => onActivationChange(coupon)}
                className="inline-flex min-h-11 items-center justify-center rounded-md border border-paper-edge bg-paper px-4 py-2 text-sm font-bold text-admin-deep transition-colors hover:bg-paper-deep focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-admin-deep disabled:cursor-not-allowed disabled:opacity-60"
              >
                {changingId === coupon.id
                  ? copy.changingActivation
                  : coupon.active
                    ? copy.deactivate
                    : copy.activate}
              </button>
              {uncertainIds.includes(coupon.id) && (
                <p role="alert" className="text-sm leading-[1.7] text-red-800">
                  {copy.activationUncertain}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
      {failed && (
        <div className="p-6 text-sm leading-[1.7] text-red-800">
          <p role="alert">{copy.loadError}</p>
          <button
            className="mt-3 inline-flex min-h-11 items-center justify-center gap-2.5 rounded-md border border-paper-edge bg-paper px-4 py-2.5 text-sm font-bold text-notebook-ink transition-colors hover:bg-paper-deep focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-admin-deep disabled:cursor-not-allowed disabled:opacity-60"
            type="button"
            disabled={loading || loadingMore || changingId !== null}
            onClick={onRetry}
          >
            {copy.retry}
          </button>
        </div>
      )}
      {nextCursor && !failed && (
        <button
          className="mx-auto my-5 flex min-h-11 items-center justify-center gap-2.5 rounded-md border border-paper-edge bg-paper px-4 py-2.5 text-sm font-bold text-notebook-ink transition-colors hover:bg-paper-deep focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-admin-deep disabled:cursor-not-allowed disabled:opacity-60"
          type="button"
          disabled={loading || loadingMore || changingId !== null}
          onClick={onMore}
        >
          {loadingMore ? copy.loadingMore : copy.more}
          <DashboardIcon name="arrow-right" />
        </button>
      )}
      {loadingMore && <NotebookLoadingRegion label={copy.loadingMore} presentation="text" />}
    </section>
  );
}
