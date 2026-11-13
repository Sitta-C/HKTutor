export const NOTIFICATION_LINK_PARAM = 'notification';

// Only intent metadata lives here, briefly, in this tab's memory. A new tab has no local intent.
const localOpens = new Map<string, number>();
const OPEN_INTENT_TTL_MS = 60_000;

export function rememberNotificationOpen(userId: string, notificationId: string): void {
  localOpens.set(JSON.stringify([userId, notificationId]), Date.now() + OPEN_INTENT_TTL_MS);
  if (localOpens.size > 100) {
    const oldest = localOpens.keys().next().value;
    if (oldest !== undefined) {
      localOpens.delete(oldest);
    }
  }
}

/** The originating inbox already owns its same-tab receipt, including queued writes and errors. */
export function consumeNotificationOpen(userId: string, notificationId: string): boolean {
  const key = JSON.stringify([userId, notificationId]);
  const expiresAt = localOpens.get(key);
  localOpens.delete(key);
  return expiresAt !== undefined && expiresAt > Date.now();
}
