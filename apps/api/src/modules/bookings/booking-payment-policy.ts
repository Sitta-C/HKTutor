export const PAYMENT_DEADLINE_MS = 4 * 60 * 60 * 1000;

export function bookingPaymentDeadline(startAtUtc: Date): Date {
  return new Date(startAtUtc.getTime() - PAYMENT_DEADLINE_MS);
}
