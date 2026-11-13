'use client';

import { bookingCouponCopy } from '@/components/bookings/booking-coupon-copy';
import { getBookingCouponFailure } from '@/components/bookings/booking-coupon-model';
import { BookingCouponStrip } from '@/components/bookings/booking-coupon-strip';
import { BookingDocketAmounts, BookingDocketTotal } from '@/components/bookings/booking-docket';
import { PromptPayPaymentPanel } from '@/components/bookings/promptpay-payment-panel';
import { studentBookingsCopy } from '@/components/bookings/student-bookings-copy';
import { useBookingCheckout } from '@/components/bookings/use-booking-checkout';
import { useLanguage } from '@/lib/i18n';

import styles from './student-booking-checkout.module.css';

import type { CheckoutSubmissionChange } from '@/components/bookings/use-booking-checkout';
import type { BookingDetail } from '@/lib/api/types';

export function StudentBookingCheckout({
  booking,
  disabled,
  onBookingChange,
  onSubmittingChange,
}: {
  booking: BookingDetail;
  disabled: boolean;
  onBookingChange: (booking: BookingDetail) => void;
  onSubmittingChange: CheckoutSubmissionChange;
}) {
  const { language, copy } = useLanguage();
  const text = bookingCouponCopy[language];
  const checkout = useBookingCheckout({ booking, disabled, onBookingChange, onSubmittingChange });

  return (
    <div className={styles.columns}>
      <div className={styles.amountColumn}>
        <BookingCouponStrip
          booking={booking}
          disabled={!checkout.canMutate}
          pending={checkout.pending}
          verified={checkout.verification === 'ready'}
          verificationFailed={checkout.verification === 'failed'}
          operation={checkout.operation}
          error={
            checkout.failure?.scope === 'coupon'
              ? getBookingCouponFailure(checkout.failure.error, text).message
              : null
          }
          onApply={checkout.applyCoupon}
          onRemove={checkout.removeCoupon}
        />
        <div className={styles.amounts}>
          <BookingDocketAmounts
            amounts={booking}
            text={copy.dashboard.booking}
            discountPercent={booking.coupon?.percent}
          />
        </div>
        <div className={styles.total}>
          <BookingDocketTotal
            amount={booking.netAmount}
            currency={booking.currency}
            label={studentBookingsCopy[language].amount}
          />
        </div>
        <p className={styles.help}>{text.authoritative}</p>
      </div>
      <PromptPayPaymentPanel booking={booking} checkout={checkout} />
    </div>
  );
}
