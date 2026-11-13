// Payment and confirmation close at the lesson start, with no advance cutoff.
export const PAYMENT_DEADLINE_MS = 0;

export function bookingPaymentDeadline(startAtUtc: string): number {
  return Date.parse(startAtUtc) - PAYMENT_DEADLINE_MS;
}

export function hasPaymentDeadlinePassed(startAtUtc: string, now: number): boolean {
  return now >= bookingPaymentDeadline(startAtUtc);
}
