import { Module } from '@nestjs/common';

import { ConversationsController } from '@/conversations/conversations.controller';
import { ConversationsService } from '@/conversations/conversations.service';

@Module({
  controllers: [ConversationsController],
  providers: [ConversationsService],
})
export class ConversationsModule {}
