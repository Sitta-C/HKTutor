export const NOTIFICATIONS_CHANGED_EVENT = 'hktutor-notifications-changed';

let sourceId: string | undefined;

function notificationSourceId(): string {
  sourceId ??= crypto.randomUUID();
  return sourceId;
}

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
    channel.postMessage({ type: 'changed', sourceId: notificationSourceId() });
    channel.close();
  } catch {
    // Visible-tab polling still reconciles when cross-tab messaging is unavailable.
  }
}

/** Local events handle this tab; channel messages handle only other tabs for this user. */
export function subscribeNotificationsChanged(userId: string, refresh: () => void): () => void {
  window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, refresh);
  let channel: BroadcastChannel | null = null;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(notificationChannelName(userId));
      channel.onmessage = (event: MessageEvent<unknown>) => {
        const data = event.data;
        if (
          typeof data === 'object' &&
          data !== null &&
          'type' in data &&
          data.type === 'changed' &&
          'sourceId' in data &&
          typeof data.sourceId === 'string' &&
          data.sourceId !== notificationSourceId()
        ) {
          refresh();
        }
      };
    }
  } catch {
    // Local events and polling still work when cross-tab messaging is unavailable.
  }
  return () => {
    window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, refresh);
    channel?.close();
  };
}
