'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { couponCopy } from '@/components/coupons/coupon-copy';
import { CouponCreateForm } from '@/components/coupons/coupon-create-form';
import { CouponList } from '@/components/coupons/coupon-list';
import { getCouponRequestError, mergeCouponPages } from '@/components/coupons/coupon-model';
import { DashboardLoading } from '@/components/dashboard/dashboard-loading';
import DashboardShell from '@/components/dashboard/dashboard-shell';
import { NotebookPage } from '@/components/ui/notebook';
import { useNotebookToast } from '@/components/ui/notebook-toast';
import { listAdminCoupons, setAdminCouponActivation } from '@/lib/api/coupons';
import { useAuth } from '@/lib/auth-context';
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
  const activationRequest = useRef<AbortController | null>(null);
  const refreshAfterActivation = useRef(false);
  const [changingId, setChangingId] = useState<string | null>(null);
  const [uncertainIds, setUncertainIds] = useState<string[]>([]);
  const toast = useNotebookToast();

  const readPage = useCallback((cursor?: string) => {
    if (activationRequest.current) {
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
        setUncertainIds((current) =>
          current.filter((id) => !result.items.some((item) => item.id === id)),
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
    if (activationRequest.current) {
      // Creation/reconciliation can finish while PATCH owns the register. Refresh afterward.
      if (!cursor) {
        refreshAfterActivation.current = true;
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
      activationRequest.current?.abort();
      refreshAfterActivation.current = false;
    };
  }, [readPage]);

  async function changeActivation(coupon: AdminCoupon): Promise<void> {
    if (activationRequest.current || uncertainIds.includes(coupon.id)) {
      return;
    }
    // Stop older list results from overwriting the authoritative PATCH response.
    request.current?.abort();
    setLoading(false);
    setLoadingMore(false);
    const controller = new AbortController();
    activationRequest.current = controller;
    setChangingId(coupon.id);
    try {
      const updated = await setAdminCouponActivation(
        coupon.id,
        { active: !coupon.active },
        controller.signal,
      );
      if (controller.signal.aborted || !mounted.current) {
        return;
      }
      setItems((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      toast.success(updated.active ? copy.activated : copy.deactivated);
    } catch (error) {
      if (controller.signal.aborted || !mounted.current) {
        return;
      }
      const kind = getCouponRequestError(error);
      if (kind === 'unauthorized' || kind === 'forbidden') {
        refreshAfterActivation.current = false;
        setDenied(kind);
        setItems([]);
      } else {
        setUncertainIds((current) => [...current.filter((id) => id !== coupon.id), coupon.id]);
        toast.error(copy.activationUncertain);
      }
    } finally {
      activationRequest.current = null;
      if (!controller.signal.aborted && mounted.current) {
        setChangingId(null);
        if (refreshAfterActivation.current) {
          refreshAfterActivation.current = false;
          load();
        }
      }
    }
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
          uncertainIds={uncertainIds}
          onActivationChange={(coupon) => void changeActivation(coupon)}
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
