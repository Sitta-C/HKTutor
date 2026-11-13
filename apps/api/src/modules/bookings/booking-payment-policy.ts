// Payment and confirmation close at the lesson start, with no advance cutoff.
export const PAYMENT_DEADLINE_MS = 0;

export function bookingPaymentDeadline(startAtUtc: Date): Date {
  return new Date(startAtUtc.getTime() - PAYMENT_DEADLINE_MS);
}
