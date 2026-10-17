import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { UuidParamPipe } from '@common/pipes/uuid-param.pipe';
import { CurrentUser } from '@modules/auth/auth.decorator';
import { JwtAuthGuard } from '@modules/auth/auth.guard';
import {
  GetNotificationsQueryDto,
  NotificationEmptyInputDto,
  NotificationReadResponseDto,
  NotificationsReadAllResponseDto,
  NotificationsResponseDto,
} from '@modules/notifications/notifications.dto';
import { NotificationsService } from '@modules/notifications/notifications.service';
import {
  ListNotificationsDoc,
  MarkAllNotificationsReadDoc,
  MarkNotificationReadDoc,
  NotificationsControllerDoc,
} from '@modules/notifications/notifications.swagger';

import type { AuthenticatedUser } from '@modules/auth/auth.guard';

@NotificationsControllerDoc()
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ListNotificationsDoc()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: GetNotificationsQueryDto,
  ): Promise<NotificationsResponseDto> {
    return this.notifications.list(user.id, query);
  }

  @Patch(':notificationId/read')
  @MarkNotificationReadDoc()
  markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('notificationId', UuidParamPipe) notificationId: string,
    @Query() _query: NotificationEmptyInputDto,
    @Body() _body: NotificationEmptyInputDto,
  ): Promise<NotificationReadResponseDto> {
    void _query;
    void _body;
    return this.notifications.markRead(user.id, notificationId);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @MarkAllNotificationsReadDoc()
  markAllRead(
    @CurrentUser() user: AuthenticatedUser,
    @Query() _query: NotificationEmptyInputDto,
    @Body() _body: NotificationEmptyInputDto,
  ): Promise<NotificationsReadAllResponseDto> {
    void _query;
    void _body;
    return this.notifications.markAllRead(user.id);
  }
}
