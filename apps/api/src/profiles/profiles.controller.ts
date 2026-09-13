import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';

import { CurrentUser } from '@/auth/auth.decorator';
import { JwtAuthGuard } from '@/auth/auth.guard';
import { Roles } from '@/auth/roles.decorator';
import { RolesGuard } from '@/auth/roles.guard';
import { Role } from '@/generated/prisma/client';
import { SaveStudentProfileDto, SaveTutorProfileDto } from '@/profiles/profiles.dto';
import { ProfilesService } from '@/profiles/profiles.service';
import {
  GetMyProfileDoc,
  ProfilesControllerDoc,
  SaveStudentProfileDoc,
  SaveTutorProfileDoc,
} from '@/profiles/profiles.swagger';

import type { AuthenticatedUser } from '@/auth/auth.guard';

@ProfilesControllerDoc()
@UseGuards(JwtAuthGuard)
@Controller('profiles/me')
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  @Get()
  @GetMyProfileDoc()
  getMine(@CurrentUser() user: AuthenticatedUser) {
    return this.profiles.getMine(user);
  }

  @Put('student')
  @UseGuards(RolesGuard)
  @Roles(Role.STUDENT)
  @SaveStudentProfileDoc()
  saveStudent(@CurrentUser() user: AuthenticatedUser, @Body() dto: SaveStudentProfileDto) {
    return this.profiles.saveStudent(user.id, dto);
  }

  @Put('tutor')
  @UseGuards(RolesGuard)
  @Roles(Role.TUTOR)
  @SaveTutorProfileDoc()
  saveTutor(@CurrentUser() user: AuthenticatedUser, @Body() dto: SaveTutorProfileDto) {
    return this.profiles.saveTutor(user.id, dto);
  }
}
