'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { bookingCouponCopy } from '@/components/bookings/booking-coupon-copy';
import {
  getBookingCouponFailure,
  getBookingPaymentFailure,
  hasActiveBookingPayment,
  isBookingDeadlineRejection,
  isCouponPaymentRejection,
  isFullCouponSettlement,
} from '@/components/bookings/booking-coupon-model';
import { useNotebookToast } from '@/components/ui/notebook-toast';
import {
  applyBookingCoupon,
  createPromptPayPayment,
  getCurrentPayment,
  getMyBooking,
  removeBookingCoupon,
} from '@/lib/api/bookings';
import { useLanguage } from '@/lib/i18n';
import { notifyNotificationsChanged } from '@/lib/notification-events';
import { useBookingPaymentDeadline } from '@/lib/use-booking-payment-deadline';

import type { BookingDetail, PromptPayPayment } from '@/lib/api/types';

export type CheckoutOperation = 'apply' | 'remove' | 'pay';
export type CheckoutSubmissionChange = (busy: boolean, token: symbol) => void;
export interface CheckoutFailure {
  error: unknown;
  scope: 'coupon' | 'payment';
  couponCode: string | null;
}
export interface BookingCheckout {
  payment: PromptPayPayment | null;
  verification: 'checking' | 'ready' | 'failed';
  readFailed: boolean;
  failure: CheckoutFailure | null;
  operation: CheckoutOperation | null;
  checkedAt: number;
  paid: boolean;
  pending: boolean;
  canMutate: boolean;
  canPay: boolean;
  canRefresh: boolean;
  zeroNet: boolean;
  deadlinePassed: boolean;
  deadlineAt: number;
  applyCoupon: (code: string) => Promise<boolean>;
  removeCoupon: () => Promise<boolean>;
  createPayment: () => Promise<void>;
  refresh: () => void;
}

// A late completion must not release a newer checkout's submission lock.
export function updateCheckoutSubmission(
  current: symbol | null,
  busy: boolean,
  token: symbol,
): symbol | null {
  return busy ? token : current === token ? null : current;
}

async function readCheckout(bookingId: string, signal?: AbortSignal) {
  // GET current can settle/release a payment. Read the booking AFTER that reconciliation.
  const payment = await getCurrentPayment(bookingId, signal);
  const booking = await getMyBooking(bookingId, signal);
  return { payment, booking };
}

export function useBookingCheckout({
  booking,
  disabled,
  onBookingChange,
  onSubmittingChange,
}: {
  booking: BookingDetail;
  disabled: boolean;
  onBookingChange: (booking: BookingDetail) => void;
  onSubmittingChange: CheckoutSubmissionChange;
}): BookingCheckout {
  const { language } = useLanguage();
  const toast = useNotebookToast();
  const copy = bookingCouponCopy[language];
  const [payment, setPayment] = useState<PromptPayPayment | null>(null);
  const [verification, setVerification] = useState<BookingCheckout['verification']>('checking');
  const [readFailed, setReadFailed] = useState(false);
  const [failure, setFailure] = useState<CheckoutFailure | null>(null);
  const [operation, setOperation] = useState<CheckoutOperation | null>(null);
  const [checkedAt, setCheckedAt] = useState(0);
  const [reload, setReload] = useState(0);
  const [serverClosedWindow, setServerClosedWindow] = useState<string | null>(null);
  const windowKey = `${booking.id}:${booking.slot.startAtUtc}`;
  const gate = useRef<symbol | null>(null);
  const writeToken = useRef<symbol | null>(null);
  const mounted = useRef(false);
  const paymentNotificationState = useRef<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (writeToken.current) {
        onSubmittingChange(false, writeToken.current);
      }
    };
  }, [onSubmittingChange]);

  const commitSnapshot = useCallback(
    (snapshot: Awaited<ReturnType<typeof readCheckout>>): void => {
      const notificationState = `${snapshot.booking.id}:${snapshot.payment.paymentStatus}:${snapshot.payment.attempt?.id ?? ''}:${snapshot.payment.attempt?.status ?? ''}`;
      if (paymentNotificationState.current !== notificationState) {
        paymentNotificationState.current = notificationState;
        notifyNotificationsChanged();
      }
      setPayment(snapshot.payment);
      setCheckedAt(Date.now());
      setVerification('ready');
      setReadFailed(false);
      // A status read unlocks removal; it must not erase why the applied coupon cannot be paid.
      setFailure((current) =>
        current?.scope === 'payment' &&
        isCouponPaymentRejection(current.error) &&
        current.couponCode === snapshot.booking.coupon?.code &&
        snapshot.booking.status === 'CONFIRMED' &&
        snapshot.booking.paymentStatus === 'UNPAID'
          ? current
          : null,
      );
      onBookingChange(snapshot.booking);
    },
    [onBookingChange],
  );

  useEffect(() => {
    if (disabled) {
      return;
    }
    let active = true;
    let readToken: symbol | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    async function poll(): Promise<void> {
      if (!active) {
        return;
      }
      if (document.hidden || gate.current) {
        timer = setTimeout(() => void poll(), 5000);
        return;
      }
      const token = Symbol('checkout-read');
      readToken = token;
      gate.current = token;
      try {
        const snapshot = await readCheckout(booking.id, controller.signal);
        if (!active) {
          return;
        }
        commitSnapshot(snapshot);
        if (hasActiveBookingPayment(snapshot.booking, snapshot.payment)) {
          timer = setTimeout(() => void poll(), 5000);
        }
      } catch {
        if (active) {
          setReadFailed(true);
          setVerification('failed');
        }
      } finally {
        if (gate.current === token) {
          gate.current = null;
        }
      }
    }
    void poll();
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
      if (gate.current === readToken) {
        gate.current = null;
      }
    };
  }, [booking.id, disabled, commitSnapshot, reload]);

  const pending = hasActiveBookingPayment(booking, payment);
  const { deadlinePassed: localDeadlinePassed, deadlineAt } = useBookingPaymentDeadline(
    booking.slot.startAtUtc,
  );
  const deadlinePassed = localDeadlinePassed || serverClosedWindow === windowKey;
  const paid = booking.paymentStatus === 'PAID' || payment?.paymentStatus === 'PAID';
  const canMutate =
    verification === 'ready' &&
    !disabled &&
    operation === null &&
    !pending &&
    !paid &&
    booking.status === 'CONFIRMED' &&
    !deadlinePassed;
  const canPay =
    canMutate && !(failure?.scope === 'payment' && isCouponPaymentRejection(failure.error));

  function beginWrite(kind: CheckoutOperation): symbol {
    const token = Symbol(`checkout-${kind}`);
    gate.current = token;
    writeToken.current = token;
    setOperation(kind);
    setFailure(null);
    onSubmittingChange(true, token);
    return token;
  }

  function endWrite(token: symbol): void {
    if (gate.current === token) {
      gate.current = null;
    }
    if (writeToken.current === token) {
      writeToken.current = null;
    }
    onSubmittingChange(false, token);
    if (mounted.current) {
      setOperation(null);
    }
  }

  async function changeCoupon(code: string | null): Promise<boolean> {
    if (gate.current || !canMutate) {
      return false;
    }
    const token = beginWrite(code === null ? 'remove' : 'apply');
    try {
      const result =
        code === null
          ? await removeBookingCoupon(booking.id)
          : await applyBookingCoupon(booking.id, code);
      if (!mounted.current) {
        return false;
      }
      onBookingChange({
        ...booking,
        coupon: result.coupon,
        currency: result.currency,
        subtotalAmount: result.subtotalAmount,
        discountAmount: result.discountAmount,
        netAmount: result.netAmount,
        paymentStatus: result.paymentStatus,
        paymentPending: result.paymentPending,
      });
      setVerification('checking');
      try {
        const snapshot = await readCheckout(booking.id);
        if (!mounted.current) {
          return false;
        }
        commitSnapshot(snapshot);
        if (hasActiveBookingPayment(snapshot.booking, snapshot.payment)) {
          setReload((value) => value + 1);
        }
        toast.success(
          result.coupon
            ? copy.applied.replace('{percent}', String(result.coupon.percent))
            : copy.removed,
        );
        return true;
      } catch {
        if (mounted.current) {
          setReadFailed(true);
          setVerification('failed');
          toast.error(copy.uncertain);
        }
        return false;
      }
    } catch (error) {
      if (mounted.current) {
        toast.error(getBookingCouponFailure(error, copy).message);
        setFailure({ error, scope: 'coupon', couponCode: booking.coupon?.code ?? null });
        if (isBookingDeadlineRejection(error)) setServerClosedWindow(windowKey);
        if (getBookingCouponFailure(error, bookingCouponCopy[language]).requiresRefresh) {
          setVerification('failed');
        }
      }
      return false;
    } finally {
      endWrite(token);
    }
  }

  async function createPayment(): Promise<void> {
    if (gate.current || !canPay) {
      return;
    }
    const token = beginWrite('pay');
    try {
      const result = await createPromptPayPayment(booking.id);
      const nextBooking = await getMyBooking(booking.id);
      if (!mounted.current) {
        return;
      }
      commitSnapshot({ payment: result, booking: nextBooking });
      if (result.paymentStatus === 'PAID') toast.success(copy.paymentPaid);
      else if (result.attempt?.status === 'CREATING' || result.attempt?.status === 'PENDING')
        toast.success(copy.paymentReady);
      else toast.error(copy.paymentFailed);
      if (hasActiveBookingPayment(nextBooking, result)) {
        setReload((value) => value + 1);
      }
    } catch (error) {
      if (mounted.current) {
        toast.error(getBookingPaymentFailure(error, copy, copy.uncertain, Boolean(booking.coupon)));
        setFailure({ error, scope: 'payment', couponCode: booking.coupon?.code ?? null });
        if (isBookingDeadlineRejection(error)) setServerClosedWindow(windowKey);
        setVerification('failed');
      }
    } finally {
      endWrite(token);
    }
  }

  return {
    payment,
    verification,
    readFailed,
    failure,
    operation,
    checkedAt,
    paid,
    pending,
    canMutate,
    canPay,
    deadlinePassed,
    deadlineAt,
    zeroNet: isFullCouponSettlement(booking),
    canRefresh: operation === null && !disabled,
    applyCoupon: (code) => changeCoupon(code),
    removeCoupon: () => changeCoupon(null),
    createPayment,
    refresh: () => {
      if (operation !== null || disabled) {
        return;
      }
      setVerification('checking');
      setReadFailed(false);
      setReload((value) => value + 1);
    },
  };
}
