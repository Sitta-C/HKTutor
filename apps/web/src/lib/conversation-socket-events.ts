import type { ConversationMessage, ConversationMessagesReadEvent } from '@/lib/api/types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function uuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

function instant(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

export function isMessageCreatedEvent(value: unknown): value is ConversationMessage {
  return (
    record(value) &&
    exactKeys(value, ['messageId', 'conversationId', 'senderId', 'text', 'sentAt', 'readAt']) &&
    uuid(value.messageId) &&
    uuid(value.conversationId) &&
    uuid(value.senderId) &&
    typeof value.text === 'string' &&
    value.text.trim().length > 0 &&
    Array.from(value.text).length <= 2000 &&
    instant(value.sentAt) &&
    (value.readAt === null || (instant(value.readAt) && value.readAt >= value.sentAt))
  );
}

export function isMessagesReadEvent(value: unknown): value is ConversationMessagesReadEvent {
  return (
    record(value) &&
    exactKeys(value, ['conversationId', 'messageIds', 'readByUserId', 'readAt']) &&
    uuid(value.conversationId) &&
    uuid(value.readByUserId) &&
    instant(value.readAt) &&
    Array.isArray(value.messageIds) &&
    value.messageIds.length > 0 &&
    value.messageIds.length <= 100 &&
    value.messageIds.every(uuid) &&
    new Set(value.messageIds.map((id) => id.toLowerCase())).size === value.messageIds.length
  );
}
