import {
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';

import { UuidParamPipe } from '@common/pipes/uuid-param.pipe';
import { Role } from '@generated/prisma/client';
import { AVATAR_MAX_SIZE_BYTES } from '@infrastructure/storage/storage.types';
import { CurrentUser } from '@modules/auth/auth.decorator';
import { JwtAuthGuard } from '@modules/auth/auth.guard';
import { Roles } from '@modules/auth/roles.decorator';
import { RolesGuard } from '@modules/auth/roles.guard';
import { AvatarsService } from '@modules/avatars/avatars.service';
import {
  AvatarsControllerDoc,
  DeleteAvatarDoc,
  GetMyAvatarDoc,
  GetPublicTutorAvatarDoc,
  UploadAvatarDoc,
} from '@modules/avatars/avatars.swagger';

import type { AuthenticatedUser } from '@modules/auth/auth.guard';
import type {
  AvatarMutationResponseDto,
  AvatarReadResponseDto,
} from '@modules/avatars/avatars.swagger';

@AvatarsControllerDoc()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.STUDENT, Role.TUTOR)
@Controller('profiles/me/avatar')
export class AvatarsController {
  constructor(private readonly avatars: AvatarsService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @GetMyAvatarDoc()
  getMine(@CurrentUser() user: AuthenticatedUser): Promise<AvatarReadResponseDto> {
    return this.avatars.getMine(user);
  }

  @Post()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      // Multer rejects at its limit; normalizeAvatar enforces the inclusive boundary.
      limits: { fileSize: AVATAR_MAX_SIZE_BYTES + 1, files: 1, fields: 0, parts: 2 },
    }),
  )
  @UploadAvatarDoc()
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<AvatarMutationResponseDto> {
    return this.avatars.upload(user, file);
  }

  @Delete()
  @DeleteAvatarDoc()
  remove(@CurrentUser() user: AuthenticatedUser): Promise<AvatarMutationResponseDto> {
    return this.avatars.remove(user);
  }
}

@Controller('tutors')
export class PublicTutorAvatarsController {
  constructor(private readonly avatars: AvatarsService) {}

  @Get(':tutorId/avatar')
  @Header('Cache-Control', 'private, no-store')
  @GetPublicTutorAvatarDoc()
  getPublicTutor(@Param('tutorId', UuidParamPipe) tutorId: string): Promise<AvatarReadResponseDto> {
    return this.avatars.getPublicTutor(tutorId);
  }
}
