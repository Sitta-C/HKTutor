export const NOTIFICATIONS_CHANGED_EVENT = 'hktutor-notifications-changed';

export function notificationChannelName(userId: string): string {
  return `hktutor-notifications:${userId}`;
}

/** Only invalidation signals cross tabs; notification content never enters browser storage. */
export function notifyNotificationsChanged(userId?: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
  if (!userId || typeof BroadcastChannel === 'undefined') {
    return;
  }
  try {
    const channel = new BroadcastChannel(notificationChannelName(userId));
    channel.postMessage('changed');
    channel.close();
  } catch {
    // Visible-tab polling still reconciles when cross-tab messaging is unavailable.
  }
}
