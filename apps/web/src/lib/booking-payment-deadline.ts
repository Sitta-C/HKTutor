export const PAYMENT_DEADLINE_MS = 4 * 60 * 60 * 1000;

export function bookingPaymentDeadline(startAtUtc: string): number {
  return Date.parse(startAtUtc) - PAYMENT_DEADLINE_MS;
}

export function hasPaymentDeadlinePassed(startAtUtc: string, now: number): boolean {
  return now >= bookingPaymentDeadline(startAtUtc);
}
