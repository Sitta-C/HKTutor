const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ConversationInvalidation {
  conversationId: string;
}

/** Socket data only selects a REST refetch; message contents are never consumed here. */
function isConversationInvalidation(value: unknown): value is ConversationInvalidation {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'conversationId' in value &&
    typeof value.conversationId === 'string' &&
    UUID.test(value.conversationId)
  );
}

export function isMessageCreatedEvent(value: unknown): value is ConversationInvalidation {
  return isConversationInvalidation(value);
}

export function isMessagesReadEvent(value: unknown): value is ConversationInvalidation {
  return isConversationInvalidation(value);
}
