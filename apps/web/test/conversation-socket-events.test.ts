import { describe, expect, it } from 'vitest';

import { isMessageCreatedEvent, isMessagesReadEvent } from '@/lib/conversation-socket-events';

const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const message = {
  messageId: id,
  conversationId: id,
  senderId: other,
  text: 'สวัสดี 😀',
  sentAt: '2026-10-31T03:00:00.000Z',
  readAt: null,
};
const read = {
  conversationId: id,
  messageIds: [id],
  readByUserId: other,
  readAt: '2026-10-31T04:00:00.000Z',
};

describe('fixed T01/T02 socket event contracts', () => {
  it('accepts persisted messages, UTC read receipts and the 2,000 Unicode-point boundary', () => {
    expect(isMessageCreatedEvent(message)).toBe(true);
    expect(isMessageCreatedEvent({ ...message, readAt: read.readAt })).toBe(true);
    expect(isMessageCreatedEvent({ ...message, text: '😀'.repeat(2000) })).toBe(true);
    expect(isMessagesReadEvent(read)).toBe(true);
  });
  it('accepts a full 100-ID batch and rejects case-insensitive duplicate IDs', () => {
    const messageIds = Array.from(
      { length: 100 },
      (_, index) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`,
    );
    expect(isMessagesReadEvent({ ...read, messageIds })).toBe(true);
    const duplicate = messageIds[0] ?? '';
    expect(isMessagesReadEvent({ ...read, messageIds: [duplicate, duplicate.toUpperCase()] })).toBe(
      false,
    );
  });
  it.each([
    null,
    [],
    '',
    {},
    { conversationId: id },
    { ...message, messageId: 'not-a-uuid' },
    { ...message, senderId: 1 },
    { ...message, text: '  ' },
    { ...message, text: '😀'.repeat(2001) },
    { ...message, sentAt: '2026-02-30T03:00:00.000Z' },
    { ...message, sentAt: '2026-10-31T10:00:00.000+07:00' },
    { ...message, readAt: '2026-10-30T03:00:00.000Z' },
    { ...message, readAt: undefined },
    { ...message, privateProfile: {} },
  ])('rejects malformed messages without trusting pushed data', (payload) => {
    expect(isMessageCreatedEvent(payload)).toBe(false);
  });
  it.each([
    null,
    [],
    {},
    { conversationId: id },
    { ...read, messageIds: [] },
    { ...read, messageIds: [id, id] },
    { ...read, messageIds: ['not-a-uuid'] },
    { ...read, readByUserId: null },
    { ...read, readAt: 'not-an-instant' },
    { ...read, extra: true },
    {
      ...read,
      messageIds: Array.from(
        { length: 101 },
        (_, index) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`,
      ),
    },
  ])('rejects malformed, duplicate or oversized read batches', (payload) => {
    expect(isMessagesReadEvent(payload)).toBe(false);
  });
});
