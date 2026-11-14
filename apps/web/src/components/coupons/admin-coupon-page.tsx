'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { CouponCapacityDialog } from '@/components/coupons/coupon-capacity-dialog';
import { couponCopy } from '@/components/coupons/coupon-copy';
import { CouponCreateForm } from '@/components/coupons/coupon-create-form';
import { CouponList } from '@/components/coupons/coupon-list';
import {
  getCouponCapacityError,
  getCouponRequestError,
  mergeCouponPages,
} from '@/components/coupons/coupon-model';
import { DashboardLoading } from '@/components/dashboard/dashboard-loading';
import DashboardShell from '@/components/dashboard/dashboard-shell';
import { NotebookPage } from '@/components/ui/notebook';
import { NotebookConfirmDialog } from '@/components/ui/notebook-confirm-dialog';
import { useNotebookToast } from '@/components/ui/notebook-toast';
import {
  increaseAdminCouponCapacity,
  listAdminCoupons,
  setAdminCouponActivation,
} from '@/lib/api/coupons';
import { useAuth } from '@/lib/auth-context';
import { formatBangkokDateTime } from '@/lib/date-time';
import { useLanguage } from '@/lib/i18n';
import { withReturnTo } from '@/lib/return-to';

import type { AdminCoupon, AuthUser } from '@/lib/api/types';

function AccessMessage({ kind }: { kind: 'unauthorized' | 'forbidden' }) {
  const { language } = useLanguage();
  const copy = couponCopy[language];
  return (
    <div className="mx-auto max-w-[38rem] px-6 py-12 leading-[1.8] [font-family:var(--font-body-family)]">
      <p role="alert">{kind === 'unauthorized' ? copy.session : copy.denied}</p>
      <Link
        className="mt-4 inline-flex min-h-11 items-center justify-center gap-2.5 rounded-md border border-paper-edge bg-paper px-4 py-2.5 text-sm font-bold text-notebook-ink transition-colors hover:bg-paper-deep focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-admin-deep"
        href={kind === 'unauthorized' ? withReturnTo('/', '/dashboard/coupons') : '/dashboard'}
      >
        {kind === 'unauthorized' ? copy.signIn : copy.back}
      </Link>
    </div>
  );
}

function CouponWorkspace() {
  const { language } = useLanguage();
  const copy = couponCopy[language];
  const [items, setItems] = useState<AdminCoupon[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [denied, setDenied] = useState<'unauthorized' | 'forbidden' | null>(null);
  const request = useRef<AbortController | null>(null);
  const retryCursor = useRef<string | undefined>(undefined);
  const mounted = useRef(false);
  const mutationRequest = useRef<AbortController | null>(null);
  const refreshAfterMutation = useRef(false);
  const [changingId, setChangingId] = useState<string | null>(null);
  const [changeErrors, setChangeErrors] = useState<Record<string, string>>({});
  const [changingAction, setChangingAction] = useState<'activation' | 'capacity' | null>(null);
  const [activationTarget, setActivationTarget] = useState<AdminCoupon | null>(null);
  const [capacityTarget, setCapacityTarget] = useState<AdminCoupon | null>(null);
  const toast = useNotebookToast();

  const readPage = useCallback((cursor?: string) => {
    if (mutationRequest.current) {
      return Promise.resolve();
    }
    retryCursor.current = cursor;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    return listAdminCoupons(cursor, controller.signal)
      .then((result) => {
        if (controller.signal.aborted || !mounted.current) {
          return;
        }
        setItems((current) => (cursor ? mergeCouponPages(current, result.items) : result.items));
        setNextCursor(result.nextCursor);
        setChangeErrors((current) =>
          Object.fromEntries(
            Object.entries(current).filter(([id]) => !result.items.some((item) => item.id === id)),
          ),
        );
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || !mounted.current) {
          return;
        }
        const kind = getCouponRequestError(error);
        if (kind === 'unauthorized' || kind === 'forbidden') {
          setDenied(kind);
          setItems([]);
        } else {
          setFailed(true);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted && mounted.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      });
  }, []);

  function load(cursor?: string): void {
    if (mutationRequest.current) {
      // Creation/reconciliation can finish while PATCH owns the register. Refresh afterward.
      if (!cursor) {
        refreshAfterMutation.current = true;
      }
      return;
    }
    setLoading(!cursor);
    setLoadingMore(Boolean(cursor));
    setFailed(false);
    void readPage(cursor);
  }

  useEffect(() => {
    mounted.current = true;
    void readPage();
    return () => {
      mounted.current = false;
      request.current?.abort();
      mutationRequest.current?.abort();
      refreshAfterMutation.current = false;
    };
  }, [readPage]);

  async function changeCoupon(
    coupon: AdminCoupon,
    action: { type: 'activation' } | { type: 'capacity'; maxUses: number },
  ): Promise<string | null> {
    if (mutationRequest.current || changeErrors[coupon.id]) {
      return null;
    }
    // Stop older list results from overwriting the authoritative PATCH response.
    request.current?.abort();
    setLoading(false);
    setLoadingMore(false);
    const controller = new AbortController();
    mutationRequest.current = controller;
    setChangingId(coupon.id);
    setChangingAction(action.type);
    let keepDialog = false;
    try {
      const updated =
        action.type === 'activation'
          ? await setAdminCouponActivation(coupon.id, { active: !coupon.active }, controller.signal)
          : await increaseAdminCouponCapacity(
              coupon.id,
              { maxUses: action.maxUses },
              controller.signal,
            );
      if (controller.signal.aborted || !mounted.current) {
        return null;
      }
      setItems((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      toast.success(
        action.type === 'activation'
          ? updated.active
            ? copy.activated
            : copy.deactivated
          : copy.capacitySaved.replace(
              '{count}',
              updated.maxUses.toLocaleString(language === 'th' ? 'th-TH' : 'en-US'),
            ),
      );
    } catch (error) {
      if (controller.signal.aborted || !mounted.current) {
        return null;
      }
      const kind = getCouponRequestError(error);
      if (kind === 'unauthorized' || kind === 'forbidden') {
        refreshAfterMutation.current = false;
        toast.error(kind === 'unauthorized' ? copy.session : copy.denied);
        setDenied(kind);
        setItems([]);
      } else if (action.type === 'capacity') {
        const failure = getCouponCapacityError(error);
        const message = {
          inactive: copy.capacityInactive,
          expired: copy.capacityExpired,
          decrease: copy.capacityStale,
          missing: copy.capacityMissing,
          validation: copy.capacityInvalid,
          uncertain: copy.capacityUncertain,
        }[failure];
        toast.error(message);
        if (failure === 'validation') {
          keepDialog = true;
          return message;
        }
        setChangeErrors((current) => ({ ...current, [coupon.id]: message }));
      } else {
        setChangeErrors((current) => ({ ...current, [coupon.id]: copy.activationUncertain }));
        toast.error(copy.activationUncertain);
      }
    } finally {
      mutationRequest.current = null;
      if (!controller.signal.aborted && mounted.current) {
        setActivationTarget(null);
        if (!keepDialog) setCapacityTarget(null);
        setChangingId(null);
        setChangingAction(null);
        if (refreshAfterMutation.current) {
          refreshAfterMutation.current = false;
          load();
        }
      }
    }
    return null;
  }

  function created(coupon: AdminCoupon): void {
    // Cancel older pagination/initial reads before refetching the authoritative first page.
    // Retain the POST result if that refresh fails, so a successful creation never looks lost.
    setItems((current) => [coupon, ...current.filter((item) => item.id !== coupon.id)]);
    setNextCursor(null);
    void load();
  }

  if (denied) {
    return <AccessMessage kind={denied} />;
  }
  return (
    <div className="@container/coupons min-w-0 pt-6 pb-12 text-notebook-ink [font-family:var(--font-body-family)]">
      <header className="mb-7">
        <p className="font-note text-[1.4rem] text-admin-deep">{copy.eyebrow}</p>
        <h1 className="mt-[0.3rem] mb-[0.6rem] text-[clamp(1.65rem,3vw,2.15rem)] font-bold">
          {copy.title}
        </h1>
        <p className="text-[0.95rem] text-notebook-muted-deep">{copy.intro}</p>
      </header>
      <div className="grid grid-cols-[minmax(0,21rem)_minmax(0,1fr)] items-start gap-6 @max-[850px]/coupons:grid-cols-1">
        <CouponCreateForm
          copy={copy}
          language={language}
          onCreated={created}
          onReconciled={() => void load()}
          onDenied={setDenied}
        />
        <CouponList
          items={items}
          copy={copy}
          language={language}
          loading={loading}
          loadingMore={loadingMore}
          changingId={changingId}
          changingAction={changingAction}
          changeErrors={changeErrors}
          onActivationChange={setActivationTarget}
          onCapacityChange={setCapacityTarget}
          failed={failed}
          nextCursor={nextCursor}
          onMore={() => {
            if (nextCursor && !loadingMore) {
              void load(nextCursor);
            }
          }}
          onRefresh={() => void load()}
          onRetry={() => void load(retryCursor.current)}
        />
      </div>
      <NotebookConfirmDialog
        open={activationTarget !== null}
        title={activationTarget?.active ? copy.confirmDeactivate : copy.confirmActivate}
        description={copy.activationHint}
        confirmLabel={activationTarget?.active ? copy.deactivate : copy.activate}
        role="admin"
        tone={activationTarget?.active ? 'danger' : 'primary'}
        busy={changingId !== null}
        onCancel={() => setActivationTarget(null)}
        onConfirm={async () => {
          if (activationTarget) {
            await changeCoupon(activationTarget, { type: 'activation' });
          }
        }}
      >
        {activationTarget && (
          <dl>
            <div>
              <dt>{copy.code}</dt>
              <dd>
                {activationTarget.code} · {activationTarget.percent}%
              </dd>
            </div>
            <div>
              <dt>{copy.available}</dt>
              <dd>
                {activationTarget.availableUses} / {activationTarget.maxUses}
              </dd>
            </div>
            <div>
              <dt>{copy.expiry}</dt>
              <dd>{formatBangkokDateTime(activationTarget.expiresAt, language)}</dd>
            </div>
          </dl>
        )}
      </NotebookConfirmDialog>
      {capacityTarget && (
        <CouponCapacityDialog
          key={capacityTarget.id}
          coupon={capacityTarget}
          copy={copy}
          language={language}
          busy={changingId !== null}
          onCancel={() => setCapacityTarget(null)}
          onConfirm={(maxUses) => changeCoupon(capacityTarget, { type: 'capacity', maxUses })}
        />
      )}
    </div>
  );
}

function AdminWorkspace({ user }: { user: AuthUser }) {
  const { logout } = useAuth();
  return (
    <DashboardShell user={user} onLogout={logout} avatarEnabled={false}>
      <CouponWorkspace key={user.id} />
    </DashboardShell>
  );
}

export default function AdminCouponPage() {
  const { user, isLoading } = useAuth();
  if (isLoading) {
    return <DashboardLoading />;
  }
  if (!user || user.role !== 'ADMIN') {
    return (
      <NotebookPage>
        <AccessMessage kind={user ? 'forbidden' : 'unauthorized'} />
      </NotebookPage>
    );
  }
  return <AdminWorkspace user={user} />;
}
