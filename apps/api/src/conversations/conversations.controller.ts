import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '@/auth/auth.decorator';
import { JwtAuthGuard } from '@/auth/auth.guard';
import { Roles } from '@/auth/roles.decorator';
import { RolesGuard } from '@/auth/roles.guard';
import { UuidParamPipe } from '@/common/pipes/uuid-param.pipe';
import {
  ConversationSummaryDto,
  CreateConversationDto,
  GetMyConversationsQueryDto,
  MessageResponseDto,
  MyConversationsResponseDto,
  SendMessageDto,
} from '@/conversations/conversations.dto';
import { ConversationsService } from '@/conversations/conversations.service';
import {
  ConversationsControllerDoc,
  GetMyConversationsDoc,
  OpenConversationDoc,
  SendMessageDoc,
} from '@/conversations/conversations.swagger';
import { Role } from '@/generated/prisma/client';

import type { AuthenticatedUser } from '@/auth/auth.guard';
import type { Response } from 'express';

@ConversationsControllerDoc()
@Controller('conversations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Post()
  @OpenConversationDoc()
  @Roles(Role.STUDENT)
  async openConversation(
    @Body() dto: CreateConversationDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ConversationSummaryDto> {
    const { conversation, created } = await this.conversationsService.openConversation({
      ...dto,
      studentUserId: user.id,
    });

    // Nest sets the default 201 before the handler runs, so this status is the one sent.
    response.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return conversation;
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @GetMyConversationsDoc()
  @Roles(Role.STUDENT, Role.TUTOR)
  async getMyConversations(
    @Query() query: GetMyConversationsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MyConversationsResponseDto> {
    return this.conversationsService.getMyConversations({
      ...query,
      role: user.role,
      userId: user.id,
    });
  }

  @Post(':conversationId/messages')
  @HttpCode(HttpStatus.CREATED)
  @SendMessageDoc()
  @Roles(Role.STUDENT, Role.TUTOR)
  async sendMessage(
    @Param('conversationId', UuidParamPipe) conversationId: string,
    @Body() dto: SendMessageDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MessageResponseDto> {
    return this.conversationsService.sendMessage({
      ...dto,
      conversationId,
      senderUserId: user.id,
    });
  }
}
