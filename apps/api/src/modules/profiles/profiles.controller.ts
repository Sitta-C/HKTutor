import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';

import { Role } from '@generated/prisma/client';
import { CurrentUser } from '@modules/auth/auth.decorator';
import { JwtAuthGuard } from '@modules/auth/auth.guard';
import { Roles } from '@modules/auth/roles.decorator';
import { RolesGuard } from '@modules/auth/roles.guard';
import { SaveStudentProfileDto, SaveTutorProfileDto } from '@modules/profiles/profiles.dto';
import { ProfilesService } from '@modules/profiles/profiles.service';
import {
  GetMyProfileDoc,
  ProfilesControllerDoc,
  SaveStudentProfileDoc,
  SaveTutorProfileDoc,
} from '@modules/profiles/profiles.swagger';

import type { AuthenticatedUser } from '@modules/auth/auth.guard';

@ProfilesControllerDoc()
@UseGuards(JwtAuthGuard)
@Controller('profiles/me')
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  @Get()
  @UseGuards(RolesGuard)
  @Roles(Role.STUDENT, Role.TUTOR)
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
