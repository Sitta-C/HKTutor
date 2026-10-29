import { Module } from '@nestjs/common';

import { ConversationsController } from '@modules/conversations/conversations.controller';
import { ConversationsGateway } from '@modules/conversations/conversations.gateway';
import { ConversationsService } from '@modules/conversations/conversations.service';

@Module({
  controllers: [ConversationsController],
  providers: [ConversationsService, ConversationsGateway],
  exports: [ConversationsGateway],
})
export class ConversationsModule {}
