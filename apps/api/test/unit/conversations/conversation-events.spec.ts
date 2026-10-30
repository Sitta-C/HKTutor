import { Logger } from '@nestjs/common';

import { ConversationEvents } from '@modules/conversations/conversation-events';

import type { ConversationEvent } from '@modules/conversations/conversation-events';

describe('ConversationEvents', () => {
  const event: ConversationEvent = {
    type: 'messages_read',
    recipientUserId: '11111111-1111-4111-8111-111111111111',
    payload: {
      conversationId: '22222222-2222-4222-8222-222222222222',
      messageIds: ['33333333-3333-4333-8333-333333333333'],
      readByUserId: '44444444-4444-4444-8444-444444444444',
      readAt: '2026-11-10T11:00:00.000Z',
    },
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('hands each published event to every subscriber until it unsubscribes', () => {
    const events = new ConversationEvents();
    const first = jest.fn();
    const second = jest.fn();
    const unsubscribe = events.subscribe(first);
    events.subscribe(second);
    events.publish(event);
    unsubscribe();
    events.publish(event);
    expect(first).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledWith(event);
    expect(second).toHaveBeenCalledTimes(2);
  });

  it('never throws to the publisher and logs only the event type and error class', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const events = new ConversationEvents();
    const after = jest.fn();
    events.subscribe(() => {
      throw new TypeError(`leaked ${event.payload.readByUserId}`);
    });
    events.subscribe(after);
    expect(() => events.publish(event)).not.toThrow();
    expect(after).toHaveBeenCalledWith(event);
    expect(warn).toHaveBeenCalledWith('Chat messages_read hand-off failed (TypeError)');
  });
});
