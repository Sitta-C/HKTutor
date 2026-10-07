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

import { UuidParamPipe } from '@common/pipes/uuid-param.pipe';
import { Role } from '@generated/prisma/client';
import { CurrentUser } from '@modules/auth/auth.decorator';
import { JwtAuthGuard } from '@modules/auth/auth.guard';
import { Roles } from '@modules/auth/roles.decorator';
import { RolesGuard } from '@modules/auth/roles.guard';
import {
  CreateConversationDto,
  GetMessagesQueryDto,
  GetMyConversationsQueryDto,
  MarkMessagesReadDto,
  MarkMessagesReadResponseDto,
  MessageHistoryResponseDto,
  MessageResponseDto,
  MyConversationsResponseDto,
  OpenConversationResponseDto,
  SendMessageDto,
} from '@modules/conversations/conversations.dto';
import { ConversationsService } from '@modules/conversations/conversations.service';
import {
  ConversationsControllerDoc,
  GetMessagesDoc,
  GetMyConversationsDoc,
  MarkMessagesReadDoc,
  OpenConversationDoc,
  SendMessageDoc,
} from '@modules/conversations/conversations.swagger';

import type { AuthenticatedUser } from '@modules/auth/auth.guard';
import type { Response } from 'express';

@ConversationsControllerDoc()
@Controller('conversations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Post()
  @OpenConversationDoc()
  @Roles(Role.STUDENT, Role.TUTOR)
  async openConversation(
    @Body() dto: CreateConversationDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<OpenConversationResponseDto> {
    const { conversation, created } = await this.conversationsService.openConversation({
      ...dto,
      role: user.role,
      userId: user.id,
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

  @Get(':conversationId/messages')
  @HttpCode(HttpStatus.OK)
  @GetMessagesDoc()
  @Roles(Role.STUDENT, Role.TUTOR)
  async getMessages(
    @Param('conversationId', UuidParamPipe) conversationId: string,
    @Query() query: GetMessagesQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MessageHistoryResponseDto> {
    return this.conversationsService.getMessages({
      ...query,
      conversationId,
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

  @Post(':conversationId/read')
  @HttpCode(HttpStatus.OK)
  @MarkMessagesReadDoc()
  @Roles(Role.STUDENT, Role.TUTOR)
  async markMessagesRead(
    @Param('conversationId', UuidParamPipe) conversationId: string,
    @Body() dto: MarkMessagesReadDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MarkMessagesReadResponseDto> {
    return this.conversationsService.markMessagesRead({
      ...dto,
      conversationId,
      userId: user.id,
    });
  }
}
