import { Injectable, Logger } from '@nestjs/common';

import type {
  MessageCreatedPayload,
  MessagesReadPayload,
} from '@modules/conversations/conversations.socket-contract';

export type ConversationEvent =
  | { type: 'message_created'; recipientUserId: string; payload: MessageCreatedPayload }
  | { type: 'messages_read'; recipientUserId: string; payload: MessagesReadPayload };

/**
 * In-process hand-off from committed REST writes to the chat gateway. Publishing happens after
 * the write and never fails it; delivery still rechecks the recipient before each emit.
 */
@Injectable()
export class ConversationEvents {
  private readonly logger = new Logger(ConversationEvents.name);
  private readonly listeners = new Set<(event: ConversationEvent) => void>();

  subscribe(listener: (event: ConversationEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  publish(event: ConversationEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        // Only the event type and error class: never message text or user IDs.
        this.logger.warn(
          `Chat ${event.type} hand-off failed (${error instanceof Error ? error.name : 'unknown'})`,
        );
      }
    }
  }
}
