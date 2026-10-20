export const UNREAD_MESSAGES_CHANGED_EVENT = 'hktutor-unread-messages-changed';

export function notifyUnreadMessagesChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(UNREAD_MESSAGES_CHANGED_EVENT));
  }
}
