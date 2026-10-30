import { Module } from '@nestjs/common';

import { ConversationEvents } from '@modules/conversations/conversation-events';
import { ConversationsController } from '@modules/conversations/conversations.controller';
import { ConversationsGateway } from '@modules/conversations/conversations.gateway';
import { ConversationsService } from '@modules/conversations/conversations.service';

@Module({
  controllers: [ConversationsController],
  providers: [ConversationEvents, ConversationsService, ConversationsGateway],
  exports: [ConversationsGateway],
})
export class ConversationsModule {}
