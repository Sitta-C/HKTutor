'use client';

import { useId, useRef, useState } from 'react';

import {
  MAX_COUPON_USES,
  canIncreaseCouponCapacity,
  parseCouponCapacity,
} from '@/components/coupons/coupon-model';
import { notebookInputClass } from '@/components/ui/notebook';
import { NotebookConfirmDialog } from '@/components/ui/notebook-confirm-dialog';
import { useNotebookToast } from '@/components/ui/notebook-toast';

import type { CouponCopy } from '@/components/coupons/coupon-copy';
import type { AdminCoupon } from '@/lib/api/types';
import type { Language } from '@/lib/i18n';

export function CouponCapacityDialog({
  coupon,
  copy,
  language,
  busy,
  onCancel,
  onConfirm,
}: {
  coupon: AdminCoupon;
  copy: CouponCopy;
  language: Language;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (maxUses: number) => Promise<string | null>;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(String(coupon.maxUses));
  const [error, setError] = useState<string | null>(null);
  const toast = useNotebookToast();
  const target = parseCouponCapacity(value, coupon.maxUses);
  const format = (count: number) => count.toLocaleString(language === 'th' ? 'th-TH' : 'en-US');
  return (
    <NotebookConfirmDialog
      open
      title={copy.capacityTitle}
      description={copy.capacityHelp}
      confirmLabel={copy.increaseCapacity}
      role="admin"
      busy={busy}
      error={error}
      onCancel={onCancel}
      onConfirm={async () => {
        if (target === null || !canIncreaseCouponCapacity(coupon, Date.now())) {
          const message =
            Date.parse(coupon.expiresAt) <= Date.now()
              ? copy.capacityExpired
              : copy.capacityInvalid;
          setError(message);
          toast.error(message);
          input.current?.focus();
          return;
        }
        setError(null);
        const failure = await onConfirm(target);
        if (failure) {
          setError(failure);
          requestAnimationFrame(() => input.current?.focus());
        }
      }}
    >
      <dl>
        <div>
          <dt>{copy.code}</dt>
          <dd>
            {coupon.code} · {coupon.percent}%
          </dd>
        </div>
        <div>
          <dt>{copy.capacityBefore}</dt>
          <dd>{format(coupon.maxUses)}</dd>
        </div>
        <div>
          <dt>
            {copy.used} / {copy.reserved}
          </dt>
          <dd>
            {format(coupon.consumedUses)} / {format(coupon.reservedUses)}
          </dd>
        </div>
      </dl>
      <div className="mt-4">
        <label htmlFor={id} className="mb-2 block text-sm font-semibold">
          {copy.capacityTotal}
        </label>
        <input
          ref={input}
          id={id}
          type="number"
          inputMode="numeric"
          step="1"
          min={coupon.maxUses + 1}
          max={MAX_COUPON_USES}
          value={value}
          disabled={busy}
          className={notebookInputClass({
            error: Boolean(error),
            className: 'w-full min-w-0 text-base!',
          })}
          aria-invalid={Boolean(error)}
          aria-describedby={`${id}-hint`}
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
        />
        <p id={`${id}-hint`} className="mt-2 text-xs leading-relaxed text-notebook-muted-deep">
          {target === null
            ? copy.capacityInvalid
            : copy.capacityPreview.replace('{count}', format(target - coupon.maxUses))}
        </p>
      </div>
    </NotebookConfirmDialog>
  );
}
